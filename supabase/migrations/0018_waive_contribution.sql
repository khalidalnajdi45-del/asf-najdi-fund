-- Manager can mark a monthly contribution as waived (not owed): it stops counting as arrears or overdue,
-- while the month stays visible in the history as "معفى".
alter table public.contributions add column if not exists waived_at timestamptz;
alter table public.contributions add column if not exists waive_note text check (length(waive_note) <= 200);

-- Contributions stay immutable except for the waiver fields.
create or replace function public.trg_contribution_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'waived_at' - 'waive_note') <> (to_jsonb(old) - 'waived_at' - 'waive_note') then
    raise exception 'السجل المالي "contributions" غير قابل للتعديل أو الحذف — استخدم قيداً عكسياً أو تصحيحياً' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists immutable_contributions on public.contributions;
create trigger immutable_contributions before update or delete on public.contributions
  for each row execute function public.trg_contribution_guard();

create or replace view public.v_contribution_status with (security_invoker = true) as
  select c.id, c.member_id, c.period, c.amount_due, c.due_date, c.created_at,
         m.full_name as member_name, m.member_no,
         coalesce(p.paid, 0) as amount_paid,
         case when c.waived_at is not null then 0 else c.amount_due - coalesce(p.paid, 0) end as amount_outstanding,
         p.last_paid_on,
         case when coalesce(p.paid,0) >= c.amount_due then 'paid'
              when c.waived_at is not null then 'waived'
              when coalesce(p.paid,0) > 0 then 'partial'
              when c.due_date < public.fund_today() then 'overdue'
              else 'unpaid' end as status,
         (c.waived_at is null and coalesce(p.paid,0) < c.amount_due and c.due_date < public.fund_today()) as is_overdue,
         c.waived_at, c.waive_note
    from public.contributions c
    join public.members m on m.id = c.member_id
    left join lateral (
      select sum(cp.amount) as paid, max(cp.paid_on) as last_paid_on
        from public.contribution_payments cp
        join public.v_active_tx t on t.id = cp.financial_transaction_id
       where cp.contribution_id = c.id
    ) p on true;

create or replace function public.waive_contribution(p_id uuid, p_note text default null, p_undo boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  perform public.assert_manager();
  select * into c from public.v_contribution_status where id = p_id;
  if c.id is null then raise exception 'الاشتراك غير موجود'; end if;
  if not p_undo and c.status in ('paid','partial') then raise exception 'لا يمكن إعفاء شهر عليه سداد'; end if;
  update public.contributions set waived_at = case when p_undo then null else now() end,
         waive_note = case when p_undo then null else nullif(trim(p_note), '') end where id = p_id;
  perform public._log('update', 'contributions', p_id::text, jsonb_build_object('waived', not p_undo, 'note', p_note), null,
                      case when p_undo then 'إلغاء إعفاء اشتراك ' else 'إعفاء اشتراك ' end || to_char(c.period, 'YYYY-MM') || ' — ' || c.member_name);
end $$;
revoke execute on function public.waive_contribution(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.waive_contribution(uuid, text, boolean) to authenticated;
