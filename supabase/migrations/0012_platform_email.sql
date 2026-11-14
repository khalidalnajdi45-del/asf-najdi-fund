-- Supabase-only: schedule the monthly e-mail run. pg_cron calls the Edge Function through pg_net,
-- authenticated by a random secret kept in Vault (never leaves the database).
create extension if not exists pg_net with schema extensions;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'asf_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'asf_cron_secret');
  end if;
  if not exists (select 1 from vault.secrets where name = 'asf_functions_url') then
    perform vault.create_secret('https://ihwbxydoudrwqfacteiq.supabase.co/functions/v1', 'asf_functions_url');
  end if;
end $$;

create or replace function public.cron_secret_ok(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p, '') <> '' and p = (select decrypted_secret from vault.decrypted_secrets where name = 'asf_cron_secret')
$$;
revoke execute on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

create or replace function public.trigger_report_emails() returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'asf_functions_url') || '/send-report-emails',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'asf_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$;
revoke execute on function public.trigger_report_emails() from public, anon, authenticated;

-- 1st of the month: reports are issued at 04:00 UTC (07:00 Riyadh); e-mails follow at 04:20.
select cron.schedule('najdi-fund-report-emails', '20 4 1 * *', $$select public.trigger_report_emails()$$);
