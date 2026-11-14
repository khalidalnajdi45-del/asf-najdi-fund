-- =====================================================================
-- Dashboards, financial statements and reports (read-only)
-- =====================================================================

create or replace function public._bal_between(p_key text, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when a.normal_side = 'debit' then l.debit - l.credit else l.credit - l.debit end), 0)
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    join public.journal_entries e on e.id = l.entry_id
   where a.system_key = p_key and e.entry_date between p_from and p_to
$$;

create or replace function public._type_bal(p_type text, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when a.normal_side = 'debit' then l.debit - l.credit else l.credit - l.debit end), 0)
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id
    join public.journal_entries e on e.id = l.entry_id
   where a.type = p_type and e.entry_date between coalesce(p_from, date '1900-01-01') and p_to
$$;

-- ---------- trial balance ----------
create or replace function public.report_trial_balance(p_as_of date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_as date := coalesce(p_as_of, public.fund_today()); v jsonb;
begin
  perform public.assert_manager();
  select jsonb_build_object('as_of', v_as,
    'rows', coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name_ar, 'type', type, 'debit', d, 'credit', c) order by code), '[]'),
    'total_debit', coalesce(sum(d),0), 'total_credit', coalesce(sum(c),0))
  into v
  from (
    select a.code, a.name_ar, a.type,
           greatest(sum(l.debit) - sum(l.credit), 0) d, greatest(sum(l.credit) - sum(l.debit), 0) c
      from public.accounts a join public.journal_entry_lines l on l.account_id = a.id
      join public.journal_entries e on e.id = l.entry_id
     where e.entry_date <= v_as group by a.id
  ) x;
  return v;
end $$;

-- ---------- balance sheet ----------
create or replace function public.report_balance_sheet(p_as_of date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_as date := coalesce(p_as_of, public.fund_today()); v_ni numeric; v_rows jsonb;
begin
  perform public.assert_manager();
  v_ni := public._type_bal('income', null, v_as) - public._type_bal('expense', null, v_as);
  select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name_ar, 'type', a.type,
           'balance', public.account_balance(a.system_key, v_as)) order by a.code), '[]')
    into v_rows from public.accounts a where a.type in ('asset','liability','equity');
  return jsonb_build_object(
    'as_of', v_as, 'accounts', v_rows, 'current_surplus', v_ni,
    'total_assets', (select coalesce(sum((r->>'balance')::numeric),0) from jsonb_array_elements(v_rows) r where r->>'type' = 'asset'),
    'total_liabilities', (select coalesce(sum((r->>'balance')::numeric),0) from jsonb_array_elements(v_rows) r where r->>'type' = 'liability'),
    'total_equity', (select coalesce(sum((r->>'balance')::numeric),0) from jsonb_array_elements(v_rows) r where r->>'type' = 'equity') + v_ni);
end $$;

-- ---------- income statement ----------
create or replace function public.report_income_statement(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  perform public.assert_manager();
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name_ar, 'type', type,
           'amount', public._bal_between(system_key, p_from, p_to)) order by code), '[]')
    into v_rows from public.accounts where type in ('income','expense');
  return jsonb_build_object('from', p_from, 'to', p_to, 'accounts', v_rows,
    'total_income', public._type_bal('income', p_from, p_to),
    'total_expense', public._type_bal('expense', p_from, p_to),
    'net_surplus', public._type_bal('income', p_from, p_to) - public._type_bal('expense', p_from, p_to),
    'unrealized_change', public._bal_between('unrealized_reserve', p_from, p_to),
    'note', 'الأرباح غير المحققة لا تدخل في الفائض، وتظهر في احتياطي حقوق الملكية');
end $$;

-- ---------- cash flow (direct method from the cash account) ----------
create or replace function public.report_cash_flow(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open numeric; v_rows jsonb;
begin
  perform public.assert_manager();
  v_open := public.account_balance('cash', p_from - 1);
  select coalesce(jsonb_agg(jsonb_build_object('category', cat, 'inflow', i, 'outflow', o, 'net', i - o) order by cat), '[]')
    into v_rows
    from (
      select coalesce(orig.tx_type, t.tx_type) as cat, sum(l.debit) i, sum(l.credit) o
        from public.journal_entry_lines l
        join public.journal_entries e on e.id = l.entry_id
        join public.financial_transactions t on t.id = e.financial_transaction_id
        left join public.financial_transactions orig on orig.id = t.reverses_tx_id
       where l.account_id = public.acct('cash') and e.entry_date between p_from and p_to
       group by 1
    ) x;
  return jsonb_build_object('from', p_from, 'to', p_to, 'opening_cash', v_open, 'lines', v_rows,
    'closing_cash', public.account_balance('cash', p_to),
    'net_change', public.account_balance('cash', p_to) - v_open);
end $$;

-- ---------- liquidity ----------
create or replace function public.report_liquidity() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cash numeric := public.account_balance('cash'); v_dep numeric := public.account_balance('member_deposits');
        v_refund numeric := public.account_balance('contrib_refundable');
        v_pend_w numeric; v_commit numeric; v_in30 numeric; v_in90 numeric; v_mat90 numeric;
begin
  perform public.assert_manager();
  select coalesce(sum(amount),0) into v_pend_w from public.deposit_withdrawals where status in ('pending','approved');
  select coalesce(sum(approved_amount),0) into v_commit from public.loans where status = 'approved';
  select coalesce(sum(amount_remaining) filter (where due_date <= public.fund_today() + 30),0),
         coalesce(sum(amount_remaining) filter (where due_date <= public.fund_today() + 90),0)
    into v_in30, v_in90 from public.v_installment_status i join public.loans l on l.id = i.loan_id
   where i.status <> 'paid' and l.status in ('disbursed','active','overdue');
  select coalesce(sum(current_value),0) into v_mat90 from public.v_investment_positions
   where status = 'active' and maturity_date <= public.fund_today() + 90;
  return jsonb_build_object(
    'cash', v_cash, 'member_deposits', v_dep, 'refundable_contributions', v_refund,
    'pending_withdrawals', v_pend_w, 'approved_undisbursed_loans', v_commit,
    'free_cash', v_cash - v_pend_w - v_commit,
    'deposit_coverage_ratio', case when v_dep > 0 then round(v_cash / v_dep, 4) end,
    'expected_repayments_30d', v_in30, 'expected_repayments_90d', v_in90,
    'investments_maturing_90d', v_mat90);
end $$;

-- ---------- contributions matrix (members x months) ----------
create or replace function public.report_contribution_matrix(p_year int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_manager();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'member_no', m.member_no, 'name', m.full_name,
             'months', (select coalesce(jsonb_object_agg(extract(month from c.period)::int,
                         jsonb_build_object('due', c.amount_due, 'paid', c.amount_paid, 'status', c.status)), '{}')
                          from public.v_contribution_status c
                         where c.member_id = m.id and extract(year from c.period) = p_year),
             'total_paid', (select coalesce(sum(amount_paid),0) from public.v_contribution_status c
                             where c.member_id = m.id and extract(year from c.period) = p_year),
             'total_due', (select coalesce(sum(amount_due),0) from public.v_contribution_status c
                            where c.member_id = m.id and extract(year from c.period) = p_year and c.due_date <= public.fund_today()))
           order by m.member_no), '[]')
      from public.members m);
end $$;

-- ---------- period summary (monthly / annual report) ----------
create or replace function public.report_period_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_manager();
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'income_statement', public.report_income_statement(p_from, p_to),
    'cash_flow', public.report_cash_flow(p_from, p_to),
    'balance_sheet', public.report_balance_sheet(p_to),
    'contributions', (select jsonb_build_object('due', coalesce(sum(amount_due),0), 'collected', coalesce(sum(amount_paid),0),
                        'members_due', count(distinct member_id), 'members_fully_paid', count(*) filter (where status = 'paid'))
                        from public.v_contribution_status where period between date_trunc('month', p_from)::date and p_to),
    'activity', (select jsonb_object_agg(tx_type, jsonb_build_object('count', n, 'amount', amt))
                   from (select tx_type, count(*) n, sum(amount) amt from public.v_active_tx
                          where tx_date between p_from and p_to group by tx_type) x),
    'new_loans', (select count(*) from public.loans where disbursed_on between p_from and p_to),
    'new_members', (select count(*) from public.members where join_date between p_from and p_to));
end $$;

-- ---------- member statement ----------
create or replace function public.member_statement(p_member uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_mine uuid := public.current_member_id();
begin
  if not public.is_manager() and (v_mine is null or v_mine <> p_member) then
    raise exception 'غير مصرح بعرض كشف حساب عضو آخر' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'member', (select to_jsonb(m) - 'notes' - 'created_by' from public.members m where id = p_member),
    'from', p_from, 'to', p_to, 'generated_at', now(),
    'fund_name', (public.settings()).fund_name,
    'balances', (select to_jsonb(b) from public.v_member_balances b where member_id = p_member),
    'opening', jsonb_build_object(
       'contributions', (select coalesce(sum(p.amount),0) from public.contribution_payments p join public.v_active_tx t on t.id = p.financial_transaction_id
                          where p.member_id = p_member and p.paid_on < p_from),
       'deposits', (select coalesce(sum(case when t.tx_type = 'deposit' then t.amount else -t.amount end),0)
                      from public.v_active_tx t where t.member_id = p_member and t.tx_type in ('deposit','withdrawal_payment') and t.tx_date < p_from),
       'loans', (select coalesce(sum(case when t.tx_type = 'loan_disbursement' then l.approved_amount + l.fee_amount else -t.amount end),0)
                   from public.v_active_tx t left join public.loans l on l.id = t.loan_id
                  where t.member_id = p_member and t.tx_type in ('loan_disbursement','loan_repayment') and t.tx_date < p_from)),
    'transactions', (select coalesce(jsonb_agg(jsonb_build_object('tx_no', tx_no, 'date', tx_date, 'type', tx_type,
                       'description', description, 'amount', amount, 'reference', reference, 'is_reversed', is_reversed,
                       'reverses_tx_id', reverses_tx_id) order by tx_date, tx_no), '[]')
                       from public.v_transactions where member_id = p_member and tx_date between p_from and p_to),
    'contributions', (select coalesce(jsonb_agg(jsonb_build_object('period', period, 'due', amount_due, 'paid', amount_paid, 'status', status)
                        order by period), '[]') from public.v_contribution_status
                       where member_id = p_member and period between date_trunc('month', p_from)::date and p_to),
    'loans', (select coalesce(jsonb_agg(jsonb_build_object('loan_no', loan_no, 'status', status, 'approved', approved_amount,
                'repaid', amount_repaid, 'outstanding', outstanding, 'next_due_date', next_due_date)), '[]')
                from public.v_loan_summary where member_id = p_member and status in ('disbursed','active','overdue','fully_repaid')));
end $$;

-- ---------- dashboards ----------
create or replace function public.manager_dashboard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cash numeric; v_loans numeric; v_inv_cost numeric; v_inv_fv numeric; v_dep numeric; v_other numeric; v_refund numeric;
        v_period date := date_trunc('month', public.fund_today())::date;
begin
  perform public.assert_manager();
  perform public.run_daily_jobs();
  v_cash := public.account_balance('cash'); v_loans := public.account_balance('loans_receivable');
  v_inv_cost := public.account_balance('investments_cost'); v_inv_fv := public.account_balance('investments_fv');
  v_dep := public.account_balance('member_deposits'); v_other := public.account_balance('other_liabilities');
  v_refund := public.account_balance('contrib_refundable');
  return jsonb_build_object(
    'demo_mode', (public.settings()).demo_mode,
    'total_assets', v_cash + v_loans + v_inv_cost + v_inv_fv,
    'cash', v_cash,
    'contributions_total', public.account_balance('contrib_capital') + v_refund,
    'deposits_total', v_dep,
    'loans_outstanding', v_loans,
    'investments_total', v_inv_cost + v_inv_fv,
    'investments_cost', v_inv_cost,
    'realized_investment_pl', public.account_balance('investment_income') - public.account_balance('investment_losses'),
    'unrealized_investment_pl', v_inv_fv,
    'loan_fee_income', public.account_balance('loan_fee_income'),
    'operating_expenses', public.account_balance('operating_expenses'),
    'total_liabilities', v_dep + v_other + v_refund,
    'net_position', v_cash + v_loans + v_inv_cost + v_inv_fv - (v_dep + v_other + v_refund),
    'active_members', (select count(*) from public.members where status = 'active'),
    'collection', (select jsonb_build_object('due', coalesce(sum(amount_due),0), 'paid', coalesce(sum(amount_paid),0),
                     'rate', case when sum(amount_due) > 0 then round(sum(amount_paid) / sum(amount_due), 4) else 0 end,
                     'paid_members', count(*) filter (where status = 'paid'), 'members', count(*))
                     from public.v_contribution_status where period = v_period),
    'collection_trend', (select coalesce(jsonb_agg(jsonb_build_object('period', p, 'rate', rate) order by p), '[]') from (
                     select period p, case when sum(amount_due) > 0 then round(sum(amount_paid)/sum(amount_due), 4) else 0 end rate
                       from public.v_contribution_status where period > v_period - interval '6 months' group by period) x),
    'cash_flow', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'inflow', coalesce(i,0), 'outflow', coalesce(o,0)) order by m), '[]')
                    from (select gs::date m from generate_series(v_period - interval '11 months', v_period, interval '1 month') gs) months
                    left join lateral (
                      select sum(l.debit) i, sum(l.credit) o from public.journal_entry_lines l
                        join public.journal_entries e on e.id = l.entry_id
                       where l.account_id = public.acct('cash') and date_trunc('month', e.entry_date) = months.m) c on true),
    'investments_by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'value', v)), '[]') from (
                     select category, sum(current_value) v from public.v_investment_positions where status <> 'exited' group by category) x),
    'recent_transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.tx_date desc, t.tx_no desc), '[]') from (
                     select id, tx_no, tx_type, tx_date, description, amount, member_name, is_reversed, created_at
                       from public.v_transactions order by tx_date desc, tx_no desc limit 8) t),
    'pending_loans', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'loan_no', loan_no, 'member_name', member_name,
                     'amount', coalesce(approved_amount, requested_amount), 'status', status, 'date', request_date) order by request_date), '[]')
                     from public.v_loan_summary where status in ('pending','approved')),
    'pending_withdrawals', (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'member_name', m.full_name, 'amount', w.amount,
                     'status', w.status, 'date', w.requested_at) order by w.requested_at), '[]')
                     from public.deposit_withdrawals w join public.members m on m.id = w.member_id where w.status in ('pending','approved')),
    'pending_deposits', (select count(*) from public.member_deposits where status = 'requested'),
    'overdue_installments', (select coalesce(jsonb_agg(jsonb_build_object('loan_id', l.id, 'loan_no', l.loan_no, 'member_name', m.full_name,
                     'seq', i.seq, 'due_date', i.due_date, 'amount', i.amount_remaining) order by i.due_date), '[]')
                     from public.v_installment_status i join public.loans l on l.id = i.loan_id join public.members m on m.id = l.member_id
                     where i.status = 'overdue' and l.status in ('disbursed','active','overdue')),
    'overdue_contributions', (select coalesce(sum(amount_outstanding),0) from public.v_contribution_status where is_overdue)
  );
end $$;

create or replace function public.member_dashboard(p_member uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m uuid; v_uid uuid; v_period date := date_trunc('month', public.fund_today())::date;
begin
  if p_member is null then v_m := public.assert_member();
  else perform public.assert_manager(); v_m := p_member; end if;
  select user_id into v_uid from public.members where id = v_m;
  return jsonb_build_object(
    'member', (select to_jsonb(m) - 'notes' - 'created_by' from public.members m where id = v_m),
    'balances', (select to_jsonb(b) from public.v_member_balances b where member_id = v_m),
    'current_contribution', (select to_jsonb(c) from public.v_contribution_status c where member_id = v_m and period = v_period),
    'year_contributions', (select coalesce(jsonb_agg(jsonb_build_object('period', period, 'due', amount_due, 'paid', amount_paid, 'status', status) order by period), '[]')
                             from public.v_contribution_status where member_id = v_m and extract(year from period) = extract(year from public.fund_today())),
    'active_loan', (select to_jsonb(l) from public.v_loan_summary l where member_id = v_m and status in ('disbursed','active','overdue') order by disbursed_on desc limit 1),
    'pending', jsonb_build_object(
       'deposits', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'date', requested_at)), '[]') from public.member_deposits where member_id = v_m and status = 'requested'),
       'withdrawals', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'status', status, 'date', requested_at)), '[]') from public.deposit_withdrawals where member_id = v_m and status in ('pending','approved')),
       'loans', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'loan_no', loan_no, 'amount', coalesce(approved_amount, requested_amount), 'status', status)), '[]') from public.loans where member_id = v_m and status in ('pending','approved'))),
    'recent_transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.tx_date desc, t.tx_no desc), '[]') from (
                             select id, tx_no, tx_type, tx_date, description, amount, is_reversed, created_at from public.v_transactions
                              where member_id = v_m order by tx_date desc, tx_no desc limit 8) t),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]') from (
                        select id, type, title, body, link, is_read, created_at from public.notifications where user_id = v_uid order by created_at desc limit 5) n),
    'unread_count', (select count(*) from public.notifications where user_id = v_uid and not is_read)
  );
end $$;

-- ---------- consistency checks ----------
create or replace function public.integrity_check() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is not null then perform public.assert_manager(); end if;
  with checks as (
    select 'journal_balanced' as k,
           (select coalesce(sum(debit),0) = coalesce(sum(credit),0) from public.journal_entry_lines) as ok,
           (select count(*) from (select entry_id from public.journal_entry_lines group by entry_id having sum(debit) <> sum(credit)) x)::text as detail
    union all
    select 'member_deposits_reconcile',
           public.account_balance('member_deposits') = (select coalesce(sum(deposit_balance),0) from public.v_member_balances),
           public.account_balance('member_deposits')::text || ' vs ' || (select coalesce(sum(deposit_balance),0) from public.v_member_balances)::text
    union all
    select 'loans_reconcile',
           public.account_balance('loans_receivable') = (select coalesce(sum(outstanding),0) from public.v_loan_summary),
           public.account_balance('loans_receivable')::text || ' vs ' || (select coalesce(sum(outstanding),0) from public.v_loan_summary)::text
    union all
    select 'investments_reconcile',
           public.account_balance('investments_cost') + public.account_balance('investments_fv')
             = (select coalesce(sum(current_value),0) from public.v_investment_positions),
           (public.account_balance('investments_cost') + public.account_balance('investments_fv'))::text || ' vs ' ||
             (select coalesce(sum(current_value),0) from public.v_investment_positions)::text
    union all
    select 'contributions_reconcile',
           public.account_balance('contrib_capital') + public.account_balance('contrib_refundable')
             = (select coalesce(sum(contributions_total),0) from public.v_member_balances),
           (public.account_balance('contrib_capital') + public.account_balance('contrib_refundable'))::text || ' vs ' ||
             (select coalesce(sum(contributions_total),0) from public.v_member_balances)::text
    union all
    select 'every_tx_has_entry',
           not exists (select 1 from public.financial_transactions t where not exists (select 1 from public.journal_entries e where e.financial_transaction_id = t.id)),
           ''
    union all
    select 'balance_sheet_equation',
           public._type_bal('asset', null, public.fund_today() + 3650)
             = public._type_bal('liability', null, public.fund_today() + 3650) + public._type_bal('equity', null, public.fund_today() + 3650)
               + public._type_bal('income', null, public.fund_today() + 3650) - public._type_bal('expense', null, public.fund_today() + 3650),
           ''
  )
  select jsonb_build_object('ok', bool_and(ok), 'checks', jsonb_agg(jsonb_build_object('check', k, 'ok', ok, 'detail', detail))) into v from checks;
  return v;
end $$;
