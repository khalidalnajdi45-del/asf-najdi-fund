-- Accounts that hold deposits/advances but don't pay the monthly contribution (e.g. the mother, the household).
alter table public.members add column if not exists contribution_exempt boolean not null default false;

create or replace function public.generate_contribution_obligations(p_through date default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int; s public.fund_settings := public.settings(); v_through date;
begin
  if auth.uid() is not null then perform public.assert_manager(); end if;   -- API: manager; cron: system
  v_through := date_trunc('month', coalesce(p_through, public.fund_today()))::date;
  insert into public.contributions(member_id, period, amount_due, due_date)
  select m.id, g::date, s.monthly_contribution, g::date + (s.contribution_due_day - 1)
    from public.members m
    cross join lateral generate_series(greatest(date_trunc('month', m.join_date)::date, s.contribution_start_period),
                                       v_through, interval '1 month') g
   where m.status = 'active' and not m.contribution_exempt
  on conflict (member_id, period) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
