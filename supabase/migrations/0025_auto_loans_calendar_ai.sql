-- =====================================================================
-- 1) Automatic loan approval: a request is approved on submission when the member's net balance
--    (contributions + deposits − loans) still covers it AND the fund keeps its liquidity reserve
--    (cash + bank deposits ≥ reserve after disbursement). Otherwise it waits for the manager with the reasons.
--    Disbursement always stays a manual manager action.
-- 2) Member calendar: private tasks + fund events + contribution / installment due dates.
-- 3) AI advisor: conversation log (written by the ai-advisor Edge Function) and a members switch.
-- =====================================================================

alter table public.fund_settings add column if not exists loan_auto_approve boolean not null default true;
alter table public.fund_settings add column if not exists loan_reserve_pct numeric(5,2) not null default 30 check (loan_reserve_pct between 0 and 100);
alter table public.fund_settings add column if not exists loan_min_cash numeric(14,2) not null default 5000 check (loan_min_cash >= 0);
alter table public.fund_settings add column if not exists ai_members_enabled boolean not null default false;

alter table public.loans add column if not exists auto_approved boolean not null default false;
alter table public.loans add column if not exists auto_check jsonb;

-- ---------------------------------------------------------------- net balance & liquidity
/** Member's net balance in the fund: paid contributions + deposit balance − outstanding loans. */
create or replace function public.member_net_position(p_member uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(b.contributions_total, 0) + coalesce(b.deposit_balance, 0) - coalesce(b.loan_outstanding, 0)
    from public.v_member_balances b where b.member_id = p_member
$$;

/** Liquid resources: ledger cash + active bank deposits (withdrawable any time), and the reserve the policy requires. */
create or replace function public.fund_liquidity() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.fund_settings := public.settings(); v_cash numeric; v_bank numeric; v_dep numeric;
begin
  v_cash := public.account_balance('cash');
  select coalesce(sum(current_value), 0) into v_bank from public.v_investment_positions where category = 'bank_deposit' and status = 'active';
  v_dep := public.account_balance('member_deposits');
  return jsonb_build_object('cash', v_cash, 'bank_deposits', v_bank, 'liquid', v_cash + v_bank, 'member_deposits', v_dep,
    'reserve', greatest(s.loan_min_cash, round(v_dep * s.loan_reserve_pct / 100, 2)));
end $$;

/** Manager view of the liquidity position (used by the dashboard / advisor). */
create or replace function public.liquidity_report() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin perform public.assert_manager(); return public.fund_liquidity(); end $$;

create or replace function public._loan_auto_check(p_member uuid, p_amount numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.fund_settings := public.settings(); v_net numeric; liq jsonb; v_after numeric; reasons jsonb := '[]'::jsonb;
begin
  v_net := coalesce(public.member_net_position(p_member), 0);
  liq := public.fund_liquidity();
  v_after := (liq->>'liquid')::numeric - coalesce(p_amount, 0);
  if not s.loan_auto_approve then reasons := reasons || to_jsonb('القبول التلقائي متوقف من الإعدادات'::text); end if;
  if v_net - coalesce(p_amount, 0) < 0 then
    reasons := reasons || to_jsonb(('صافي رصيد العضو بعد القرض سالب (' || to_char(v_net - p_amount, 'FM999,999,990.00') || ' ريال)')::text);
  end if;
  if v_after < (liq->>'reserve')::numeric then
    reasons := reasons || to_jsonb('سيولة الصندوق بعد الصرف ستكون أقل من الاحتياطي المطلوب'::text);
  end if;
  return jsonb_build_object('auto', jsonb_array_length(reasons) = 0, 'net_before', v_net, 'net_after', v_net - coalesce(p_amount, 0),
    'blocked', case
      when s.loan_one_active_per_member and exists (select 1 from public.loans where member_id = p_member and status in ('pending','approved','disbursed','active','overdue'))
        then 'لديك طلب أو قرض قائم — لا يمكن تقديم طلب جديد قبل إغلاقه'
      when s.loan_block_if_overdue and exists (select 1 from public.v_contribution_status where member_id = p_member and is_overdue)
        then 'يوجد اشتراكات شهرية متأخرة — يرجى سدادها قبل طلب قرض'
      when coalesce(p_amount, 0) > s.loan_max_amount then 'المبلغ أعلى من الحد الأعلى للقرض' end,
    'max_auto', case when s.loan_auto_approve then greatest(0, least(v_net, (liq->>'liquid')::numeric - (liq->>'reserve')::numeric)) else 0 end,
    'liquid_after', v_after, 'reserve', (liq->>'reserve')::numeric, 'reasons', reasons, 'checked_at', now());
end $$;

/** Live check for the request form (member: own; manager: any member). */
create or replace function public.loan_auto_check(p_amount numeric, p_member uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_m uuid;
begin
  if public.is_manager() then v_m := coalesce(p_member, public.current_member_id()); else v_m := public.assert_member(); end if;
  if v_m is null then raise exception 'العضو غير محدد'; end if;
  if public.is_manager() then return public._loan_auto_check(v_m, coalesce(public.money(p_amount), 0)); end if;
  return public._loan_auto_check(v_m, coalesce(public.money(p_amount), 0)) - 'liquid_after' - 'reserve';
end $$;

-- ---------------------------------------------------------------- approval core (shared by manager + auto)
create or replace function public._approve_loan(p_loan uuid, p_amount numeric, p_installments int, p_frequency text,
  p_fee numeric, p_first_due date, p_note text, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.loans; s public.fund_settings := public.settings(); v_fee numeric;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or l.status <> 'pending' then raise exception 'لا يمكن اعتماد هذا الطلب'; end if;
  p_amount := public.money(p_amount);
  if p_installments is null or p_installments < 1 or p_installments > 120 then raise exception 'عدد الأقساط غير صالح'; end if;
  if p_frequency not in ('monthly','quarterly') then raise exception 'دورية السداد غير صالحة'; end if;
  v_fee := coalesce(p_fee, round(p_amount * s.loan_default_fee_pct / 100, 2));
  if v_fee < 0 or v_fee <> round(v_fee,2) then raise exception 'الرسوم غير صالحة'; end if;
  if p_first_due is not null and p_first_due < public.fund_today() then raise exception 'تاريخ أول قسط لا يمكن أن يكون في الماضي'; end if;
  update public.loans set status = 'approved', approved_amount = p_amount, installments_count = p_installments,
         frequency = p_frequency, fee_amount = v_fee, first_due_date = p_first_due,
         decided_by = p_actor, decided_at = now(), decision_note = p_note where id = p_loan;
  perform public._notify_member(l.member_id, 'loan_approved', 'تمت الموافقة على قرضك',
    'تمت الموافقة على ' || p_amount || ' ريال على ' || p_installments || ' قسط. سيتم إشعارك عند الصرف.', '/member/loans/view?id=' || p_loan);
end $$;

create or replace function public.approve_loan(p_loan uuid, p_amount numeric, p_installments int, p_frequency text,
  p_fee numeric default null, p_first_due date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._approve_loan(p_loan, p_amount, p_installments, p_frequency, p_fee, p_first_due, p_note, public.assert_manager());
end $$;

create or replace function public.request_loan(p_amount numeric, p_purpose text, p_months int, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m uuid := public.assert_member(); s public.fund_settings := public.settings(); v uuid; chk jsonb; v_name text;
begin
  perform 1 from public.members where id = v_m for update;
  p_amount := public.money(p_amount);
  if p_amount is null or p_amount <= 0 then raise exception 'مبلغ القرض غير صالح'; end if;
  if p_amount > s.loan_max_amount then raise exception 'الحد الأعلى للقرض % ريال', s.loan_max_amount; end if;
  if p_months is null or p_months < 1 or p_months > s.loan_max_months then raise exception 'مدة السداد يجب أن تكون بين 1 و % شهراً', s.loan_max_months; end if;
  if length(trim(coalesce(p_purpose,''))) < 3 then raise exception 'يرجى توضيح الغرض من القرض'; end if;
  if s.loan_one_active_per_member and exists (select 1 from public.loans where member_id = v_m
       and status in ('pending','approved','disbursed','active','overdue')) then
    raise exception 'لديك طلب أو قرض قائم — لا يمكن تقديم طلب جديد قبل إغلاقه';
  end if;
  if s.loan_block_if_overdue and exists (select 1 from public.v_contribution_status where member_id = v_m and is_overdue) then
    raise exception 'يوجد اشتراكات شهرية متأخرة — يرجى سدادها قبل طلب قرض';
  end if;
  chk := public._loan_auto_check(v_m, p_amount);
  insert into public.loans(member_id, requested_amount, purpose, preferred_months, notes, auto_check)
  values (v_m, p_amount, trim(p_purpose), p_months, p_notes, chk) returning id into v;
  select full_name into v_name from public.members where id = v_m;

  if (chk->>'auto')::boolean then
    perform public._approve_loan(v, p_amount, p_months, 'monthly', null, null,
      'اعتماد تلقائي — صافي رصيد العضو يغطي القرض وسيولة الصندوق كافية', '00000000-0000-4000-8000-00000000a5f1');
    update public.loans set auto_approved = true where id = v;
    perform public._notify_managers('loan_auto_approved', 'قرض معتمد تلقائياً بانتظار الصرف',
      v_name || ' — ' || p_amount || ' ريال على ' || p_months || ' شهر', '/admin/loans/view?id=' || v);
  else
    perform public._notify_member(v_m, 'loan_received', 'تم استلام طلب القرض', 'طلبك بمبلغ ' || p_amount || ' ريال بانتظار موافقة مدير الصندوق.', '/member/loans/view?id=' || v);
    perform public._notify_managers('loan_request', 'طلب قرض بانتظار موافقتك',
      v_name || ' — ' || p_amount || ' ريال · ' || coalesce((chk->'reasons'->>0), ''), '/admin/loans/view?id=' || v);
  end if;
  perform public._log('create', 'loans', v::text, jsonb_build_object('amount', p_amount, 'auto', chk->'auto'), null, 'طلب قرض');
  return v;
end $$;

create or replace function public.set_loan_auto_policy(p_auto boolean, p_reserve_pct numeric, p_min_cash numeric) returns void
language plpgsql security definer set search_path = public as $$
declare o jsonb;
begin
  perform public.assert_manager();
  select jsonb_build_object('auto', loan_auto_approve, 'pct', loan_reserve_pct, 'min', loan_min_cash) into o from public.fund_settings where id = 1;
  update public.fund_settings set loan_auto_approve = coalesce(p_auto, loan_auto_approve), loan_reserve_pct = coalesce(p_reserve_pct, loan_reserve_pct),
         loan_min_cash = coalesce(p_min_cash, loan_min_cash), updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._log('policy_change', 'fund_settings', '1', jsonb_build_object('auto', p_auto, 'pct', p_reserve_pct, 'min', p_min_cash), o, 'سياسة القبول التلقائي للقروض');
end $$;

-- ---------------------------------------------------------------- member calendar
create table public.member_tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  title      text not null check (length(trim(title)) between 1 and 120),
  task_date  date not null,
  task_time  text check (task_time is null or task_time ~ '^\d{2}:\d{2}$'),
  note       text check (length(note) <= 400),
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.member_tasks(user_id, task_date);

create or replace function public.add_my_task(p_title text, p_date date, p_time text default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'غير مصرح'; end if;
  if (select count(*) from public.member_tasks where user_id = auth.uid()) >= 500 then raise exception 'وصلت للحد الأعلى من المهام'; end if;
  insert into public.member_tasks(user_id, title, task_date, task_time, note)
  values (auth.uid(), trim(p_title), p_date, nullif(trim(p_time), ''), nullif(trim(p_note), '')) returning id into v;
  return v;
end $$;
create or replace function public.set_my_task_done(p_id uuid, p_done boolean) returns void
language sql security definer set search_path = public as $$
  update public.member_tasks set done = coalesce(p_done, not done) where id = p_id and user_id = auth.uid()
$$;
create or replace function public.delete_my_task(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.member_tasks where id = p_id and user_id = auth.uid()
$$;

/** Everything dated for the signed-in user between two dates: tasks, fund events, contribution + installment dues. */
create or replace function public.my_calendar(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_m uuid := public.current_member_id();
begin
  if auth.uid() is null then raise exception 'غير مصرح'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'نطاق التاريخ غير صالح'; end if;
  return jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'date', task_date, 'time', task_time, 'title', title, 'note', note, 'done', done) order by task_date, task_time nulls first)
                         from public.member_tasks where user_id = auth.uid() and task_date between p_from and p_to), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'date', event_date, 'time', start_time, 'title', title, 'kind', kind, 'location', location) order by event_date)
                         from public.events where status = 'active' and event_date between p_from and p_to), '[]'::jsonb),
    'dues', coalesce((select jsonb_agg(x order by x->>'date') from (
        select jsonb_build_object('date', c.due_date, 'kind', 'contribution', 'title', 'الاشتراك الشهري', 'amount', c.amount_outstanding, 'overdue', c.is_overdue) x
          from public.v_contribution_status c
         where v_m is not null and c.member_id = v_m and c.status not in ('paid','waived') and c.due_date between p_from and p_to
        union all
        select jsonb_build_object('date', i.due_date, 'kind', 'installment', 'title', 'قسط القرض ' || l.loan_no, 'amount', i.amount_remaining, 'overdue', i.status = 'overdue')
          from public.v_installment_status i join public.loans l on l.id = i.loan_id
         where v_m is not null and l.member_id = v_m and i.status <> 'paid' and i.due_date between p_from and p_to) d), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- AI advisor log
create table public.ai_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  tokens     int,
  created_at timestamptz not null default now()
);
create index on public.ai_messages(user_id, created_at);

create or replace function public.set_ai_members(p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_manager();
  update public.fund_settings set ai_members_enabled = coalesce(p_enabled, false), updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._log('policy_change', 'fund_settings', '1', jsonb_build_object('ai_members_enabled', p_enabled), null, 'المستشار المالي للأعضاء');
end $$;

create or replace function public.clear_my_ai_chat() returns void
language sql security definer set search_path = public as $$ delete from public.ai_messages where user_id = auth.uid() $$;

-- ---------------------------------------------------------------- access
alter table public.member_tasks enable row level security;
alter table public.ai_messages enable row level security;
revoke all on public.member_tasks, public.ai_messages from public, anon, authenticated;
grant select on public.member_tasks, public.ai_messages to authenticated;
create policy owner_read on public.member_tasks for select to authenticated using (user_id = (select auth.uid()));
create policy owner_read on public.ai_messages for select to authenticated using (user_id = (select auth.uid()) or (select public.is_manager()));

revoke execute on function public.member_net_position(uuid), public.fund_liquidity(), public._loan_auto_check(uuid,numeric),
  public._approve_loan(uuid,numeric,int,text,numeric,date,text,uuid) from public, anon, authenticated;
revoke execute on function public.liquidity_report(), public.loan_auto_check(numeric,uuid), public.set_loan_auto_policy(boolean,numeric,numeric),
  public.add_my_task(text,date,text,text), public.set_my_task_done(uuid,boolean), public.delete_my_task(uuid), public.my_calendar(date,date),
  public.set_ai_members(boolean), public.clear_my_ai_chat() from public, anon;
grant execute on function public.liquidity_report(), public.loan_auto_check(numeric,uuid), public.set_loan_auto_policy(boolean,numeric,numeric),
  public.add_my_task(text,date,text,text), public.set_my_task_done(uuid,boolean), public.delete_my_task(uuid), public.my_calendar(date,date),
  public.set_ai_members(boolean), public.clear_my_ai_chat() to authenticated;
do $$ begin
  grant execute on function public.member_net_position(uuid), public.fund_liquidity() to service_role;
  grant insert, select on public.ai_messages to service_role;
exception when undefined_object then null; end $$;
