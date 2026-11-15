-- Supabase-only: book the stock portfolio at market once a month (first day, 06:30 Riyadh — after the last close
-- of the month and before the monthly member reports at 07:00). Intraday price refreshes continue unchanged.
select cron.unschedule('najdi-fund-prices-close');
select cron.schedule('najdi-fund-valuation-monthly', '30 3 1 * *', $$select public.trigger_price_refresh(true)$$);
