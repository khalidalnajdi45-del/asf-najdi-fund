-- =====================================================================
-- Manager-created loans: the fund manager records a loan for a member directly
-- (request → approval → optional disbursement in one step, same ledger postings as the normal flow).
-- =====================================================================
create or replace function public.admin_create_loan(p_member uuid, p_amount numeric, p_installments int, p_frequency text default 'monthly',
  p_purpose text default null, p_fee numeric default null, p_first_due date default null,
  p_disburse boolean default true, p_disburse_date date default null, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; m public.members;
begin
  perform public.assert_manager();
  if p_key is not null and exists (select 1 from public.financial_transactions where idempotency_key = p_key) then
    select loan_id into v from public.financial_transactions where idempotency_key = p_key; return v;
  end if;
  select * into m from public.members where id = p_member for update;
  if not found or m.status <> 'active' then raise exception 'العضو غير موجود أو غير نشط'; end if;
  p_amount := public.money(p_amount);
  if coalesce(p_amount, 0) <= 0 then raise exception 'مبلغ القرض يجب أن يكون أكبر من صفر'; end if;
  if p_installments is null or p_installments < 1 or p_installments > 120 then raise exception 'عدد الأقساط غير صالح'; end if;
  insert into public.loans(member_id, requested_amount, purpose, preferred_months, notes)
  values (p_member, p_amount, coalesce(nullif(trim(p_purpose), ''), 'قرض مسجل من مدير الصندوق'),
          least(120, case when p_frequency = 'quarterly' then p_installments * 3 else p_installments end), 'أُنشئ من مدير الصندوق')
  returning id into v;
  perform public.approve_loan(v, p_amount, p_installments, p_frequency, p_fee, p_first_due, 'قرض مسجل مباشرة من مدير الصندوق');
  if coalesce(p_disburse, true) then
    perform public.disburse_loan(v, coalesce(p_disburse_date, public.fund_today()), p_reference, p_key);
  end if;
  perform public._log('create', 'loans', v::text, jsonb_build_object('member', p_member, 'amount', p_amount, 'installments', p_installments, 'disbursed', coalesce(p_disburse, true)), null, 'قرض من المدير');
  return v;
end $$;

revoke execute on function public.admin_create_loan(uuid,numeric,int,text,text,numeric,date,boolean,date,text,text) from public, anon;
grant execute on function public.admin_create_loan(uuid,numeric,int,text,text,numeric,date,boolean,date,text,text) to authenticated;
