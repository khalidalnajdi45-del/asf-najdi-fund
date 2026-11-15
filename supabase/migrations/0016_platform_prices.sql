-- Supabase-only: live Tadawul prices during market hours (Sun–Thu 10:00–15:45 Riyadh) and a daily book valuation after the close.
create or replace function public.trigger_price_refresh(p_sync boolean default false) returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'asf_functions_url') || '/refresh-prices',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'asf_cron_secret')),
    body := jsonb_build_object('sync', p_sync), timeout_milliseconds := 60000)
$$;
revoke execute on function public.trigger_price_refresh(boolean) from public, anon, authenticated;
grant execute on function public.apply_market_prices(jsonb), public.sync_all_portfolios() to service_role;

select cron.schedule('najdi-fund-prices-intraday', '*/15 7-12 * * 0-4', $$select public.trigger_price_refresh(false)$$);
select cron.schedule('najdi-fund-prices-close',    '20 12 * * 0-4',    $$select public.trigger_price_refresh(true)$$);
