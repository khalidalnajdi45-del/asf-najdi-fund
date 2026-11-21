-- Supabase-only: daily ماليتي job (zakat anniversary reminders) at 08:06 Riyadh.
select cron.schedule('najdi-fund-pf-daily', '6 5 * * *', $$select public.run_pf_daily()$$);
