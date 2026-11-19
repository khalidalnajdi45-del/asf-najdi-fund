-- =====================================================================
-- 1) Profit distribution: the manager distributes realized surplus to members (pro-rata or equal),
--    credited to their deposit balance or paid in cash. Each member gets their own transaction + notice.
-- 2) Fiscal period close (quarter / year): snapshots the statements and locks the books up to the
--    period end — nothing can be posted on or before a closed date until the period is reopened.
-- =====================================================================

alter table public.financial_transactions drop constraint if exists financial_transactions_tx_type_check;
alter table public.financial_transactions add constraint financial_transactions_tx_type_check check (tx_type in (
  'contribution_payment','deposit','withdrawal_payment','loan_disbursement','loan_repayment',
  'investment_capital','investment_income','investment_revaluation','investment_exit',
  'expense','other_income','profit_distribution','manual_journal','reversal'));

-- ---------------------------------------------------------------- profit distribution
create table public.profit_distributions (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  total        numeric(14,2) not null check (total > 0),
  basis        text not null check (basis in ('contributions','contributions_deposits','equal')),
  method       text not null check (method in ('deposit','cash')),
  dist_date    date not null,
  note         text,
  created_by   uuid not null,
  created_at   timestamptz not null default now()
);
create table public.profit_distribution_lines (
  id              uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.profit_distributions(id),
  member_id       uuid not null references public.members(id),
  base_amount     numeric(14,2) not null,
  share_pct       numeric(9,6) not null,
  amount          numeric(14,2) not null check (amount > 0),
  financial_transaction_id uuid not null unique references public.financial_transactions(id),
  unique (distribution_id, member_id)
);

/** Realized surplus still available for distribution (excludes unrealized fair-value gains). */
create or replace function public.distributable_surplus(p_as_of date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when a.type in ('income') or a.system_key in ('retained_earnings','opening_equity') then l.credit - l.debit
                           when a.type = 'expense' then l.credit - l.debit else 0 end), 0)
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    join public.journal_entries e on e.id = l.entry_id
   where e.entry_date <= coalesce(p_as_of, public.fund_today())
     and (a.type in ('income','expense') or a.system_key in ('retained_earnings','opening_equity'))
$$;

create or replace function public.preview_profit_distribution(p_amount numeric, p_basis text, p_members uuid[] default null)
returns table (member_id uuid, full_name text, member_no text, base_amount numeric, share_pct numeric, amount numeric)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_total_base numeric; v_amt numeric := public.money(p_amount); v_diff numeric;
begin
  perform public.assert_manager();
  if p_basis not in ('contributions','contributions_deposits','equal') then raise exception 'أساس التوزيع غير صالح'; end if;
  create temp table if not exists _pd (member_id uuid, full_name text, member_no text, base_amount numeric, share_pct numeric, amount numeric) on commit drop;
  delete from _pd;
  insert into _pd(member_id, full_name, member_no, base_amount)
  select b.member_id, b.full_name, b.member_no,
         case p_basis when 'contributions' then coalesce(b.contributions_total, 0)
                      when 'contributions_deposits' then coalesce(b.contributions_total, 0) + greatest(coalesce(b.deposit_balance, 0), 0)
                      else 1 end
    from public.v_member_balances b join public.members m on m.id = b.member_id
   where m.status = 'active' and (p_members is null or b.member_id = any(p_members));
  delete from _pd where base_amount <= 0;
  select sum(base_amount) into v_total_base from _pd;
  if coalesce(v_total_base, 0) = 0 then return; end if;
  update _pd set share_pct = base_amount / v_total_base, amount = floor(v_amt * base_amount / v_total_base * 100) / 100;
  v_diff := v_amt - (select sum(amount) from _pd);
  if v_diff <> 0 then
    update _pd set amount = amount + v_diff where _pd.member_id = (select x.member_id from _pd x order by x.base_amount desc, x.member_no limit 1);
  end if;
  return query select * from _pd where _pd.amount > 0 order by _pd.member_no;
end $$;

create or replace function public.post_profit_distribution(p_title text, p_amount numeric, p_basis text, p_method text,
  p_date date default null, p_members uuid[] default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_date date := coalesce(p_date, public.fund_today()); v_amt numeric := public.money(p_amount);
        r record; v_tx uuid; v_avail numeric; v_desc text;
begin
  perform public.assert_manager();
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'عنوان التوزيع مطلوب'; end if;
  if coalesce(v_amt, 0) <= 0 then raise exception 'مبلغ التوزيع يجب أن يكون أكبر من صفر'; end if;
  if p_method not in ('deposit','cash') then raise exception 'طريقة التوزيع غير صالحة'; end if;
  if v_date > public.fund_today() then raise exception 'لا يمكن التوزيع بتاريخ مستقبلي'; end if;
  v_avail := public.distributable_surplus(v_date);
  if v_amt > v_avail then raise exception 'مبلغ التوزيع (%) أكبر من الفائض المحقق المتاح (%)', v_amt, v_avail; end if;
  if p_method = 'cash' then perform public._assert_cash(v_amt); end if;

  insert into public.profit_distributions(title, total, basis, method, dist_date, note, created_by)
  values (trim(p_title), v_amt, p_basis, p_method, v_date, nullif(trim(p_note), ''), auth.uid()) returning id into v_id;

  for r in select * from public.preview_profit_distribution(v_amt, p_basis, p_members) loop
    v_desc := 'توزيع أرباح: ' || trim(p_title);
    v_tx := public._new_tx('profit_distribution', v_date, v_desc, r.amount, r.member_id, null, null, null, null);
    perform public._post(v_tx, v_date, v_desc, jsonb_build_array(
      jsonb_build_object('a', 'retained_earnings', 'dr', r.amount, 'm', r.member_id),
      case when p_method = 'deposit' then jsonb_build_object('a', 'member_deposits', 'cr', r.amount, 'm', r.member_id)
           else jsonb_build_object('a', 'cash', 'cr', r.amount) end));
    if p_method = 'deposit' then
      insert into public.member_deposits(member_id, amount, status, method, deposited_on, reference, financial_transaction_id, decided_by, decided_at)
      values (r.member_id, r.amount, 'confirmed', 'توزيع أرباح', v_date, left(trim(p_title), 60), v_tx, auth.uid(), now());
    end if;
    insert into public.profit_distribution_lines(distribution_id, member_id, base_amount, share_pct, amount, financial_transaction_id)
    values (v_id, r.member_id, r.base_amount, r.share_pct, r.amount, v_tx);
    perform public._notify_member(r.member_id, 'profit_distribution', 'توزيع أرباح: ' || trim(p_title),
      'حصتك ' || r.amount || ' ريال' || case when p_method = 'deposit' then ' أُضيفت إلى رصيد ودائعك.' else ' تُصرف لك نقداً.' end, '/member/deposits');
  end loop;
  if not exists (select 1 from public.profit_distribution_lines where distribution_id = v_id) then
    raise exception 'لا يوجد أعضاء مستحقون حسب أساس التوزيع المختار';
  end if;
  perform public._log('create', 'profit_distributions', v_id::text, jsonb_build_object('total', v_amt, 'basis', p_basis, 'method', p_method), null, 'توزيع أرباح');
  return v_id;
end $$;

create or replace view public.v_profit_distributions with (security_invoker = true) as
  select d.*, count(l.id) as members, coalesce(sum(l.amount) filter (where not t.is_reversed), 0) as posted
    from public.profit_distributions d left join public.profit_distribution_lines l on l.distribution_id = d.id
    left join lateral (select exists (select 1 from public.financial_transactions r where r.reverses_tx_id = l.financial_transaction_id) as is_reversed) t on true
   group by d.id;

/** Merge fields gain the member's latest distribution share. */
create or replace function public.member_merge_fields(p_member uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'الاسم', split_part(trim(regexp_replace(b.full_name, '\(.*?\)', '', 'g')), ' ', 1),
    'الاسم_الكامل', b.full_name,
    'المتأخرات', b.contributions_overdue,
    'أشهر_التأخير', b.contributions_overdue_months,
    'المتبقي_من_القرض', b.loan_outstanding,
    'القسط_القادم', (select next_due_amount from public.v_loan_summary where member_id = p_member and status in ('disbursed','active','overdue') and next_due_date is not null order by next_due_date limit 1),
    'تاريخ_القسط', (select next_due_date from public.v_loan_summary where member_id = p_member and status in ('disbursed','active','overdue') and next_due_date is not null order by next_due_date limit 1),
    'الاشتراك_الشهري', (public.settings()).monthly_contribution,
    'حصة_الأرباح', (select l.amount from public.profit_distribution_lines l join public.profit_distributions d on d.id = l.distribution_id
                     where l.member_id = p_member order by d.created_at desc limit 1),
    'عنوان_التوزيع', (select d.title from public.profit_distribution_lines l join public.profit_distributions d on d.id = l.distribution_id
                     where l.member_id = p_member order by d.created_at desc limit 1))
  from public.v_member_balances b where b.member_id = p_member
$$;

-- ---------------------------------------------------------------- fiscal period close
alter table public.fund_settings add column if not exists locked_through date;

create table public.fiscal_closes (
  id            uuid primary key default gen_random_uuid(),
  period_type   text not null check (period_type in ('quarter','year')),
  period_label  text not null,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'closed' check (status in ('closed','reopened')),
  snapshot      jsonb not null,
  note          text,
  closed_by     uuid not null,
  closed_at     timestamptz not null default now(),
  reopened_by   uuid,
  reopened_at   timestamptz,
  reopen_note   text
);
create unique index fiscal_closes_active on public.fiscal_closes(period_type, period_start) where status = 'closed';

create or replace function public._refresh_lock() returns void language sql security definer set search_path = public as $$
  update public.fund_settings set locked_through = (select max(period_end) from public.fiscal_closes where status = 'closed') where id = 1
$$;

create or replace function public.trg_period_lock() returns trigger language plpgsql as $$
declare v date;
begin
  select locked_through into v from public.fund_settings where id = 1;
  if v is not null and new.entry_date <= v then
    raise exception 'الفترة المالية مقفلة حتى % — لا يمكن تسجيل عمليات بتاريخ داخلها (أعد فتح الفترة أولاً)', v;
  end if;
  return new;
end $$;
create trigger period_lock before insert on public.journal_entries for each row execute function public.trg_period_lock();

create or replace function public.close_fiscal_period(p_type text, p_year int, p_quarter int default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_start date; v_end date; v_label text; v_id uuid; tb jsonb;
begin
  perform public.assert_manager();
  if p_type = 'year' then
    v_start := make_date(p_year, 1, 1); v_end := make_date(p_year, 12, 31); v_label := 'السنة المالية ' || p_year;
  elsif p_type = 'quarter' and p_quarter between 1 and 4 then
    v_start := make_date(p_year, (p_quarter - 1) * 3 + 1, 1); v_end := (v_start + interval '3 months' - interval '1 day')::date;
    v_label := 'الربع ' || (array['الأول','الثاني','الثالث','الرابع'])[p_quarter] || ' ' || p_year;
  else raise exception 'نوع الفترة غير صالح'; end if;
  if v_end >= public.fund_today() then raise exception 'لا يمكن إقفال فترة لم تنتهِ بعد (تنتهي في %)', v_end; end if;
  if exists (select 1 from public.fiscal_closes where period_type = p_type and period_start = v_start and status = 'closed') then
    raise exception 'هذه الفترة مقفلة مسبقاً';
  end if;
  tb := public.report_trial_balance(v_end);
  if abs((tb->>'total_debit')::numeric - (tb->>'total_credit')::numeric) > 0.005 then raise exception 'ميزان المراجعة غير متوازن — لا يمكن الإقفال'; end if;
  insert into public.fiscal_closes(period_type, period_label, period_start, period_end, snapshot, note, closed_by)
  values (p_type, v_label, v_start, v_end, jsonb_build_object(
      'balance_sheet', public.report_balance_sheet(v_end),
      'income_statement', public.report_income_statement(v_start, v_end),
      'cash_flow', public.report_cash_flow(v_start, v_end),
      'trial_balance', tb), nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;
  perform public._refresh_lock();
  perform public._log('close_period', 'fiscal_closes', v_id::text, jsonb_build_object('period', v_label, 'end', v_end), null, 'إقفال فترة مالية');
  return v_id;
end $$;

create or replace function public.reopen_fiscal_period(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.fiscal_closes;
begin
  perform public.assert_manager();
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'سبب إعادة الفتح مطلوب'; end if;
  select * into c from public.fiscal_closes where id = p_id for update;
  if not found or c.status <> 'closed' then raise exception 'الفترة غير مقفلة'; end if;
  if exists (select 1 from public.fiscal_closes where status = 'closed' and period_end > c.period_end) then
    raise exception 'توجد فترة لاحقة مقفلة — أعد فتحها أولاً';
  end if;
  update public.fiscal_closes set status = 'reopened', reopened_by = auth.uid(), reopened_at = now(), reopen_note = trim(p_note) where id = p_id;
  perform public._refresh_lock();
  perform public._log('reopen_period', 'fiscal_closes', p_id::text, jsonb_build_object('period', c.period_label), null, trim(p_note));
end $$;

-- ---------------------------------------------------------------- reversal: distributions credited to deposits behave like deposits
create or replace function public.reverse_transaction(p_tx uuid, p_reason text, p_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.financial_transactions; e public.journal_entries; v_rev uuid; v_date date; v_avail numeric;
begin
  perform public.assert_manager();
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'سبب العكس مطلوب'; end if;
  select * into t from public.financial_transactions where id = p_tx for update;
  if not found then raise exception 'العملية غير موجودة'; end if;
  if t.tx_type = 'reversal' then raise exception 'لا يمكن عكس قيد عكسي — سجّل العملية من جديد'; end if;
  if exists (select 1 from public.financial_transactions where reverses_tx_id = p_tx) then raise exception 'تم عكس هذه العملية مسبقاً'; end if;
  v_date := coalesce(p_date, public.fund_today());
  if v_date < t.tx_date then raise exception 'تاريخ العكس قبل تاريخ العملية الأصلية'; end if;

  if t.tx_type = 'deposit' or (t.tx_type = 'profit_distribution' and exists (select 1 from public.member_deposits where financial_transaction_id = t.id)) then
    select available_to_withdraw into v_avail from public.v_member_balances where member_id = t.member_id;
    if v_avail < t.amount then raise exception 'لا يمكن عكس الإيداع: الرصيد المتاح أقل من مبلغه (يوجد سحوبات مرتبطة)'; end if;
  elsif t.tx_type = 'loan_disbursement' then
    if exists (select 1 from public.loan_repayments r join public.v_active_tx a on a.id = r.financial_transaction_id where r.loan_id = t.loan_id) then
      raise exception 'لا يمكن عكس صرف قرض عليه سدادات — اعكس السدادات أولاً';
    end if;
  elsif t.tx_type in ('investment_capital','investment_revaluation','investment_exit') then
    if exists (select 1 from public.investment_transactions it join public.v_active_tx a on a.id = it.financial_transaction_id
                where it.investment_id = t.investment_id and it.financial_transaction_id <> t.id
                  and (it.tx_date > t.tx_date or (it.tx_date = t.tx_date and it.created_at > t.created_at))
                  and it.kind in ('revaluation','exit')) then
      raise exception 'توجد عمليات تقييم/تخارج لاحقة على هذا الاستثمار — اعكسها أولاً';
    end if;
  elsif t.tx_type = 'withdrawal_payment' then
    raise exception 'لا يمكن عكس صرف سحب — سجّل إيداعاً تصحيحياً للعضو بدلاً من ذلك';
  end if;

  select * into e from public.journal_entries where financial_transaction_id = p_tx;
  v_rev := public._new_tx('reversal', v_date, 'عكس ' || t.tx_no || ': ' || trim(p_reason), t.amount,
                          t.member_id, t.loan_id, t.investment_id, null, null, null, p_tx);
  perform public._post(v_rev, v_date, 'عكس ' || t.tx_no || ': ' || trim(p_reason),
    (select jsonb_agg(jsonb_build_object('acct_id', account_id, 'dr', credit, 'cr', debit, 'm', member_id, 'memo', 'عكس'))
       from public.journal_entry_lines where entry_id = e.id), e.id);

  if t.tx_type = 'loan_repayment' then
    perform public._refresh_loan_status(t.loan_id);
  elsif t.tx_type = 'loan_disbursement' then
    update public.loans set status = 'cancelled', decision_note = 'عكس الصرف: ' || p_reason where id = t.loan_id;
  elsif t.tx_type = 'investment_exit' then
    update public.investments set status = 'active' where id = t.investment_id and status = 'exited';
  end if;
  if t.member_id is not null then
    perform public._notify_member(t.member_id, 'transaction_reversed', 'تصحيح على حسابك',
      'تم عكس العملية ' || t.tx_no || ': ' || trim(p_reason), '/member/transactions');
  end if;
  return v_rev;
end $$;

-- ---------------------------------------------------------------- access
alter table public.profit_distributions enable row level security;
alter table public.profit_distribution_lines enable row level security;
alter table public.fiscal_closes enable row level security;
revoke all on public.profit_distributions, public.profit_distribution_lines, public.fiscal_closes, public.v_profit_distributions from public, anon, authenticated;
grant select on public.profit_distributions, public.profit_distribution_lines, public.fiscal_closes, public.v_profit_distributions to authenticated;
create policy manager_read on public.profit_distributions for select to authenticated using ((select public.is_manager()));
create policy manager_read on public.profit_distribution_lines for select to authenticated using ((select public.is_manager()) or member_id = (select public.current_member_id()));
create policy manager_read on public.fiscal_closes for select to authenticated using ((select public.is_manager()));

revoke execute on function public.distributable_surplus(date), public.preview_profit_distribution(numeric,text,uuid[]),
  public.post_profit_distribution(text,numeric,text,text,date,uuid[],text), public.close_fiscal_period(text,int,int,text),
  public.reopen_fiscal_period(uuid,text), public._refresh_lock() from public, anon;
revoke execute on function public._refresh_lock() from authenticated;
grant execute on function public.distributable_surplus(date), public.preview_profit_distribution(numeric,text,uuid[]),
  public.post_profit_distribution(text,numeric,text,text,date,uuid[],text), public.close_fiscal_period(text,int,int,text),
  public.reopen_fiscal_period(uuid,text) to authenticated;
