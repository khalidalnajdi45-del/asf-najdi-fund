-- ⚠️ DESTRUCTIVE — wipes ALL fund data (members, ledger, audit) and fund user logins.
-- Use only once: to clear the demo data before going live with real data.
-- TRUNCATE bypasses the row-level immutability triggers by design; run it from the SQL editor as postgres.
begin;
delete from auth.users where id in (select id from public.app_users);
truncate public.notification_deliveries, public.notifications, public.documents, public.expenses,
         public.investment_transactions, public.investments, public.loan_repayments, public.loan_installments,
         public.deposit_withdrawals, public.member_deposits, public.contribution_payments, public.contributions,
         public.journal_entry_lines, public.journal_entries, public.financial_transactions, public.loans,
         public.members, public.app_users, public.audit_logs restart identity cascade;
update public.fund_settings set demo_mode = false, fund_name = 'صندوق النجدي الادخاري', contribution_start_period = date_trunc('month', now())::date where id = 1;
alter sequence public.tx_no_seq restart with 100001;
alter sequence public.je_no_seq restart with 1;
alter sequence public.loan_no_seq restart with 501;
alter sequence public.member_no_seq restart with 1001;
commit;
-- Then create the real manager:
-- select public._create_auth_user('you@example.com', 'StrongPassword!', 'اسم المدير', 'manager');
