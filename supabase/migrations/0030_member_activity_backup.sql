-- 0030 Members' monthly activity (contributions, loans, repayments, deposits, withdrawals)
-- + a monthly e-mailed backup to the fund's own mailbox.
alter table public.fund_settings add column if not exists backup_email text check (backup_email is null or backup_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
alter table public.fund_settings add column if not exists backup_enabled boolean not null default true;

/** member × month × kind, from live (non-reversed) transactions only. */
create or replace function public._member_activity(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (
    select member_id, to_char(tx_date, 'YYYY-MM') mon,
           sum(amount) filter (where tx_type = 'contribution_payment') contrib,
           sum(amount) filter (where tx_type = 'loan_disbursement')    loans,
           sum(amount) filter (where tx_type = 'loan_repayment')       repay,
           sum(amount) filter (where tx_type = 'deposit')              dep,
           sum(amount) filter (where tx_type = 'withdrawal_payment')   wd
      from public.v_active_tx
     where member_id is not null and tx_date between p_from and p_to
     group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'member_no', m.member_no, 'name', m.full_name,
           'months', coalesce((select jsonb_object_agg(t.mon, jsonb_build_object(
               'contrib', coalesce(t.contrib,0), 'loans', coalesce(t.loans,0), 'repay', coalesce(t.repay,0),
               'dep', coalesce(t.dep,0), 'wd', coalesce(t.wd,0))) from t where t.member_id = m.id), '{}'::jsonb))
         order by m.member_no), '[]'::jsonb)
    from public.members m
$$;
revoke execute on function public._member_activity(date, date) from public, anon, authenticated;

create or replace function public.report_member_activity(p_year int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_manager();
  return public._member_activity(make_date(p_year, 1, 1), make_date(p_year, 12, 31));
end $$;
revoke execute on function public.report_member_activity(int) from public, anon;
grant execute on function public.report_member_activity(int) to authenticated;

create or replace function public.set_backup_settings(p_email text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_manager();
  update public.fund_settings set backup_email = nullif(trim(p_email), ''), backup_enabled = coalesce(p_enabled, true),
         updated_at = now(), updated_by = auth.uid() where id = 1;
end $$;
revoke execute on function public.set_backup_settings(text, boolean) from public, anon;
grant execute on function public.set_backup_settings(text, boolean) to authenticated;

/** Everything the monthly backup e-mail carries (service_role only — called by the Edge Function). */
create or replace function public.backup_payload(p_period date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m0 date := date_trunc('month', coalesce(p_period, (public.fund_today() - interval '1 month')::date))::date;
  m1 date := (m0 + interval '1 month - 1 day')::date;
  y0 date := date_trunc('year', m0)::date;
begin
  return jsonb_build_object(
    'period', m0, 'period_end', m1,
    'settings', (select jsonb_build_object('fund_name', fund_name, 'backup_email', backup_email, 'backup_enabled', backup_enabled) from public.fund_settings where id = 1),
    'activity_ytd', public._member_activity(y0, m1),
    'transactions', (select coalesce(jsonb_agg(jsonb_build_object('tx_no', t.tx_no, 'date', t.tx_date, 'type', t.tx_type, 'amount', t.amount,
                        'member', m.full_name, 'member_no', m.member_no, 'description', t.description, 'reference', t.reference,
                        'reversed', exists (select 1 from public.financial_transactions r where r.reverses_tx_id = t.id))
                        order by t.tx_date, t.tx_no), '[]'::jsonb)
                       from public.financial_transactions t left join public.members m on m.id = t.member_id
                      where t.tx_date between m0 and m1),
    'balances', (select coalesce(jsonb_agg(to_jsonb(b) order by b.member_no), '[]'::jsonb) from public.v_member_balances b),
    'loans', (select coalesce(jsonb_agg(jsonb_build_object('loan_no', l.loan_no, 'member', l.member_name, 'status', l.status,
                 'approved', l.approved_amount, 'repaid', l.amount_repaid, 'outstanding', l.outstanding, 'overdue', l.overdue_amount,
                 'disbursed_on', l.disbursed_on, 'next_due', l.next_due_date) order by l.loan_no), '[]'::jsonb)
                from public.v_loan_summary l where l.status in ('disbursed','active','overdue','fully_repaid','approved'))
  );
end $$;
revoke execute on function public.backup_payload(date) from public, anon, authenticated;
do $$ begin grant execute on function public.backup_payload(date) to service_role; exception when undefined_object then null; end $$;
