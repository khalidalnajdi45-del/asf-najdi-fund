-- Supabase-only: monthly data backup e-mailed to the fund's mailbox (1st of month, 07:40 Riyadh, after the reports).
create or replace function public.trigger_backup_email() returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'asf_functions_url') || '/send-report-emails',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'asf_cron_secret')),
    body := '{"backup": true}'::jsonb, timeout_milliseconds := 120000)
$$;
revoke execute on function public.trigger_backup_email() from public, anon, authenticated;
select cron.schedule('najdi-fund-monthly-backup', '40 4 1 * *', $$select public.trigger_backup_email()$$);
