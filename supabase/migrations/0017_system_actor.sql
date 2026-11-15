-- Scheduled jobs run without a signed-in user; ledger rows need an actor, so they post as a fixed "system" identity.
insert into public.app_users(id, role, email, full_name, is_active)
values ('00000000-0000-4000-8000-00000000a5f1', 'manager', 'system@asf.local', 'النظام (عمليات آلية)', false)
on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, is_active = false;

create or replace function public._as_system() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a5f1', true);
  end if;
end $$;
revoke execute on function public._as_system() from public, anon, authenticated;

create or replace function public.sync_all_portfolios() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if auth.uid() is not null then perform public.assert_manager(); else perform public._as_system(); end if;
  for r in select distinct investment_id from public.portfolio_holdings loop
    if public._sync_portfolio_valuation(r.investment_id, public.fund_today()) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
