-- Supabase-only: issue last month's account reports on the 1st at 07:00 Riyadh (04:00 UTC).
select cron.schedule('najdi-fund-monthly-reports', '0 4 1 * *', $$select public.auto_monthly_reports()$$);
