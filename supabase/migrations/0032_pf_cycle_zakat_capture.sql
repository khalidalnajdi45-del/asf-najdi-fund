-- 0032 «ماليتي» phase 2: salary-cycle months, end-of-cycle forecast data, monthly commitments,
-- zakat calculator storage, automatic bank-SMS capture (iPhone Shortcut), opt-in finance alerts.
-- Everything stays owner-only; finance alerts go straight to the owner's notifications (no outbox the manager sees).

create table public.pf_settings (
  user_id        uuid primary key references public.app_users(id) on delete cascade,
  payday         int not null default 27 check (payday between 1 and 28),   -- 1 = calendar month
  notify         boolean not null default false,                           -- finance alerts are opt-in
  zakat          jsonb not null default '{}'::jsonb,
  zakat_date     date,
  capture_hash   text unique,
  capture_created_at timestamptz
);
alter table public.pf_settings enable row level security;
revoke all on public.pf_settings from public, anon, authenticated;

alter table public.pf_recurring add column if not exists title text check (length(title) <= 60);
alter table public.pf_recurring add column if not exists provider text check (length(provider) <= 60);
alter table public.pf_recurring add column if not exists is_commitment boolean not null default false;
alter table public.pf_recurring add column if not exists end_month date;
alter table public.pf_recurring add column if not exists total_amount numeric(14,2) check (total_amount is null or total_amount > 0);
alter table public.pf_transactions add column if not exists sms_hash text;
create unique index if not exists pf_transactions_sms_hash on public.pf_transactions(user_id, sms_hash) where sms_hash is not null;

-- ------------------------------------------------------------ helpers
create or replace function public._pf_payday(p_uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select payday from public.pf_settings where user_id = p_uid), 27)
$$;

/** The salary cycle containing p_date: [start, end]. payday = 1 → calendar month. */
create or replace function public._pf_cycle(p_uid uuid, p_date date, out c0 date, out c1 date)
language plpgsql stable security definer set search_path = public as $$
declare pd int := public._pf_payday(p_uid); m date := date_trunc('month', p_date)::date;
begin
  if extract(day from p_date) >= pd then c0 := m + (pd - 1);
  else c0 := (m - interval '1 month')::date + (pd - 1); end if;
  c1 := ((c0 + interval '1 month')::date) - 1;
end $$;

create or replace function public._pf_notify(p_uid uuid, p_type text, p_title text, p_body text, p_dedupe text) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications(user_id, type, title, body, link, dedupe_key)
  select p_uid, p_type, p_title, p_body, '/member/finance', p_dedupe
   where coalesce((select notify from public.pf_settings where user_id = p_uid), false)
  on conflict (user_id, dedupe_key) do nothing
$$;

/** 80% / 100% budget alerts for the cycle of p_date (only when the user opted in). */
create or replace function public._pf_budget_check(p_uid uuid, p_cat uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare c record; lim numeric; spent numeric; nm text;
begin
  if p_cat is null or not coalesce((select notify from public.pf_settings where user_id = p_uid), false) then return; end if;
  select monthly_limit into lim from public.pf_budgets where user_id = p_uid and category_id = p_cat;
  if lim is null then return; end if;
  select * into c from public._pf_cycle(p_uid, p_date);
  select coalesce(sum(amount),0) into spent from public.pf_transactions where user_id = p_uid and category_id = p_cat and kind = 'expense' and tx_date between c.c0 and c.c1;
  select name into nm from public.pf_categories where id = p_cat;
  if spent >= lim then
    perform public._pf_notify(p_uid, 'pf_budget', 'تجاوزت ميزانية ' || nm, 'صرفت ' || to_char(spent, 'FM999,999,990') || ' من ' || to_char(lim, 'FM999,999,990') || ' ريال في هذه الدورة.', 'pfb-' || p_cat || '-' || c.c0 || '-100');
  elsif spent >= lim * 0.8 then
    perform public._pf_notify(p_uid, 'pf_budget', 'اقتربت من ميزانية ' || nm, 'صرفت ' || round(spent / lim * 100) || '٪ من ميزانية ' || nm || ' — باقي ' || to_char(lim - spent, 'FM999,999,990') || ' ريال.', 'pfb-' || p_cat || '-' || c.c0 || '-80');
  end if;
end $$;

create or replace function public._pf_run_recurring(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; m date; t date := public.fund_today();
begin
  for r in select * from public.pf_recurring where user_id = p_uid and active loop
    m := coalesce((date_trunc('month', r.last_generated) + interval '1 month')::date, date_trunc('month', r.start_month)::date);
    while m <= date_trunc('month', t)::date loop
      exit when r.end_month is not null and m > date_trunc('month', r.end_month)::date;
      exit when m = date_trunc('month', t)::date and r.day_of_month > extract(day from t);
      insert into public.pf_transactions(user_id, kind, amount, category_id, note, tx_date, source, recurring_id)
      values (p_uid, r.kind, r.amount, r.category_id, coalesce(r.title, r.note), m + (r.day_of_month - 1), 'recurring', r.id);
      update public.pf_recurring set last_generated = m + (r.day_of_month - 1) where id = r.id;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
end $$;

-- ------------------------------------------------------------ overview (salary cycle)
create or replace function public.pf_overview(p_month date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._pf_uid();
  v_m   uuid := public.current_member_id();
  t date := public.fund_today();
  cy record; pv record; m0 date; m1 date;
begin
  perform public._pf_ensure(v_uid);
  perform public._pf_run_recurring(v_uid);
  select * into cy from public._pf_cycle(v_uid, coalesce(p_month, t)); m0 := cy.c0; m1 := cy.c1;
  select * into pv from public._pf_cycle(v_uid, m0 - 1);
  return jsonb_build_object(
    'month', m0, 'cycle', jsonb_build_object('start', m0, 'end', m1, 'today', t),
    'settings', (select jsonb_build_object('payday', coalesce(s.payday, 27), 'notify', coalesce(s.notify, false), 'zakat', coalesce(s.zakat, '{}'::jsonb),
                   'zakat_date', s.zakat_date, 'capture', s.capture_hash is not null, 'capture_created_at', s.capture_created_at)
                   from (select 1) x left join public.pf_settings s on s.user_id = v_uid),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'color', color) order by kind, sort, name), '[]')
                     from public.pf_categories where user_id = v_uid),
    'income',  (select coalesce(sum(amount),0) from public.pf_transactions where user_id = v_uid and kind = 'income'  and tx_date between m0 and m1),
    'expense', (select coalesce(sum(amount),0) from public.pf_transactions where user_id = v_uid and kind = 'expense' and tx_date between m0 and m1),
    'variable', (select coalesce(sum(amount),0) from public.pf_transactions where user_id = v_uid and kind = 'expense' and source <> 'recurring' and tx_date between m0 and least(m1, t)),
    'prev_variable', (select coalesce(sum(amount),0) from public.pf_transactions where user_id = v_uid and kind = 'expense' and source <> 'recurring' and tx_date between pv.c0 and pv.c1),
    'prev_days', (pv.c1 - pv.c0 + 1),
    'by_category', (select coalesce(jsonb_agg(x order by (x->>'spent')::numeric desc), '[]') from (
        select jsonb_build_object('category_id', c.id, 'name', c.name, 'color', c.color, 'spent', coalesce(s.spent,0), 'budget', b.monthly_limit) x
          from public.pf_categories c
          left join (select category_id, sum(amount) spent from public.pf_transactions
                      where user_id = v_uid and kind = 'expense' and tx_date between m0 and m1 group by 1) s on s.category_id = c.id
          left join public.pf_budgets b on b.user_id = v_uid and b.category_id = c.id
         where c.user_id = v_uid and c.kind = 'expense' and (s.spent > 0 or b.monthly_limit is not null)
        union all
        select jsonb_build_object('category_id', null, 'name', 'بدون تصنيف', 'color', '#8a8f98', 'spent', sum(amount), 'budget', null)
          from public.pf_transactions where user_id = v_uid and kind = 'expense' and category_id is null and tx_date between m0 and m1
        having sum(amount) > 0) q),
    'transactions', (select coalesce(jsonb_agg(jsonb_build_object('id', t2.id, 'kind', t2.kind, 'amount', t2.amount, 'category_id', t2.category_id,
                        'category', c.name, 'color', c.color, 'note', t2.note, 'date', t2.tx_date, 'source', t2.source) order by t2.tx_date desc, t2.created_at desc), '[]')
                       from public.pf_transactions t2 left join public.pf_categories c on c.id = t2.category_id
                      where t2.user_id = v_uid and t2.tx_date between m0 and m1),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('month', g.s, 'income', coalesce((select sum(amount) from public.pf_transactions where user_id = v_uid and kind = 'income' and tx_date between g.s and g.e),0),
                                                           'expense', coalesce((select sum(amount) from public.pf_transactions where user_id = v_uid and kind = 'expense' and tx_date between g.s and g.e),0)) order by g.s), '[]')
                from (select (m0 - make_interval(months => k))::date s, ((m0 - make_interval(months => k - 1))::date - 1) e from generate_series(0, 5) k) g),
    'recurring', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'amount', r.amount, 'category_id', r.category_id, 'category', c.name,
                     'note', coalesce(r.title, r.note), 'day', r.day_of_month, 'active', r.active) order by r.kind desc, r.day_of_month), '[]')
                    from public.pf_recurring r left join public.pf_categories c on c.id = r.category_id where r.user_id = v_uid and not r.is_commitment),
    'commitments', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', coalesce(r.title, r.note), 'provider', r.provider, 'amount', r.amount, 'day', r.day_of_month,
                     'active', r.active, 'end_month', r.end_month, 'total_amount', r.total_amount, 'category', c.name,
                     'paid_count', (select count(*) from public.pf_transactions x where x.recurring_id = r.id),
                     'remaining', case when r.end_month is null then null else greatest(0,
                        (extract(year from r.end_month) * 12 + extract(month from r.end_month))::int
                        - (extract(year from coalesce(r.last_generated, (r.start_month - interval '1 month')::date)) * 12 + extract(month from coalesce(r.last_generated, (r.start_month - interval '1 month')::date)))::int) end)
                     order by r.day_of_month), '[]')
                    from public.pf_recurring r left join public.pf_categories c on c.id = r.category_id where r.user_id = v_uid and r.is_commitment),
    -- what is still expected in this cycle (recurring income/expenses and commitments not posted yet)
    'upcoming', (select coalesce(jsonb_agg(jsonb_build_object('title', coalesce(r.title, r.note, c.name), 'kind', r.kind, 'amount', r.amount, 'date', d.dt, 'commitment', r.is_commitment) order by d.dt), '[]')
                   from public.pf_recurring r left join public.pf_categories c on c.id = r.category_id
                   cross join lateral (select (mm + (r.day_of_month - 1))::date dt from unnest(array[date_trunc('month', m0)::date, date_trunc('month', m1)::date]) mm) d
                  where r.user_id = v_uid and r.active and d.dt > t and d.dt between m0 and m1
                    and (r.last_generated is null or d.dt > r.last_generated) and d.dt >= r.start_month
                    and (r.end_month is null or d.dt <= ((date_trunc('month', r.end_month) + interval '1 month')::date - 1))),
    'goals', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'target', target, 'saved', saved, 'target_date', target_date) order by created_at), '[]')
                from public.pf_goals where user_id = v_uid),
    'fund_due', case when v_m is null then null else jsonb_build_object(
        'contribution', (select coalesce(sum(amount_outstanding),0) from public.v_contribution_status
                          where member_id = v_m and status not in ('paid','waived') and due_date <= m1),
        'installments', (select coalesce(sum(i.amount_remaining),0) from public.v_installment_status i join public.loans l on l.id = i.loan_id
                          where l.member_id = v_m and i.status <> 'paid' and i.due_date <= m1)) end,
    'fund_balance', case when v_m is null then null else (select coalesce(contributions_total,0) + coalesce(deposit_balance,0) from public.v_member_balances where member_id = v_m) end
  );
end $$;

-- budget alerts on manual entries too
create or replace function public.pf_add_tx(p_kind text, p_amount numeric, p_category uuid, p_date date, p_note text default null, p_source text default 'manual')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid(); v uuid; v_cat uuid;
begin
  perform public._pf_ensure(v_uid);
  if p_kind not in ('income','expense') then raise exception 'نوع غير صالح'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_date is null or p_date > public.fund_today() + 366 then raise exception 'تاريخ غير صالح'; end if;
  if (select count(*) from public.pf_transactions where user_id = v_uid) >= 20000 then raise exception 'وصلت للحد الأعلى من العمليات'; end if;
  v_cat := public._pf_cat(v_uid, p_category, p_kind);
  insert into public.pf_transactions(user_id, kind, amount, category_id, note, tx_date, source)
  values (v_uid, p_kind, round(p_amount, 2), v_cat, nullif(left(trim(p_note), 160), ''), p_date, case when p_source = 'sms' then 'sms' else 'manual' end)
  returning id into v;
  if p_kind = 'expense' then perform public._pf_budget_check(v_uid, v_cat, p_date); end if;
  return v;
end $$;

-- ------------------------------------------------------------ settings, commitments, zakat
create or replace function public.pf_set_settings(p_payday int, p_notify boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid();
begin
  if p_payday is not null and p_payday not between 1 and 28 then raise exception 'يوم الراتب بين 1 و 28'; end if;
  insert into public.pf_settings(user_id, payday, notify) values (v_uid, coalesce(p_payday, 27), coalesce(p_notify, false))
  on conflict (user_id) do update set payday = coalesce(p_payday, public.pf_settings.payday), notify = coalesce(p_notify, public.pf_settings.notify);
end $$;

create or replace function public.pf_add_commitment(p_title text, p_amount numeric, p_day int, p_category uuid default null,
  p_end date default null, p_total numeric default null, p_provider text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; v_uid uuid := public._pf_uid();
begin
  if length(trim(coalesce(p_title,''))) < 2 then raise exception 'اكتب اسم الالتزام'; end if;
  v := public.pf_add_recurring('expense', p_amount, p_category, p_day, null);
  update public.pf_recurring set title = trim(p_title), provider = nullif(trim(p_provider), ''), is_commitment = true,
         end_month = case when p_end is null then null else date_trunc('month', p_end)::date end, total_amount = p_total
   where id = v and user_id = v_uid;
  return v;
end $$;

create or replace function public.pf_save_zakat(p jsonb, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid();
begin
  if pg_column_size(p) > 8000 then raise exception 'بيانات كبيرة'; end if;
  insert into public.pf_settings(user_id, zakat, zakat_date) values (v_uid, coalesce(p, '{}'::jsonb), p_date)
  on conflict (user_id) do update set zakat = coalesce(p, '{}'::jsonb), zakat_date = p_date;
end $$;

-- ------------------------------------------------------------ automatic capture (iPhone Shortcut → Edge Function)
/** New personal key for the Shortcut. Only its SHA-256 is stored; the key is shown once. */
create or replace function public.pf_capture_token() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := public._pf_uid(); k text := 'pf_' || encode(gen_random_bytes(24), 'hex');
begin
  insert into public.pf_settings(user_id, capture_hash, capture_created_at) values (v_uid, encode(digest(k, 'sha256'), 'hex'), now())
  on conflict (user_id) do update set capture_hash = excluded.capture_hash, capture_created_at = now();
  return k;
end $$;

create or replace function public.pf_capture_revoke() returns void
language sql security definer set search_path = public as $$
  update public.pf_settings set capture_hash = null, capture_created_at = null where user_id = public._pf_uid()
$$;

/** Called by the pf-capture Edge Function (service_role) with the key's hash and the parsed message. */
create or replace function public.pf_capture(p_key_hash text, p_kind text, p_amount numeric, p_cat_name text, p_date date, p_note text, p_sms_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v uuid; v_cat uuid; d date := coalesce(p_date, public.fund_today());
begin
  select user_id into v_uid from public.pf_settings where capture_hash = p_key_hash;
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'المفتاح غير صحيح — أنشئ مفتاحاً جديداً من ماليتي'); end if;
  if (select count(*) from public.pf_transactions where user_id = v_uid and source = 'sms' and created_at > now() - interval '1 day') >= 200 then
    return jsonb_build_object('ok', false, 'error', 'تجاوزت الحد اليومي');
  end if;
  if p_kind not in ('income','expense') or coalesce(p_amount, 0) <= 0 or p_amount >= 100000000 then return jsonb_build_object('ok', false, 'error', 'بيانات غير صالحة'); end if;
  perform public._pf_ensure(v_uid);
  select id into v_cat from public.pf_categories where user_id = v_uid and kind = p_kind and name = p_cat_name;
  insert into public.pf_transactions(user_id, kind, amount, category_id, note, tx_date, source, sms_hash)
  values (v_uid, p_kind, round(p_amount, 2), v_cat, nullif(left(trim(p_note), 160), ''), least(d, public.fund_today()), 'sms', p_sms_hash)
  on conflict (user_id, sms_hash) where sms_hash is not null do nothing
  returning id into v;
  if v is null then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  perform public._pf_notify(v_uid, 'pf_capture', case when p_kind = 'income' then 'سُجّل دخل ' else 'سُجّل مصروف ' end || to_char(p_amount, 'FM999,999,990.00') || ' ريال',
    coalesce(nullif(trim(p_note), ''), 'من رسالة البنك') || coalesce(' · ' || p_cat_name, ''), 'pfc-' || v);
  if p_kind = 'expense' then perform public._pf_budget_check(v_uid, v_cat, d); end if;
  return jsonb_build_object('ok', true, 'id', v, 'category', p_cat_name);
end $$;

/** Daily: zakat anniversary reminder (Hijri year ≈ 354 days) for users who opted in. */
create or replace function public.run_pf_daily() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; t date := public.fund_today();
begin
  if auth.uid() is not null then perform public.assert_manager(); end if;
  for r in select * from public.pf_settings where zakat_date is not null and zakat_date <= t loop
    if r.zakat_date = t then
      perform public._pf_notify(r.user_id, 'pf_zakat', 'حلّ موعد زكاتك', 'افتح حاسبة الزكاة في ماليتي لتحديث المبالغ وحساب المستحق.', 'zakat-' || t);
      n := n + 1;
    end if;
    update public.pf_settings set zakat_date = zakat_date + 354 * greatest(1, ceil((t - zakat_date + 1) / 354.0)::int) where user_id = r.user_id;
  end loop;
  return n;
end $$;

create or replace function public.push_category(p_type text) returns text
language sql immutable as $$
  select case
    when p_type in ('contribution_reminder','contribution_overdue','repayment_reminder','repayment_overdue','due_today') then 'dues'
    when p_type in ('loan_approved','loan_rejected','loan_cancelled','loan_disbursed','loan_repaid',
                    'withdrawal_approved','withdrawal_paid','withdrawal_rejected','deposit_rejected') then 'requests'
    when p_type in ('contribution_recorded','repayment_recorded','deposit_received','transaction_reversed') then 'payments'
    when p_type in ('event_invite','event_cancelled') then 'events'
    when p_type in ('task_reminder') then 'tasks'
    when p_type in ('pf_budget','pf_capture','pf_zakat') then 'finance'
    when p_type in ('loan_request','loan_received','loan_auto_approved','deposit_request','withdrawal_request',
                    'investment_maturity','daily_summary') then 'admin'
    else 'fund' end
$$;

revoke execute on function public._pf_payday(uuid), public._pf_cycle(uuid, date), public._pf_notify(uuid,text,text,text,text),
  public._pf_budget_check(uuid,uuid,date), public.pf_capture(text,text,numeric,text,date,text,text), public.run_pf_daily()
  from public, anon, authenticated;
do $$ begin grant execute on function public.pf_capture(text,text,numeric,text,date,text,text) to service_role; exception when undefined_object then null; end $$;
revoke execute on function public.pf_set_settings(int,boolean), public.pf_add_commitment(text,numeric,int,uuid,date,numeric,text),
  public.pf_save_zakat(jsonb,date), public.pf_capture_token(), public.pf_capture_revoke() from public, anon;
grant execute on function public.pf_set_settings(int,boolean), public.pf_add_commitment(text,numeric,int,uuid,date,numeric,text),
  public.pf_save_zakat(jsonb,date), public.pf_capture_token(), public.pf_capture_revoke() to authenticated;
