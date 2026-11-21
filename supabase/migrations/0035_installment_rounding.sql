-- Whole-riyal installments round UP and the last one is the smaller remainder,
-- so no month ever goes above the member's monthly cap.
create or replace function public._schedule_plan(p_total numeric, p_mode text, p_start date, p_count int, p_freq text default 'monthly')
returns table(seq int, due_date date, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_min numeric := (select loan_min_installment from public.fund_settings where id = 1);
        n int; v_each numeric; v_step interval; i int;
begin
  if coalesce(p_total, 0) <= 0 then return; end if;
  if p_mode = 'lump' then
    seq := 1; due_date := p_start; amount := p_total; return next; return;
  end if;
  v_step := case p_freq when 'quarterly' then interval '3 months' else interval '1 month' end;
  n := greatest(1, least(coalesce(p_count, 1), floor(p_total / v_min)::int, 120));
  v_each := ceil(p_total / n);
  if p_total - v_each * (n - 1) <= 0 then v_each := trunc(p_total / n, 2); end if;
  for i in 1..n loop
    seq := i; due_date := (p_start + v_step * (i - 1))::date;
    amount := case when i = n then p_total - v_each * (n - 1) else v_each end;
    return next;
  end loop;
end $$;

create or replace function public._member_seq_plan(p_member uuid, p_start date, p_count int, p_cap numeric, p_loans uuid[] default null)
returns table(loan_id uuid, due_date date, amount numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_min numeric := (select loan_min_installment from public.fund_settings where id = 1);
        ids uuid[]; rem numeric[]; v_total numeric; n int; m numeric; i int; j int := 1; amt numeric; take numeric; d date;
begin
  select array_agg(id order by disbursed_on, loan_no), array_agg(outstanding order by disbursed_on, loan_no), sum(outstanding)
    into ids, rem, v_total
    from public.v_loan_summary where member_id = p_member and status in ('disbursed','active','overdue') and outstanding > 0
     and (p_loans is null or id = any(p_loans));
  if coalesce(v_total, 0) <= 0 then return; end if;
  n := greatest(1, least(coalesce(p_count, 1), floor(v_total / v_min)::int));
  n := public._capped_count(v_total, n, p_cap);
  m := ceil(v_total / n);
  if v_total - m * (n - 1) <= 0 then m := trunc(v_total / n, 2); end if;
  for i in 1..n loop
    d := (p_start + interval '1 month' * (i - 1))::date;
    amt := case when i = n then v_total - m * (n - 1) else m end;
    while amt > 0 and j <= array_length(ids, 1) loop
      take := least(amt, rem[j]);
      loan_id := ids[j]; due_date := d; amount := take; return next;
      rem[j] := rem[j] - take; amt := amt - take;
      if rem[j] <= 0 then j := j + 1; end if;
    end loop;
  end loop;
end $$;
revoke execute on function public._schedule_plan(numeric,text,date,int,text), public._member_seq_plan(uuid,date,int,numeric,uuid[]) from public, anon, authenticated;
