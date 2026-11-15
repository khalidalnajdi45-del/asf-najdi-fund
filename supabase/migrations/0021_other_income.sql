-- =====================================================================
-- Other income (إيرادات أخرى): donations, bank profits not tied to an investment, fees, misc.
-- Cash Dr / other_income (4900) Cr. Reversible through reverse_transaction like any other money movement.
-- =====================================================================

alter table public.financial_transactions drop constraint if exists financial_transactions_tx_type_check;
alter table public.financial_transactions add constraint financial_transactions_tx_type_check check (tx_type in (
  'contribution_payment','deposit','withdrawal_payment','loan_disbursement','loan_repayment',
  'investment_capital','investment_income','investment_revaluation','investment_exit',
  'expense','other_income','manual_journal','reversal'));

alter table public.documents drop constraint if exists documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check
  check (entity_type in ('investment','expense','income','transaction','loan','member','other'));

alter table public.fund_settings add column if not exists income_categories jsonb not null
  default '["أرباح بنكية","تبرعات وهبات","رسوم وغرامات","إيرادات أخرى"]'::jsonb;

create table public.incomes (
  id                       uuid primary key default gen_random_uuid(),
  category                 text not null,
  description              text not null,
  payer                    text,
  amount                   numeric(14,2) not null check (amount > 0),
  income_date              date not null,
  reference                text,
  financial_transaction_id uuid not null unique references public.financial_transactions(id),
  created_by               uuid not null,
  created_at               timestamptz not null default now()
);
create index on public.incomes(income_date);

create trigger immutable_incomes before update or delete on public.incomes
  for each row execute function public.trg_forbid_change();
create trigger audit_incomes after insert or update or delete on public.incomes
  for each row execute function public.trg_audit();

create or replace function public.record_income(p_category text, p_description text, p_payer text, p_amount numeric,
  p_date date, p_reference text default null, p_key text default null, p_document uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tx uuid;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  p_amount := public.money(p_amount);
  if coalesce(p_amount, 0) <= 0 then raise exception 'مبلغ الإيراد يجب أن يكون أكبر من صفر'; end if;
  if length(trim(coalesce(p_category,''))) < 2 then raise exception 'فئة الإيراد مطلوبة'; end if;
  if length(trim(coalesce(p_description,''))) < 2 then raise exception 'وصف الإيراد مطلوب'; end if;
  if p_date > public.fund_today() then raise exception 'لا يمكن تسجيل إيراد بتاريخ مستقبلي'; end if;
  v_tx := public._new_tx('other_income', p_date, 'إيراد: ' || trim(p_description), p_amount, null, null, null, p_reference, p_key, p_document);
  perform public._post(v_tx, p_date, 'إيراد: ' || trim(p_description),
    jsonb_build_array(jsonb_build_object('a','cash','dr',p_amount), jsonb_build_object('a','other_income','cr',p_amount)));
  insert into public.incomes(category, description, payer, amount, income_date, reference, financial_transaction_id, created_by)
  values (trim(p_category), trim(p_description), nullif(trim(p_payer),''), p_amount, p_date, nullif(trim(p_reference),''), v_tx, auth.uid());
  return v_tx;
end $$;

create or replace function public.set_income_categories(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o jsonb;
begin
  perform public.assert_manager();
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then raise exception 'أضف فئة إيراد واحدة على الأقل'; end if;
  select income_categories into o from public.fund_settings where id = 1;
  update public.fund_settings set income_categories = p, updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._log('policy_change', 'fund_settings', '1', jsonb_build_object('income_categories', p), jsonb_build_object('income_categories', o), 'تعديل فئات الإيرادات');
end $$;

alter table public.incomes enable row level security;
revoke all on public.incomes from public, anon, authenticated;
grant select on public.incomes to authenticated;
create policy manager_read on public.incomes for select to authenticated using ((select public.is_manager()));

revoke execute on function public.record_income(text,text,text,numeric,date,text,text,uuid), public.set_income_categories(jsonb) from public, anon;
grant execute on function public.record_income(text,text,text,numeric,date,text,text,uuid), public.set_income_categories(jsonb) to authenticated;
