-- =====================================================================
-- Core helpers, posting engine and derived (read) views
-- Balances are always DERIVED from posted, non-reversed transactions.
-- =====================================================================

-- ---------- identity helpers ----------
create or replace function public.current_app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.app_users where id = auth.uid() and is_active
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'manager', false)
$$;

create or replace function public.current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select m.id from public.members m join public.app_users u on u.id = m.user_id
   where u.id = auth.uid() and u.is_active
$$;

create or replace function public.assert_manager() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'غير مصرح: هذه العملية لمدير الصندوق فقط' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function public.assert_member() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  v := public.current_member_id();
  if v is null then raise exception 'غير مصرح: لا يوجد حساب عضو نشط' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.acct(p_key text) returns int
language plpgsql stable security definer set search_path = public as $$
declare v int;
begin
  select id into v from public.accounts where system_key = p_key;
  if v is null then raise exception 'حساب غير معروف: %', p_key; end if;
  return v;
end $$;

create or replace function public.settings() returns public.fund_settings
language sql stable security definer set search_path = public as $$ select * from public.fund_settings where id = 1 $$;

create or replace function public.money(p numeric) returns numeric
language plpgsql immutable as $$
begin
  if p is null or p <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p <> round(p, 2) then raise exception 'المبلغ يجب ألا يتجاوز منزلتين عشريتين'; end if;
  if p > 100000000 then raise exception 'المبلغ يتجاوز الحد المسموح'; end if;
  return p;
end $$;

-- ---------- transaction & journal engine ----------
create or replace function public._existing_tx(p_key text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.financial_transactions where p_key is not null and idempotency_key = p_key
$$;

create or replace function public._new_tx(
  p_type text, p_date date, p_desc text, p_amount numeric,
  p_member uuid default null, p_loan uuid default null, p_inv uuid default null,
  p_ref text default null, p_key text default null, p_doc uuid default null, p_reverses uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_date is null then raise exception 'تاريخ العملية مطلوب'; end if;
  if p_date > public.fund_today() + 1 then raise exception 'لا يمكن تسجيل عملية بتاريخ مستقبلي'; end if;
  insert into public.financial_transactions(tx_type, tx_date, description, amount, member_id, loan_id, investment_id,
              reference, idempotency_key, document_id, reverses_tx_id, created_by, approved_by)
  values (p_type, p_date, p_desc, p_amount, p_member, p_loan, p_inv, nullif(trim(p_ref),''), nullif(trim(p_key),''),
          p_doc, p_reverses, auth.uid(), auth.uid())
  returning id into v;
  return v;
end $$;

-- p_lines: [{"a":"cash","dr":100,"m":"<member uuid>","memo":"..."}, {"a":"member_deposits","cr":100}]
create or replace function public._post(p_tx uuid, p_date date, p_desc text, p_lines jsonb, p_reverses uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_entry uuid; l jsonb; d numeric; c numeric; td numeric := 0; tc numeric := 0;
begin
  insert into public.journal_entries(entry_date, description, financial_transaction_id, reverses_entry_id, created_by)
  values (p_date, p_desc, p_tx, p_reverses, auth.uid()) returning id into v_entry;
  for l in select * from jsonb_array_elements(p_lines) loop
    d := round(coalesce((l->>'dr')::numeric, 0), 2);
    c := round(coalesce((l->>'cr')::numeric, 0), 2);
    if d < 0 then c := c - d; d := 0; end if;     -- negative debit = credit
    if c < 0 then d := d - c; c := 0; end if;
    continue when d = 0 and c = 0;
    insert into public.journal_entry_lines(entry_id, account_id, member_id, debit, credit, memo)
    values (v_entry,
            coalesce((l->>'acct_id')::int,
                     (select id from public.accounts where code = l->>'code' and l ? 'code'),
                     public.acct(l->>'a')),
            nullif(l->>'m','')::uuid, d, c, l->>'memo');
    td := td + d; tc := tc + c;
  end loop;
  if td <> tc or td = 0 then
    raise exception 'قيد غير متوازن (مدين % / دائن %)', td, tc;
  end if;
  return v_entry;
end $$;

create or replace function public.account_balance(p_key text, p_as_of date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when a.normal_side = 'debit' then l.debit - l.credit else l.credit - l.debit end), 0)
    from public.journal_entry_lines l
    join public.accounts a on a.id = l.account_id
    join public.journal_entries e on e.id = l.entry_id
   where a.system_key = p_key and (p_as_of is null or e.entry_date <= p_as_of)
$$;

create or replace function public._assert_cash(p_amount numeric) returns void
language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  if (public.settings()).allow_negative_cash then return; end if;
  v := public.account_balance('cash');
  if v < p_amount then
    raise exception 'الرصيد النقدي المتاح (% ريال) لا يكفي لهذه العملية (% ريال)', v, p_amount;
  end if;
end $$;

create or replace function public._notify(p_user uuid, p_type text, p_title text, p_body text,
                                           p_link text default null, p_dedupe text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ch jsonb;
begin
  if p_user is null then return; end if;
  insert into public.notifications(user_id, type, title, body, link, dedupe_key)
  values (p_user, p_type, p_title, p_body, p_link, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then return; end if;
  v_ch := (public.settings()).notification_prefs -> 'channels';
  insert into public.notification_deliveries(notification_id, channel)
  select v_id, ch from unnest(array['email','sms','whatsapp']) ch where coalesce((v_ch->>ch)::boolean, false);
end $$;

create or replace function public._notify_member(p_member uuid, p_type text, p_title text, p_body text,
                                                  p_link text default null, p_dedupe text default null) returns void
language sql security definer set search_path = public as $$
  select public._notify((select user_id from public.members where id = p_member), p_type, p_title, p_body, p_link, p_dedupe)
$$;

create or replace function public._notify_managers(p_type text, p_title text, p_body text, p_link text default null) returns void
language sql security definer set search_path = public as $$
  select public._notify(id, p_type, p_title, p_body, p_link, null) from public.app_users where role = 'manager' and is_active
$$;

create or replace function public._log(p_action text, p_entity text, p_id text, p_new jsonb default null, p_old jsonb default null, p_note text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs(actor_id, action, entity, entity_id, old_data, new_data, note)
  values (auth.uid(), p_action, p_entity, p_id, p_old, p_new, p_note)
$$;

-- =====================================================================
-- Derived views (security_invoker => RLS of the querying user applies)
-- =====================================================================
create or replace view public.v_active_tx with (security_invoker = true) as
  select t.* from public.financial_transactions t
   where t.reverses_tx_id is null
     and not exists (select 1 from public.financial_transactions r where r.reverses_tx_id = t.id);

create or replace view public.v_transactions with (security_invoker = true) as
  select t.*, m.full_name as member_name, m.member_no,
         exists (select 1 from public.financial_transactions r where r.reverses_tx_id = t.id) as is_reversed,
         (select e.entry_no from public.journal_entries e where e.financial_transaction_id = t.id) as entry_no,
         (select u.full_name from public.app_users u where u.id = t.created_by) as created_by_name
    from public.financial_transactions t
    left join public.members m on m.id = t.member_id;

create or replace view public.v_contribution_status with (security_invoker = true) as
  select c.*, m.full_name as member_name, m.member_no,
         coalesce(p.paid, 0) as amount_paid,
         c.amount_due - coalesce(p.paid, 0) as amount_outstanding,
         p.last_paid_on,
         case when coalesce(p.paid,0) >= c.amount_due then 'paid'
              when coalesce(p.paid,0) > 0 then 'partial'
              when c.due_date < public.fund_today() then 'overdue'
              else 'unpaid' end as status,
         (coalesce(p.paid,0) < c.amount_due and c.due_date < public.fund_today()) as is_overdue
    from public.contributions c
    join public.members m on m.id = c.member_id
    left join lateral (
      select sum(cp.amount) as paid, max(cp.paid_on) as last_paid_on
        from public.contribution_payments cp
        join public.v_active_tx t on t.id = cp.financial_transaction_id
       where cp.contribution_id = c.id
    ) p on true;

create or replace view public.v_installment_status with (security_invoker = true) as
  with r as (
    select lr.loan_id, sum(lr.amount) as repaid
      from public.loan_repayments lr join public.v_active_tx t on t.id = lr.financial_transaction_id
     group by lr.loan_id
  ), x as (
    select i.*, sum(i.amount_due) over (partition by i.loan_id order by i.seq) as cum_due, coalesce(r.repaid,0) as repaid
      from public.loan_installments i left join r on r.loan_id = i.loan_id
  )
  select x.id, x.loan_id, x.seq, x.due_date, x.amount_due,
         least(x.amount_due, greatest(0, x.repaid - (x.cum_due - x.amount_due))) as amount_paid,
         x.amount_due - least(x.amount_due, greatest(0, x.repaid - (x.cum_due - x.amount_due))) as amount_remaining,
         case when x.repaid >= x.cum_due then 'paid'
              when x.due_date + (select loan_grace_days from public.fund_settings where id = 1) < public.fund_today() then 'overdue'
              when x.repaid > x.cum_due - x.amount_due then 'partial'
              else 'upcoming' end as status
    from x;

create or replace view public.v_loan_summary with (security_invoker = true) as
  select l.*, m.full_name as member_name, m.member_no,
         case when d.ok then l.approved_amount + l.fee_amount else 0 end as total_repayable,
         coalesce(r.repaid, 0) as amount_repaid,
         case when d.ok then l.approved_amount + l.fee_amount - coalesce(r.repaid,0) else 0 end as outstanding,
         s.next_due_date, s.next_due_amount, coalesce(s.overdue_amount,0) as overdue_amount,
         coalesce(s.overdue_count,0) as overdue_count, coalesce(s.paid_count,0) as paid_count
    from public.loans l
    join public.members m on m.id = l.member_id
    left join lateral (select exists (select 1 from public.v_active_tx t where t.id = l.disbursement_tx_id) as ok) d on true
    left join lateral (
      select sum(lr.amount) as repaid from public.loan_repayments lr
        join public.v_active_tx t on t.id = lr.financial_transaction_id where lr.loan_id = l.id
    ) r on true
    left join lateral (
      select min(due_date) filter (where status <> 'paid') as next_due_date,
             (array_agg(amount_remaining order by seq) filter (where status <> 'paid'))[1] as next_due_amount,
             sum(amount_remaining) filter (where status = 'overdue') as overdue_amount,
             count(*) filter (where status = 'overdue') as overdue_count,
             count(*) filter (where status = 'paid') as paid_count
        from public.v_installment_status where loan_id = l.id
    ) s on true;

create or replace view public.v_member_balances with (security_invoker = true) as
  select m.id as member_id, m.member_no, m.full_name, m.status, m.join_date, m.user_id,
         coalesce(cp.total,0) as contributions_total,
         coalesce(cp.ytd,0)   as contributions_ytd,
         coalesce(co.outstanding,0) as contributions_overdue,
         coalesce(co.overdue_months,0) as contributions_overdue_months,
         coalesce(dp.total,0) as deposits_total,
         coalesce(wd.paid,0)  as withdrawals_paid,
         coalesce(dp.total,0) - coalesce(wd.paid,0) as deposit_balance,
         coalesce(wd.pending,0) as withdrawals_pending,
         coalesce(dp.total,0) - coalesce(wd.paid,0) - coalesce(wd.pending,0) as available_to_withdraw,
         coalesce(ln.outstanding,0) as loan_outstanding,
         coalesce(ln.active_count,0) as active_loans
    from public.members m
    left join lateral (
      select sum(p.amount) total,
             sum(p.amount) filter (where extract(year from p.paid_on) = extract(year from public.fund_today())) ytd
        from public.contribution_payments p join public.v_active_tx t on t.id = p.financial_transaction_id
       where p.member_id = m.id) cp on true
    left join lateral (
      select sum(amount_outstanding) outstanding, count(*) overdue_months
        from public.v_contribution_status where member_id = m.id and is_overdue) co on true
    left join lateral (
      select sum(d.amount) total from public.member_deposits d join public.v_active_tx t on t.id = d.financial_transaction_id
       where d.member_id = m.id and d.status = 'confirmed') dp on true
    left join lateral (
      select sum(w.amount) filter (where w.status = 'paid' and exists (select 1 from public.v_active_tx t where t.id = w.financial_transaction_id)) paid,
             sum(w.amount) filter (where w.status in ('pending','approved')) pending
        from public.deposit_withdrawals w where w.member_id = m.id) wd on true
    left join lateral (
      select sum(outstanding) outstanding, count(*) active_count from public.v_loan_summary
       where member_id = m.id and status in ('disbursed','active','overdue')) ln on true;

create or replace view public.v_investment_positions with (security_invoker = true) as
  select i.*,
         coalesce(x.cost,0) as cost_basis,
         coalesce(x.unrealized,0) as unrealized_pl,
         coalesce(x.cost,0) + coalesce(x.unrealized,0) as current_value,
         coalesce(x.realized,0) as realized_pl,
         coalesce(x.income,0) as income_received,
         coalesce(x.invested,0) as total_invested,
         coalesce(x.returned,0) as total_returned,
         x.last_valuation_date
    from public.investments i
    left join lateral (
      select sum(it.cost_delta) cost, sum(it.unrealized_delta) unrealized, sum(it.realized_pl) realized,
             sum(it.cash_amount) filter (where it.kind = 'income') income,
             sum(it.cash_amount) filter (where it.kind = 'capital_in') invested,
             sum(it.cash_amount) filter (where it.kind = 'exit') returned,
             max(it.tx_date) filter (where it.kind = 'revaluation') last_valuation_date
        from public.investment_transactions it join public.v_active_tx t on t.id = it.financial_transaction_id
       where it.investment_id = i.id) x on true;

create or replace view public.v_account_balances with (security_invoker = true) as
  select a.id, a.code, a.system_key, a.name_ar, a.name_en, a.type, a.normal_side,
         coalesce(sum(l.debit),0) as total_debit, coalesce(sum(l.credit),0) as total_credit,
         case when a.normal_side = 'debit' then coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0)
              else coalesce(sum(l.credit),0) - coalesce(sum(l.debit),0) end as balance
    from public.accounts a left join public.journal_entry_lines l on l.account_id = a.id
   group by a.id;

create or replace view public.v_journal with (security_invoker = true) as
  select e.entry_no, e.entry_date, e.description, e.id as entry_id, e.reverses_entry_id,
         t.tx_no, t.tx_type, t.id as transaction_id,
         l.id as line_id, a.code as account_code, a.name_ar as account_name, l.debit, l.credit, l.memo,
         m.full_name as member_name
    from public.journal_entries e
    join public.financial_transactions t on t.id = e.financial_transaction_id
    join public.journal_entry_lines l on l.entry_id = e.id
    join public.accounts a on a.id = l.account_id
    left join public.members m on m.id = l.member_id;
