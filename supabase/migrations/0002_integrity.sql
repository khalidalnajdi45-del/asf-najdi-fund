-- =====================================================================
-- Integrity: immutable ledger, balanced journals, frozen money rows, audit
-- =====================================================================

-- Rows that represent posted money are append-only. Corrections = reversing entries.
create or replace function public.trg_forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'السجل المالي "%" غير قابل للتعديل أو الحذف — استخدم قيداً عكسياً أو تصحيحياً', tg_table_name
    using errcode = 'P0001';
end $$;

do $$
declare t text;
begin
  foreach t in array array['financial_transactions','journal_entries','journal_entry_lines','contribution_payments',
                           'loan_repayments','loan_installments','investment_transactions','expenses','audit_logs','contributions']
  loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.trg_forbid_change()',
                   'immutable_' || t, t);
  end loop;
end $$;

-- Every journal entry must balance (checked at COMMIT so lines can be inserted one by one).
create or replace function public.trg_check_entry_balanced() returns trigger
language plpgsql as $$
declare d numeric; c numeric; n int; eid uuid;
begin
  eid := new.entry_id;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into d, c, n
    from public.journal_entry_lines where entry_id = eid;
  if n < 2 then
    raise exception 'القيد % يجب أن يحتوي على سطرين على الأقل', eid;
  end if;
  if d <> c then
    raise exception 'القيد غير متوازن: مدين % ≠ دائن %', d, c;
  end if;
  return null;
end $$;

create constraint trigger jel_balanced after insert on public.journal_entry_lines
  deferrable initially deferred for each row execute function public.trg_check_entry_balanced();

create or replace function public.trg_check_entry_has_lines() returns trigger
language plpgsql as $$
begin
  perform public.trg_check_entry_balanced_by_id(new.id);
  return null;
end $$;

create or replace function public.trg_check_entry_balanced_by_id(eid uuid) returns void
language plpgsql as $$
declare d numeric; c numeric; n int;
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into d, c, n
    from public.journal_entry_lines where entry_id = eid;
  if n < 2 or d <> c then
    raise exception 'القيد % غير مكتمل أو غير متوازن', eid;
  end if;
end $$;

create constraint trigger je_has_lines after insert on public.journal_entries
  deferrable initially deferred for each row execute function public.trg_check_entry_has_lines();

-- Workflow rows: may change status, but money fields are frozen and rows are never deleted.
create or replace function public.trg_guard_workflow() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'لا يمكن حذف سجل "%" — استخدم الإلغاء أو الرفض', tg_table_name;
  end if;
  if new.member_id is distinct from old.member_id or new.amount is distinct from old.amount then
    raise exception 'لا يمكن تعديل العضو أو المبلغ في "%"', tg_table_name;
  end if;
  if old.financial_transaction_id is not null and new.financial_transaction_id is distinct from old.financial_transaction_id then
    raise exception 'العملية المالية مرتبطة ولا يمكن تغييرها';
  end if;
  if old.status in ('rejected','cancelled') and new.status is distinct from old.status then
    raise exception 'لا يمكن تغيير حالة طلب مغلق';
  end if;
  return new;
end $$;
create trigger guard_member_deposits before update or delete on public.member_deposits
  for each row execute function public.trg_guard_workflow();
create trigger guard_deposit_withdrawals before update or delete on public.deposit_withdrawals
  for each row execute function public.trg_guard_workflow();

create or replace function public.trg_guard_loans() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'لا يمكن حذف قرض — استخدم الإلغاء أو الرفض'; end if;
  if new.member_id is distinct from old.member_id or new.requested_amount is distinct from old.requested_amount then
    raise exception 'لا يمكن تعديل العضو أو المبلغ المطلوب';
  end if;
  if old.disbursement_tx_id is not null and (
       new.approved_amount is distinct from old.approved_amount or new.fee_amount is distinct from old.fee_amount
    or new.installments_count is distinct from old.installments_count or new.frequency is distinct from old.frequency
    or new.disbursement_tx_id is distinct from old.disbursement_tx_id or new.disbursed_on is distinct from old.disbursed_on) then
    raise exception 'شروط القرض مجمدة بعد الصرف';
  end if;
  if old.status in ('rejected','cancelled') and new.status is distinct from old.status then
    raise exception 'لا يمكن تغيير حالة قرض مغلق';
  end if;
  return new;
end $$;
create trigger guard_loans before update or delete on public.loans
  for each row execute function public.trg_guard_loans();

create or replace function public.trg_forbid_delete() returns trigger
language plpgsql as $$ begin raise exception 'لا يمكن حذف سجلات "%" — استخدم التعطيل', tg_table_name; end $$;
create trigger nodelete_members before delete on public.members for each row execute function public.trg_forbid_delete();
create trigger nodelete_investments before delete on public.investments for each row execute function public.trg_forbid_delete();
create trigger nodelete_app_users before delete on public.app_users for each row execute function public.trg_forbid_delete();

-- ---------- audit trail ----------
create or replace function public.trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := case when tg_op = 'DELETE' then (to_jsonb(old)->>'id') else (to_jsonb(new)->>'id') end;
  insert into public.audit_logs(actor_id, action, entity, entity_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['app_users','members','fund_settings','financial_transactions','contribution_payments',
                           'member_deposits','deposit_withdrawals','loans','loan_repayments','investments',
                           'investment_transactions','expenses','documents','accounts']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.trg_audit()',
                   'audit_' || t, t);
  end loop;
end $$;
