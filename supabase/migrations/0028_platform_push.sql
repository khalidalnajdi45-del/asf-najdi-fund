-- Supabase-only: push delivery through the `send-push` Edge Function (pg_net, authenticated by the Vault cron secret),
-- plus schedules. Notifications are created by the daily run at 08:00 Riyadh, so nobody gets buzzed at dawn.
create or replace function public._push_dispatch(p_notification uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'asf_functions_url') || '/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'asf_cron_secret')),
    body := jsonb_build_object('notification_id', p_notification), timeout_milliseconds := 20000);
exception when others then
  null;  -- never let a push problem break the transaction that created the notification
end $$;
revoke execute on function public._push_dispatch(uuid) from public, anon, authenticated;

select cron.unschedule('najdi-fund-daily');
select cron.schedule('najdi-fund-daily', '0 5 * * *', $$select public.run_daily_jobs()$$);        -- 08:00 Riyadh
select cron.schedule('najdi-fund-morning-push', '3 5 * * *', $$select public.run_morning_push()$$); -- 08:03 Riyadh
select cron.schedule('najdi-fund-task-reminders', '*/10 * * * *', $$select public.run_task_reminders()$$);
