-- =====================================================================
-- Row-level security & privileges.
-- Clients get SELECT only (filtered by RLS). ALL writes go through the
-- SECURITY DEFINER functions above, which enforce role & business rules.
-- =====================================================================

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Table owner (postgres) runs the SECURITY DEFINER API and is not subject to RLS (no FORCE).

revoke all on all sequences in schema public from public, anon, authenticated;

-- Manager-only tables
do $$
declare t text;
begin
  foreach t in array array['accounts','journal_entries','journal_entry_lines','investments','investment_transactions',
                           'expenses','audit_logs','notification_deliveries']
  loop
    execute format('create policy manager_read on public.%I for select to authenticated using ((select public.is_manager()))', t);
  end loop;
end $$;

-- Everyone signed-in can read fund settings (policies & amounts are shown to members)
create policy read_all on public.fund_settings for select to authenticated using (true);

-- Own row or manager
create policy own_or_manager on public.app_users for select to authenticated
  using (id = (select auth.uid()) or (select public.is_manager()));
create policy own_or_manager on public.members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_manager()));
create policy own_or_manager on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- Member-scoped financial rows
do $$
declare t text;
begin
  foreach t in array array['contributions','contribution_payments','member_deposits','deposit_withdrawals','loans',
                           'loan_repayments','financial_transactions','documents']
  loop
    execute format('create policy own_or_manager on public.%I for select to authenticated
                      using (member_id = (select public.current_member_id()) or (select public.is_manager()))', t);
  end loop;
end $$;

create policy own_or_manager on public.loan_installments for select to authenticated
  using ((select public.is_manager()) or exists (select 1 from public.loans l where l.id = loan_id
                                                  and l.member_id = (select public.current_member_id())));

-- Views run with the caller's privileges
grant select on public.v_active_tx, public.v_transactions, public.v_contribution_status, public.v_installment_status,
                public.v_loan_summary, public.v_member_balances, public.v_investment_positions,
                public.v_account_balances, public.v_journal to authenticated;
revoke all on public.v_active_tx, public.v_transactions, public.v_contribution_status, public.v_installment_status,
              public.v_loan_summary, public.v_member_balances, public.v_investment_positions,
              public.v_account_balances, public.v_journal from anon;

-- Functions: nothing is callable by default…
revoke execute on all functions in schema public from public, anon, authenticated;

-- …except helpers used inside RLS policies / views
grant execute on function public.is_manager(), public.current_member_id(), public.current_app_role(), public.fund_today()
  to authenticated;

-- …and the public API (each function checks the caller's role itself)
grant execute on function
  public.admin_create_member(text,text,text,text,date,text),
  public.admin_update_member(uuid,text,text,text,text),
  public.admin_reset_password(uuid,text),
  public.update_my_profile(text,text),
  public.generate_contribution_obligations(date),
  public.record_contribution_payment(uuid,date,numeric,date,text,text),
  public.request_deposit(numeric,text,text),
  public.record_deposit(uuid,numeric,date,text,text,text),
  public.confirm_deposit(uuid,date,text,text),
  public.reject_deposit(uuid,text),
  public.request_withdrawal(numeric,text),
  public.approve_withdrawal(uuid,text),
  public.reject_withdrawal(uuid,text),
  public.pay_withdrawal(uuid,date,text,text),
  public.cancel_my_request(text,uuid),
  public.request_loan(numeric,text,int,text),
  public.approve_loan(uuid,numeric,int,text,numeric,date,text),
  public.reject_loan(uuid,text),
  public.cancel_loan(uuid,text),
  public.disburse_loan(uuid,date,text,text),
  public.record_loan_repayment(uuid,numeric,date,text,text),
  public.refresh_loan_statuses(),
  public.create_investment(text,text,text,text,date,date,numeric,text,text,text),
  public.update_investment(uuid,text,text,text,date,text,text),
  public.add_investment_capital(uuid,numeric,date,text,text,text),
  public.revalue_investment(uuid,numeric,date,text),
  public.record_investment_income(uuid,numeric,date,text,text,text),
  public.exit_investment(uuid,numeric,date,numeric,text,text,text),
  public.record_expense(text,text,text,numeric,date,text,text,uuid),
  public.post_manual_journal(date,text,jsonb,text,text),
  public.reverse_transaction(uuid,text,date),
  public.update_fund_settings(jsonb),
  public.mark_notifications_read(uuid[]),
  public.send_announcement(text,text),
  public.run_daily_jobs(),
  public.register_document(text,text,text,bigint,text,uuid,uuid),
  public.report_trial_balance(date),
  public.report_balance_sheet(date),
  public.report_income_statement(date,date),
  public.report_cash_flow(date,date),
  public.report_liquidity(),
  public.report_contribution_matrix(int),
  public.report_period_summary(date,date),
  public.member_statement(uuid,date,date),
  public.manager_dashboard(),
  public.member_dashboard(uuid),
  public.integrity_check()
to authenticated;
