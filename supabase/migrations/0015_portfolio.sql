-- =====================================================================
-- Stock portfolio holdings with live market prices, and a members' view of the fund's investments.
-- Prices are fetched by the refresh-prices Edge Function (Tadawul via Yahoo Finance, symbol.SR).
-- Intraday price moves do NOT touch the ledger; the book value is synced once a day after the close
-- (or on demand by the manager) through an ordinary, reversible revaluation entry.
-- =====================================================================

alter table public.investments add column if not exists cash_balance numeric(14,2) not null default 0 check (cash_balance >= 0);
-- v_investment_positions selects i.*; recreate it so the new column is part of the view.
drop view public.v_investment_positions;
create view public.v_investment_positions with (security_invoker = true) as
  select i.*,
         coalesce(x.cost,0) as cost_basis,
         coalesce(x.unrealized,0) as unrealized_pl,
         coalesce(x.cost,0) + coalesce(x.unrealized,0) as current_value,
         coalesce(x.realized,0) as realized_pl,
         coalesce(x.income,0) as income_received,
         coalesce(x.invested,0) as total_invested,
         coalesce(x.returned,0) as total_returned,
         x.last_valuation_date
    from public.investments i
    left join lateral (
      select sum(it.cost_delta) cost, sum(it.unrealized_delta) unrealized, sum(it.realized_pl) realized,
             sum(it.cash_amount) filter (where it.kind = 'income') income,
             sum(it.cash_amount) filter (where it.kind = 'capital_in') invested,
             sum(it.cash_amount) filter (where it.kind = 'exit') returned,
             max(it.tx_date) filter (where it.kind = 'revaluation') last_valuation_date
        from public.investment_transactions it join public.v_active_tx t on t.id = it.financial_transaction_id
       where it.investment_id = i.id) x on true;
grant select on public.v_investment_positions to authenticated;
revoke all on public.v_investment_positions from anon;

alter table public.fund_settings add column if not exists member_investments_view text not null default 'names'
  check (member_investments_view in ('hidden','names','full'));

create table public.portfolio_holdings (
  id            uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.investments(id),
  symbol        text not null check (symbol ~ '^[0-9A-Za-z.]{2,12}$'),
  name          text not null check (length(trim(name)) between 1 and 60),
  quantity      numeric(14,4) not null check (quantity > 0),
  avg_cost      numeric(14,4) not null check (avg_cost >= 0),
  last_price    numeric(14,4),
  prev_close    numeric(14,4),
  price_at      timestamptz,
  sort          int not null default 0,
  updated_at    timestamptz not null default now(),
  unique (investment_id, symbol)
);
create trigger audit_portfolio_holdings after insert or delete or update of quantity, avg_cost, name on public.portfolio_holdings
  for each row execute function public.trg_audit();

create or replace view public.v_portfolio_holdings with (security_invoker = true) as
  select h.*, h.quantity * h.avg_cost as cost_value,
         h.quantity * coalesce(h.last_price, h.avg_cost) as market_value,
         h.quantity * (coalesce(h.last_price, h.avg_cost) - h.avg_cost) as unrealized_pl,
         case when h.avg_cost > 0 then (coalesce(h.last_price, h.avg_cost) - h.avg_cost) / h.avg_cost end as unrealized_pct,
         case when h.prev_close > 0 and h.last_price is not null then h.quantity * (h.last_price - h.prev_close) end as day_change,
         case when h.prev_close > 0 and h.last_price is not null then (h.last_price - h.prev_close) / h.prev_close end as day_change_pct
    from public.portfolio_holdings h;

create or replace function public.portfolio_market_value(p_inv uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce((select sum(quantity * coalesce(last_price, avg_cost)) from public.portfolio_holdings where investment_id = p_inv), 0)
         + coalesce((select cash_balance from public.investments where id = p_inv), 0), 2)
$$;

-- --------------------------------------------------------------- manager API
create or replace function public.upsert_holding(p_inv uuid, p_symbol text, p_name text, p_quantity numeric, p_avg_cost numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; i public.investments;
begin
  perform public.assert_manager();
  select * into i from public.investments where id = p_inv;
  if not found or i.status = 'exited' then raise exception 'الاستثمار غير موجود أو تم التخارج منه'; end if;
  p_symbol := upper(trim(p_symbol));
  if p_quantity is null or p_quantity <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
  if p_avg_cost is null or p_avg_cost < 0 then raise exception 'متوسط التكلفة غير صالح'; end if;
  insert into public.portfolio_holdings(investment_id, symbol, name, quantity, avg_cost)
  values (p_inv, p_symbol, trim(p_name), p_quantity, p_avg_cost)
  on conflict (investment_id, symbol) do update
    set name = excluded.name, quantity = excluded.quantity, avg_cost = excluded.avg_cost, updated_at = now()
  returning id into v;
  return v;
end $$;

create or replace function public.delete_holding(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_manager();
  delete from public.portfolio_holdings where id = p_id;
  if not found then raise exception 'السهم غير موجود'; end if;
end $$;

create or replace function public.set_portfolio_cash(p_inv uuid, p_cash numeric) returns void
language plpgsql security definer set search_path = public as $$
declare o numeric;
begin
  perform public.assert_manager();
  if p_cash is null or p_cash < 0 then raise exception 'المبلغ غير صالح'; end if;
  select cash_balance into o from public.investments where id = p_inv;
  if not found then raise exception 'الاستثمار غير موجود'; end if;
  update public.investments set cash_balance = round(p_cash, 2) where id = p_inv;
  perform public._log('update', 'investments', p_inv::text, jsonb_build_object('cash_balance', p_cash), jsonb_build_object('cash_balance', o), 'نقد المحفظة');
end $$;

/** Prices from the market feed: [{symbol, price, prev_close}] — service role only. */
create or replace function public.apply_market_prices(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.portfolio_holdings h
     set last_price = (x->>'price')::numeric, prev_close = nullif(x->>'prev_close','')::numeric, price_at = now()
    from jsonb_array_elements(p) x
   where h.symbol = upper(x->>'symbol') and (x->>'price')::numeric > 0;
  get diagnostics n = row_count;
  return n;
end $$;

/** Books the portfolio's market value as an unrealized revaluation when it moved. Returns the new tx id or null. */
create or replace function public._sync_portfolio_valuation(p_inv uuid, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare p record; v_val numeric; v_delta numeric; v_tx uuid;
begin
  if not exists (select 1 from public.portfolio_holdings where investment_id = p_inv) then return null; end if;
  perform 1 from public.investments where id = p_inv for update;
  select * into p from public.v_investment_positions where id = p_inv;
  if p.id is null or p.status = 'exited' then return null; end if;
  v_val := public.portfolio_market_value(p_inv);
  v_delta := (v_val - p.cost_basis) - p.unrealized_pl;
  if abs(v_delta) < 0.01 then return null; end if;
  v_tx := public._new_tx('investment_revaluation', p_date, 'تقييم بسعر السوق — ' || p.name, abs(v_delta), null, null, p_inv);
  perform public._post(v_tx, p_date, 'تقييم بسعر السوق (غير محقق) — ' || p.name,
    jsonb_build_array(jsonb_build_object('a','investments_fv','dr',v_delta),
                      jsonb_build_object('a','unrealized_reserve','cr',v_delta)));
  perform public._inv_tx(p_inv, 'revaluation', p_date, 0, 0, v_delta, 0, v_val, 'تقييم آلي بأسعار السوق', v_tx);
  return v_tx;
end $$;

create or replace function public.sync_portfolio_valuation(p_inv uuid) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_manager();
  return public._sync_portfolio_valuation(p_inv, public.fund_today());
end $$;

/** Daily job (service role / cron): book every active portfolio at market. */
create or replace function public.sync_all_portfolios() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if auth.uid() is not null then perform public.assert_manager(); end if;
  for r in select distinct investment_id from public.portfolio_holdings loop
    if public._sync_portfolio_valuation(r.investment_id, public.fund_today()) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- --------------------------------------------------------------- members' view
/** What members may see of the fund's investments, per fund_settings.member_investments_view:
    hidden → nothing; names → names, categories, tickers and market prices only; full → adds quantities and values. */
create or replace function public.member_investments() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_mode text := (public.settings()).member_investments_view;
begin
  if auth.uid() is null or (public.current_member_id() is null and not public.is_manager()) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if v_mode = 'hidden' then return jsonb_build_object('mode', v_mode, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('mode', v_mode, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'name', i.name, 'category', i.category, 'provider', i.provider, 'since', i.investment_date,
             'value', case when v_mode = 'full' then p.current_value end,
             'holdings', (select coalesce(jsonb_agg(jsonb_build_object(
                             'symbol', h.symbol, 'name', h.name, 'price', h.last_price, 'prev_close', h.prev_close,
                             'day_change_pct', h.day_change_pct, 'price_at', h.price_at,
                             'quantity', case when v_mode = 'full' then h.quantity end,
                             'market_value', case when v_mode = 'full' then round(h.market_value, 2) end)
                           order by h.sort, h.market_value desc), '[]'::jsonb)
                          from public.v_portfolio_holdings h where h.investment_id = i.id))
           order by i.investment_date)
      from public.investments i join public.v_investment_positions p on p.id = i.id
     where i.status <> 'exited'), '[]'::jsonb));
end $$;

create or replace function public.set_member_investments_view(p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare o text := (public.settings()).member_investments_view;
begin
  perform public.assert_manager();
  if p_mode not in ('hidden','names','full') then raise exception 'خيار غير صالح'; end if;
  update public.fund_settings set member_investments_view = p_mode, updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._log('update', 'fund_settings', '1', jsonb_build_object('member_investments_view', p_mode),
                      jsonb_build_object('member_investments_view', o), 'عرض الاستثمارات للأعضاء');
end $$;

-- --------------------------------------------------------------- security
alter table public.portfolio_holdings enable row level security;
revoke all on public.portfolio_holdings from public, anon, authenticated;
grant select on public.portfolio_holdings, public.v_portfolio_holdings to authenticated;
revoke all on public.v_portfolio_holdings from anon;
create policy manager_read on public.portfolio_holdings for select to authenticated using ((select public.is_manager()));

revoke execute on function public.portfolio_market_value(uuid), public.upsert_holding(uuid,text,text,numeric,numeric),
  public.delete_holding(uuid), public.set_portfolio_cash(uuid,numeric), public.apply_market_prices(jsonb),
  public._sync_portfolio_valuation(uuid,date), public.sync_portfolio_valuation(uuid), public.sync_all_portfolios(),
  public.member_investments(), public.set_member_investments_view(text) from public, anon, authenticated;
grant execute on function public.portfolio_market_value(uuid), public.upsert_holding(uuid,text,text,numeric,numeric),
  public.delete_holding(uuid), public.set_portfolio_cash(uuid,numeric), public.sync_portfolio_valuation(uuid),
  public.member_investments(), public.set_member_investments_view(text) to authenticated;
do $$ begin
  grant execute on function public.apply_market_prices(jsonb), public.sync_all_portfolios() to service_role;
exception when undefined_object then null; end $$;
