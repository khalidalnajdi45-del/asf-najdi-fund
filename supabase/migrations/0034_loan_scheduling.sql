-- =====================================================================
-- Loan scheduling
--   • fixed due day (28th) and a minimum installment (100 SAR)
--   • a member's installments across all loans stay within a monthly cap (800 SAR); loans are paid one after another;
--     the manager may go above it when he schedules or records a loan himself
--   • paying more than what is due this month settles the LAST installments (the monthly amount stays the same)
--   • a loan request can start on a chosen month, or be one full payment on a chosen date
--   • members ask to reschedule; nothing changes until the fund manager approves
--   • the manager can reschedule any open loan directly, or all open loans at once
-- The installment table stays locked; only the reschedule functions below may rewrite it.
-- =====================================================================
alter table public.fund_settings
  add column if not exists loan_due_day smallint not null default 28 check (loan_due_day between 1 and 28),
  add column if not exists loan_min_installment numeric(14,2) not null default 100 check (loan_min_installment > 0),
  add column if not exists loan_member_monthly_cap numeric(14,2) default 800 check (loan_member_monthly_cap is null or loan_member_monthly_cap > 0);

alter table public.loans
  add column if not exists repayment_mode text not null default 'installments' check (repayment_mode in ('installments','lump')),
  add column if not exists preferred_start date;

-- ---------------------------------------------------------------- installment guard
drop trigger if exists immutable_loan_installments on public.loan_installments;
create or replace function public.trg_installments_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('asf.reschedule', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'جدول الأقساط لا يُعدّل إلا عبر إعادة جدولة معتمدة' using errcode = 'P0001';
end $$;
create trigger guard_loan_installments before update or delete on public.loan_installments
  for each row execute function public.trg_installments_guard();

-- Loan terms stay frozen after disbursement, except the installment count during an approved reschedule.
create or replace function public.trg_guard_loans() returns trigger
language plpgsql as $$
declare v_resched boolean := coalesce(current_setting('asf.reschedule_loan', true), '') = 'on';
begin
  if tg_op = 'DELETE' then raise exception 'لا يمكن حذف قرض — استخدم الإلغاء أو الرفض'; end if;
  if new.member_id is distinct from old.member_id or new.requested_amount is distinct from old.requested_amount then
    raise exception 'لا يمكن تعديل العضو أو المبلغ المطلوب';
  end if;
  if old.disbursement_tx_id is not null and (
       new.approved_amount is distinct from old.approved_amount or new.fee_amount is distinct from old.fee_amount
    or (new.installments_count is distinct from old.installments_count and not v_resched)
    or new.frequency is distinct from old.frequency
    or new.disbursement_tx_id is distinct from old.disbursement_tx_id or new.disbursed_on is distinct from old.disbursed_on) then
    raise exception 'شروط القرض مجمدة بعد الصرف';
  end if;
  if old.status in ('rejected','cancelled') and new.status is distinct from old.status then
    raise exception 'لا يمكن تغيير حالة قرض مغلق';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- helpers
/** The fund's due day in the month of p_month. */
create or replace function public._due_in_month(p_month date) returns date
language sql stable security definer set search_path = public as $$
  select make_date(extract(year from p_month)::int, extract(month from p_month)::int, (select loan_due_day from public.fund_settings where id = 1))
$$;

/** First due day strictly after p_after, at least one month later (used when no start date was chosen). */
create or replace function public._next_due(p_after date) returns date
language sql stable security definer set search_path = public as $$
  select public._due_in_month((date_trunc('month', p_after) + interval '1 month')::date)
$$;

/** Splits p_total into a schedule: whole-riyal installments, the last one takes the remainder,
 *  never below the minimum installment (fewer installments instead). */
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
  v_each := trunc(p_total / n, 0);
  if v_each <= 0 then v_each := trunc(p_total / n, 2); end if;
  for i in 1..n loop
    seq := i; due_date := (p_start + v_step * (i - 1))::date;
    amount := case when i = n then p_total - v_each * (n - 1) else v_each end;
    return next;
  end loop;
end $$;

/** Member-side limits for a chosen plan. */
create or replace function public._check_member_plan(p_mode text, p_start date, p_count int) returns void
language plpgsql stable security definer set search_path = public as $$
declare s public.fund_settings := public.settings(); t date := public.fund_today();
begin
  if p_mode not in ('installments','lump') then raise exception 'طريقة السداد غير صالحة'; end if;
  if p_start is null or p_start <= t then raise exception 'التاريخ يجب أن يكون بعد اليوم'; end if;
  if p_start > (t + interval '12 months')::date then raise exception 'أقصى تاريخ للبداية أو للدفعة الكاملة 12 شهراً من اليوم'; end if;
  if p_mode = 'installments' then
    if p_count is null or p_count < 1 or p_count > s.loan_max_months then
      raise exception 'عدد الأقساط يجب أن يكون بين 1 و %', s.loan_max_months;
    end if;
    if (p_start + interval '1 month' * (p_count - 1))::date > (t + interval '1 month' * s.loan_max_months)::date then
      raise exception 'آخر قسط يجب ألا يتجاوز % شهراً من اليوم', s.loan_max_months;
    end if;
  end if;
end $$;

/** Installment count that keeps p_total within a monthly cap (more installments when needed). */
create or replace function public._capped_count(p_total numeric, p_count int, p_cap numeric) returns int
language sql immutable as $$
  select least(120, case when p_cap > 0 and p_count > 0 and p_total / p_count > p_cap then ceil(p_total / p_cap)::int else p_count end)
$$;

/** What is left of a member's monthly cap for one loan, after his other open loans' current installments. */
create or replace function public._member_cap(p_member uuid, p_exclude uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when s.loan_member_monthly_cap is null then null
              else greatest(s.loan_min_installment, s.loan_member_monthly_cap - coalesce((
                select sum(next_due_amount) from public.v_loan_summary
                 where member_id = p_member and id is distinct from p_exclude
                   and status in ('disbursed','active','overdue') and outstanding > 0), 0)) end
    from public.fund_settings s where s.id = 1
$$;

/** Replaces a loan's schedule with p_rows [{due, amount}] (their sum must equal the loan total). */
create or replace function public._rewrite_schedule(p_loan uuid, p_rows jsonb, p_mode text, p_note text, p_log boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare l record; v_old jsonb; k int := 0; x jsonb;
begin
  select * into l from public.v_loan_summary where id = p_loan;
  if abs((select coalesce(sum((r->>'amount')::numeric), 0) from jsonb_array_elements(p_rows) r) - l.total_repayable) > 0.001 then
    raise exception 'مجموع الجدول لا يساوي إجمالي القرض';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('seq', seq, 'due', due_date, 'amount', amount_due) order by seq), '[]'::jsonb)
    into v_old from public.loan_installments where loan_id = p_loan;
  perform set_config('asf.reschedule', 'on', true);
  delete from public.loan_installments where loan_id = p_loan;
  perform set_config('asf.reschedule', 'off', true);
  for x in select * from jsonb_array_elements(p_rows) loop
    if (x->>'amount')::numeric > 0 then
      k := k + 1;
      insert into public.loan_installments(loan_id, seq, due_date, amount_due) values (p_loan, k, (x->>'due')::date, (x->>'amount')::numeric);
    end if;
  end loop;
  perform set_config('asf.reschedule_loan', 'on', true);
  update public.loans set installments_count = least(120, k), repayment_mode = coalesce(p_mode, repayment_mode),
         first_due_date = coalesce((select min(due_date) from public.loan_installments i where i.loan_id = p_loan and i.due_date >= public.fund_today()), first_due_date)
   where id = p_loan;
  perform set_config('asf.reschedule_loan', 'off', true);
  perform public._refresh_loan_status(p_loan);
  if p_log then
    perform public._log('reschedule', 'loans', p_loan::text, jsonb_build_object('schedule', p_rows, 'mode', p_mode),
                        jsonb_build_object('schedule', v_old), p_note);
  end if;
  return k;
end $$;

/** The settled part of a loan as one line (what is already repaid), dated at the last payment. */
create or replace function public._settled_row(p_loan uuid, p_before date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when l.amount_repaid > 0 then jsonb_build_array(jsonb_build_object('due',
           least(coalesce((select max(lr.paid_on) from public.loan_repayments lr join public.v_active_tx t on t.id = lr.financial_transaction_id
                            where lr.loan_id = p_loan), l.disbursed_on), p_before), 'amount', l.amount_repaid))
         else '[]'::jsonb end
    from public.v_loan_summary l where l.id = p_loan
$$;

/** Rewrites the schedule of an open loan: what is already repaid stays as one settled line,
 *  the outstanding balance is spread by the new plan. */
create or replace function public._apply_schedule(p_loan uuid, p_mode text, p_start date, p_count int, p_note text) returns int
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  perform 1 from public.loans where id = p_loan for update;
  select * into l from public.v_loan_summary where id = p_loan;
  if not found or l.status not in ('disbursed','active','overdue') then raise exception 'يمكن جدولة القروض المصروفة غير المسددة فقط'; end if;
  if l.outstanding <= 0 then raise exception 'القرض مسدد بالكامل'; end if;
  if p_start is null then raise exception 'حدد تاريخ البداية'; end if;
  return public._rewrite_schedule(p_loan,
    public._settled_row(p_loan, p_start) || coalesce((select jsonb_agg(jsonb_build_object('due', due_date, 'amount', amount) order by seq)
      from public._schedule_plan(l.outstanding, p_mode, p_start, p_count, coalesce(l.frequency, 'monthly'))), '[]'::jsonb),
    p_mode, coalesce(p_note, 'إعادة جدولة'));
end $$;

/** A member's open loans paid one after another: each month the member pays the same amount (within the cap),
 *  first towards the oldest loan; when it is settled the rest of that month goes to the next one. */
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
  m := trunc(v_total / n, 0);
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

/** Paying more than what is due up to the end of the payment's month settles the LAST installments,
 *  so the member keeps paying the same amount every month and the loan ends earlier. */
create or replace function public._apply_extra_payment(p_loan uuid, p_paid_on date) returns void
language plpgsql security definer set search_path = public as $$
declare l record; v_cut date; v_due numeric; v_extra numeric; past jsonb; fut jsonb := '[]'::jsonb; r record; left_ numeric;
begin
  select * into l from public.v_loan_summary where id = p_loan;
  if l.status not in ('disbursed','active','overdue') or l.outstanding <= 0 then return; end if;
  if (select coalesce(sum(amount_due), 0) from public.loan_installments where loan_id = p_loan) <> l.total_repayable then return; end if;
  v_cut := (date_trunc('month', p_paid_on) + interval '1 month' - interval '1 day')::date;
  select coalesce(sum(amount_due), 0) into v_due from public.loan_installments where loan_id = p_loan and due_date <= v_cut;
  v_extra := l.amount_repaid - v_due;
  if v_extra <= 0 then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('due', due_date, 'amount', amount_due) order by seq), '[]'::jsonb)
    into past from public.loan_installments where loan_id = p_loan and due_date <= v_cut;
  left_ := v_extra;
  for r in select due_date, amount_due from public.loan_installments where loan_id = p_loan and due_date > v_cut order by seq desc loop
    if left_ >= r.amount_due then left_ := left_ - r.amount_due;
    else fut := jsonb_build_object('due', r.due_date, 'amount', r.amount_due - left_) || fut; left_ := 0;
    end if;
  end loop;
  perform public._rewrite_schedule(p_loan, past || jsonb_build_array(jsonb_build_object('due', p_paid_on, 'amount', v_extra)) || fut,
                                   null, 'سداد زائد — خُصم من آخر الأقساط', true);
end $$;

create or replace function public.trg_loan_repayment_extra() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._apply_extra_payment(new.loan_id, new.paid_on);
  return null;
end $$;
drop trigger if exists loan_repayment_extra on public.loan_repayments;
create trigger loan_repayment_extra after insert on public.loan_repayments
  for each row execute function public.trg_loan_repayment_extra();

-- ---------------------------------------------------------------- disbursement uses the plan
create or replace function public.disburse_loan(p_loan uuid, p_date date, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.loans; v_tx uuid; v_total numeric; v_first date; v_name text; r record; k int := 0;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'القرض غير موجود'; end if;
  if l.status <> 'approved' then raise exception 'لا يمكن صرف قرض حالته "%" — يجب اعتماده أولاً', l.status; end if;
  perform public._assert_cash(l.approved_amount);
  select full_name into v_name from public.members where id = l.member_id;
  v_first := l.first_due_date;
  if v_first is null or v_first <= p_date then v_first := public._next_due(p_date); end if;
  v_total := l.approved_amount + l.fee_amount;
  v_tx := public._new_tx('loan_disbursement', p_date, 'صرف قرض ' || l.loan_no || ' — ' || v_name, l.approved_amount,
                         l.member_id, l.id, null, p_reference, p_key);
  perform public._post(v_tx, p_date, 'صرف قرض ' || l.loan_no || ' — ' || v_name,
    jsonb_build_array(jsonb_build_object('a','loans_receivable','dr',v_total,'m',l.member_id),
                      jsonb_build_object('a','cash','cr',l.approved_amount),
                      jsonb_build_object('a','loan_fee_income','cr',l.fee_amount)));
  for r in select * from public._schedule_plan(v_total, l.repayment_mode, v_first, l.installments_count, l.frequency) loop
    k := k + 1;
    insert into public.loan_installments(loan_id, seq, due_date, amount_due) values (l.id, r.seq, r.due_date, r.amount);
  end loop;
  update public.loans set status = 'disbursed', disbursed_on = p_date, disbursement_tx_id = v_tx, first_due_date = v_first,
         installments_count = k where id = l.id;
  perform public._notify_member(l.member_id, 'loan_disbursed', 'تم صرف القرض',
    'تم صرف ' || l.approved_amount || ' ريال. ' || case when l.repayment_mode = 'lump'
      then 'السداد دفعة واحدة بتاريخ ' || v_first else 'أول قسط بتاريخ ' || v_first end || '.', '/member/loans/view?id=' || l.id);
  return v_tx;
end $$;

-- ---------------------------------------------------------------- loan request with start / lump sum
drop function if exists public.request_loan(numeric, text, int, text);
create or replace function public.request_loan(p_amount numeric, p_purpose text, p_months int, p_notes text default null,
  p_mode text default 'installments', p_start date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m uuid := public.assert_member(); s public.fund_settings := public.settings(); v uuid; chk jsonb; v_name text;
        v_mode text := coalesce(p_mode, 'installments'); v_count int; v_start date;
begin
  perform 1 from public.members where id = v_m for update;
  p_amount := public.money(p_amount);
  if p_amount is null or p_amount <= 0 then raise exception 'مبلغ القرض غير صالح'; end if;
  if p_amount > s.loan_max_amount then raise exception 'المبلغ أكبر من المسموح بطلبه من المنصة — تواصل مع مدير الصندوق لتسجيل القرض'; end if;
  if length(trim(coalesce(p_purpose,''))) < 3 then raise exception 'يرجى توضيح الغرض من القرض'; end if;
  v_count := case when v_mode = 'lump' then 1 else p_months end;
  v_start := case when v_mode = 'lump' then p_start when p_start is not null then public._due_in_month(p_start) end;
  if v_mode = 'lump' and v_start is null then raise exception 'حدد تاريخ الدفعة الكاملة'; end if;
  if v_start is not null then perform public._check_member_plan(v_mode, v_start, v_count);
  elsif v_count is null or v_count < 1 or v_count > s.loan_max_months then
    raise exception 'مدة السداد يجب أن تكون بين 1 و % شهراً', s.loan_max_months;
  end if;
  if v_mode = 'installments' then v_count := public._capped_count(p_amount, v_count, public._member_cap(v_m, null)); end if;
  if s.loan_one_active_per_member and exists (select 1 from public.loans where member_id = v_m
       and status in ('pending','approved','disbursed','active','overdue')) then
    raise exception 'لديك طلب أو قرض قائم — لا يمكن تقديم طلب جديد قبل إغلاقه';
  end if;
  if s.loan_block_if_overdue and exists (select 1 from public.v_contribution_status where member_id = v_m and is_overdue) then
    raise exception 'يوجد اشتراكات شهرية متأخرة — يرجى سدادها قبل طلب قرض';
  end if;
  chk := public._loan_auto_check(v_m, p_amount);
  insert into public.loans(member_id, requested_amount, purpose, preferred_months, notes, auto_check, repayment_mode, preferred_start)
  values (v_m, p_amount, trim(p_purpose),
          least(120, greatest(1, case when v_mode = 'lump' then ((v_start - public.fund_today()) / 30)::int else v_count end)),
          p_notes, chk, v_mode, v_start)
  returning id into v;
  select full_name into v_name from public.members where id = v_m;

  if (chk->>'auto')::boolean then
    perform public._approve_loan(v, p_amount, v_count, 'monthly', null, v_start,
      'اعتماد تلقائي — صافي رصيد العضو يغطي القرض وسيولة الصندوق كافية', '00000000-0000-4000-8000-00000000a5f1');
    update public.loans set auto_approved = true where id = v;
    perform public._notify_managers('loan_auto_approved', 'قرض معتمد تلقائياً بانتظار الصرف',
      v_name || ' — ' || p_amount || ' ريال · ' || case when v_mode = 'lump' then 'دفعة واحدة ' || v_start else v_count || ' قسط' end,
      '/admin/loans/view?id=' || v);
  else
    perform public._notify_member(v_m, 'loan_received', 'تم استلام طلب القرض', 'طلبك بمبلغ ' || p_amount || ' ريال بانتظار موافقة مدير الصندوق.', '/member/loans/view?id=' || v);
    perform public._notify_managers('loan_request', 'طلب قرض بانتظار موافقتك',
      v_name || ' — ' || p_amount || ' ريال · ' || coalesce((chk->'reasons'->>0), ''), '/admin/loans/view?id=' || v);
  end if;
  perform public._log('create', 'loans', v::text, jsonb_build_object('amount', p_amount, 'auto', chk->'auto', 'mode', v_mode, 'start', v_start), null, 'طلب قرض');
  return v;
end $$;

/** Approval keeps the member's chosen start / payment date unless the manager sets another. */
create or replace function public._approve_loan(p_loan uuid, p_amount numeric, p_installments int, p_frequency text,
  p_fee numeric, p_first_due date, p_note text, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.loans; s public.fund_settings := public.settings(); v_fee numeric; v_first date;
begin
  select * into l from public.loans where id = p_loan for update;
  if not found or l.status <> 'pending' then raise exception 'لا يمكن اعتماد هذا الطلب'; end if;
  p_amount := public.money(p_amount);
  if l.repayment_mode = 'lump' then p_installments := 1; end if;
  if p_installments is null or p_installments < 1 or p_installments > 120 then raise exception 'عدد الأقساط غير صالح'; end if;
  if p_frequency not in ('monthly','quarterly') then raise exception 'دورية السداد غير صالحة'; end if;
  v_fee := coalesce(p_fee, round(p_amount * s.loan_default_fee_pct / 100, 2));
  if v_fee < 0 or v_fee <> round(v_fee,2) then raise exception 'الرسوم غير صالحة'; end if;
  v_first := coalesce(p_first_due, case when l.preferred_start > public.fund_today() then l.preferred_start end);
  if v_first is not null and v_first < public.fund_today() then raise exception 'تاريخ أول قسط لا يمكن أن يكون في الماضي'; end if;
  update public.loans set status = 'approved', approved_amount = p_amount, installments_count = p_installments,
         frequency = p_frequency, fee_amount = v_fee, first_due_date = v_first,
         decided_by = p_actor, decided_at = now(), decision_note = p_note where id = p_loan;
  perform public._notify_member(l.member_id, 'loan_approved', 'تمت الموافقة على قرضك',
    'تمت الموافقة على ' || p_amount || ' ريال ' || case when l.repayment_mode = 'lump' then 'تُسدد دفعة واحدة'
      else 'على ' || p_installments || ' قسط' end || '. سيتم إشعارك عند الصرف.', '/member/loans/view?id=' || p_loan);
end $$;

/** The member-facing "blocked" text no longer states the cap. */
create or replace function public._loan_auto_check(p_member uuid, p_amount numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.fund_settings := public.settings(); v_net numeric; liq jsonb; v_after numeric; reasons jsonb := '[]'::jsonb;
begin
  v_net := coalesce(public.member_net_position(p_member), 0);
  liq := public.fund_liquidity();
  v_after := (liq->>'liquid')::numeric - coalesce(p_amount, 0);
  if not s.loan_auto_approve then reasons := reasons || to_jsonb('القبول التلقائي متوقف من الإعدادات'::text); end if;
  if v_net - coalesce(p_amount, 0) < 0 then
    reasons := reasons || to_jsonb(('صافي رصيد العضو بعد القرض سالب (' || to_char(v_net - p_amount, 'FM999,999,990.00') || ' ريال)')::text);
  end if;
  if v_after < (liq->>'reserve')::numeric then
    reasons := reasons || to_jsonb('سيولة الصندوق بعد الصرف ستكون أقل من الاحتياطي المطلوب'::text);
  end if;
  return jsonb_build_object('auto', jsonb_array_length(reasons) = 0, 'net_before', v_net, 'net_after', v_net - coalesce(p_amount, 0),
    'blocked', case
      when s.loan_one_active_per_member and exists (select 1 from public.loans where member_id = p_member and status in ('pending','approved','disbursed','active','overdue'))
        then 'لديك طلب أو قرض قائم — لا يمكن تقديم طلب جديد قبل إغلاقه'
      when s.loan_block_if_overdue and exists (select 1 from public.v_contribution_status where member_id = p_member and is_overdue)
        then 'يوجد اشتراكات شهرية متأخرة — يرجى سدادها قبل طلب قرض'
      when coalesce(p_amount, 0) > s.loan_max_amount then 'المبلغ أكبر من المسموح بطلبه من المنصة — تواصل مع مدير الصندوق لتسجيل القرض' end,
    'max_auto', case when s.loan_auto_approve then greatest(0, least(v_net, (liq->>'liquid')::numeric - (liq->>'reserve')::numeric)) else 0 end,
    'liquid_after', v_after, 'reserve', (liq->>'reserve')::numeric, 'reasons', reasons, 'checked_at', now());
end $$;

-- ---------------------------------------------------------------- previews
/** Preview of a plan for a loan request (amount) or an open loan (its outstanding balance). */
create or replace function public.loan_plan_preview(p_amount numeric, p_mode text, p_start date, p_count int, p_loan uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_total numeric; v_start date; l record; v_cap numeric; v_count int := p_count;
begin
  if auth.uid() is null then raise exception 'غير مصرح'; end if;
  if p_loan is not null then
    select * into l from public.v_loan_summary where id = p_loan;
    if not found or not (public.is_manager() or l.member_id = public.current_member_id()) then raise exception 'القرض غير موجود'; end if;
    v_total := l.outstanding;
  else
    v_total := public.money(p_amount);
  end if;
  v_start := case when p_mode = 'lump' then p_start when p_start is not null then public._due_in_month(p_start)
                  else public._next_due(public.fund_today()) end;
  if not public.is_manager() and p_mode = 'installments' then   -- the manager may go above the cap
    v_cap := public._member_cap(public.current_member_id(), p_loan);
    v_count := public._capped_count(v_total, p_count, v_cap);
  end if;
  return jsonb_build_object('total', v_total, 'start', v_start, 'due_day', (public.settings()).loan_due_day,
    'min_installment', (public.settings()).loan_min_installment, 'monthly_cap', v_cap,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('seq', seq, 'due', due_date, 'amount', amount) order by seq)
                        from public._schedule_plan(v_total, p_mode, v_start, v_count)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- member reschedule requests
create table public.loan_reschedule_requests (
  id            uuid primary key default gen_random_uuid(),
  loan_id       uuid not null references public.loans(id),
  member_id     uuid not null references public.members(id),
  mode          text not null check (mode in ('installments','lump')),
  start_date    date not null,
  installments  smallint not null check (installments between 1 and 120),
  note          text check (length(note) <= 500),
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decision_note text,
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create unique index loan_reschedule_one_pending on public.loan_reschedule_requests(loan_id) where status = 'pending';
alter table public.loan_reschedule_requests enable row level security;
create policy own_or_manager on public.loan_reschedule_requests for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.is_manager()));
grant select on public.loan_reschedule_requests to authenticated;

create or replace function public.request_loan_reschedule(p_loan uuid, p_mode text, p_start date, p_count int, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_m uuid := public.assert_member(); l record; v uuid; v_start date; v_count int;
begin
  select * into l from public.v_loan_summary where id = p_loan;
  if not found or l.member_id <> v_m then raise exception 'القرض غير موجود'; end if;
  if l.status not in ('disbursed','active','overdue') or l.outstanding <= 0 then raise exception 'يمكن إعادة جدولة القروض القائمة فقط'; end if;
  if exists (select 1 from public.loan_reschedule_requests where loan_id = p_loan and status = 'pending') then
    raise exception 'لديك طلب إعادة جدولة قيد المراجعة لهذا القرض';
  end if;
  v_count := case when p_mode = 'lump' then 1 else p_count end;
  v_start := case when p_mode = 'lump' then p_start else public._due_in_month(p_start) end;
  perform public._check_member_plan(p_mode, v_start, v_count);
  if p_mode = 'installments' then v_count := public._capped_count(l.outstanding, v_count, public._member_cap(v_m, p_loan)); end if;
  insert into public.loan_reschedule_requests(loan_id, member_id, mode, start_date, installments, note)
  values (p_loan, v_m, p_mode, v_start, v_count, nullif(trim(p_note), '')) returning id into v;
  perform public._notify_managers('loan_reschedule', 'طلب إعادة جدولة قرض',
    l.member_name || ' — ' || l.loan_no || ' · ' || case when p_mode = 'lump' then 'دفعة كاملة ' || v_start
      else v_count || ' قسط من ' || v_start end, '/admin/loan-applications');
  perform public._notify_member(v_m, 'loan_reschedule_received', 'تم استلام طلب إعادة الجدولة',
    'جدولك الحالي يبقى سارياً حتى يوافق مدير الصندوق.', '/member/loans/view?id=' || p_loan);
  return v;
end $$;

create or replace function public.cancel_loan_reschedule(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.loan_reschedule_requests set status = 'cancelled', decided_at = now()
   where id = p_id and status = 'pending' and member_id = public.assert_member();
  get diagnostics n = row_count;
  if n = 0 then raise exception 'لا يمكن إلغاء هذا الطلب'; end if;
end $$;

create or replace function public.decide_loan_reschedule(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare q public.loan_reschedule_requests; v_actor uuid := public.assert_manager(); l public.loans;
begin
  select * into q from public.loan_reschedule_requests where id = p_id for update;
  if not found or q.status <> 'pending' then raise exception 'الطلب غير متاح للقرار'; end if;
  select * into l from public.loans where id = q.loan_id;
  if p_approve then
    perform public._apply_schedule(q.loan_id, q.mode, q.start_date, q.installments, coalesce(p_note, 'إعادة جدولة بطلب العضو'));
  end if;
  update public.loan_reschedule_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decision_note = p_note, decided_by = v_actor, decided_at = now() where id = p_id;
  perform public._notify_member(q.member_id, case when p_approve then 'loan_reschedule_approved' else 'loan_reschedule_rejected' end,
    case when p_approve then 'تمت الموافقة على إعادة جدولة قرضك' else 'لم تتم الموافقة على إعادة الجدولة' end,
    case when p_approve then case when q.mode = 'lump' then 'السداد دفعة واحدة بتاريخ ' || q.start_date
                                  else 'أول قسط بتاريخ ' || q.start_date end
         else coalesce(nullif(p_note, ''), 'يبقى جدولك الحالي كما هو.') end,
    '/member/loans/view?id=' || q.loan_id);
end $$;

-- ---------------------------------------------------------------- manager: direct + bulk
create or replace function public.admin_reschedule_loan(p_loan uuid, p_mode text, p_start date, p_count int, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare k int; l record;
begin
  perform public.assert_manager();
  if p_mode not in ('installments','lump') then raise exception 'طريقة السداد غير صالحة'; end if;
  if p_start is null or p_start < public.fund_today() then raise exception 'تاريخ البداية لا يمكن أن يكون في الماضي'; end if;
  if p_mode = 'installments' and (p_count is null or p_count < 1 or p_count > 120) then raise exception 'عدد الأقساط غير صالح'; end if;
  k := public._apply_schedule(p_loan, p_mode, p_start, case when p_mode = 'lump' then 1 else p_count end, coalesce(p_note, 'إعادة جدولة من مدير الصندوق'));
  update public.loan_reschedule_requests set status = 'cancelled', decision_note = 'أُعيدت الجدولة مباشرة من مدير الصندوق', decided_at = now()
   where loan_id = p_loan and status = 'pending';
  select * into l from public.loans where id = p_loan;
  perform public._notify_member(l.member_id, 'loan_rescheduled', 'تم تحديث جدول أقساط قرضك',
    case when p_mode = 'lump' then 'السداد دفعة واحدة بتاريخ ' || p_start else 'أول قسط بتاريخ ' || p_start end,
    '/member/loans/view?id=' || p_loan);
  return k;
end $$;

/** All open loans, grouped by member, with what a bulk plan would give them (monthly cap, loans one after another). */
create or replace function public.bulk_reschedule_preview(p_start date, p_count int, p_cap numeric default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cap numeric := coalesce(p_cap, (public.settings()).loan_member_monthly_cap);
begin
  perform public.assert_manager();
  return coalesce((select jsonb_agg(x order by (x->>'outstanding')::numeric desc) from (
    select jsonb_build_object('member_id', m.member_id, 'member_name', min(m.member_name), 'outstanding', sum(m.outstanding),
      'loans', jsonb_agg(jsonb_build_object('id', m.id, 'loan_no', m.loan_no, 'outstanding', m.outstanding, 'current_next', m.next_due_date,
                 'current_count', (select count(*) from public.loan_installments i where i.loan_id = m.id),
                 'rows', (select jsonb_agg(jsonb_build_object('due', p.due_date, 'amount', p.amount) order by p.due_date)
                            from public._member_seq_plan(m.member_id, p_start, p_count, v_cap) p where p.loan_id = m.id))
               order by m.disbursed_on, m.loan_no),
      'months', (select jsonb_agg(jsonb_build_object('due', due_date, 'amount', s) order by due_date) from (
                   select p.due_date, sum(p.amount) s from public._member_seq_plan(m.member_id, p_start, p_count, v_cap) p group by p.due_date) z)) x
      from public.v_loan_summary m where m.status in ('disbursed','active','overdue') and m.outstanding > 0
     group by m.member_id) q), '[]'::jsonb);
end $$;

create or replace function public.bulk_reschedule_apply(p_start date, p_count int, p_loans uuid[] default null, p_cap numeric default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_cap numeric := coalesce(p_cap, (public.settings()).loan_member_monthly_cap); mem record; r record; n int := 0; v_rows jsonb;
begin
  perform public.assert_manager();
  if p_start is null or p_start < public.fund_today() then raise exception 'تاريخ البداية لا يمكن أن يكون في الماضي'; end if;
  if p_count is null or p_count < 1 or p_count > 120 then raise exception 'عدد الأقساط غير صالح'; end if;
  for mem in select distinct member_id from public.v_loan_summary where status in ('disbursed','active','overdue') and outstanding > 0
               and (p_loans is null or id = any(p_loans)) loop
    for r in select id from public.v_loan_summary where member_id = mem.member_id and status in ('disbursed','active','overdue')
               and outstanding > 0 and (p_loans is null or id = any(p_loans)) loop
      perform 1 from public.loans where id = r.id for update;
      select coalesce(jsonb_agg(jsonb_build_object('due', due_date, 'amount', amount) order by due_date), '[]'::jsonb) into v_rows
        from public._member_seq_plan(mem.member_id, p_start, p_count, v_cap, p_loans) p where p.loan_id = r.id;
      perform public._rewrite_schedule(r.id, public._settled_row(r.id, p_start) || v_rows, 'installments', 'جدولة جماعية');
      update public.loan_reschedule_requests set status = 'cancelled', decision_note = 'شملته الجدولة الجماعية', decided_at = now()
       where loan_id = r.id and status = 'pending';
      n := n + 1;
    end loop;
    perform public._notify_member(mem.member_id, 'loan_rescheduled', 'تمت جدولة أقساط قرضك',
      'أول قسط بتاريخ ' || p_start || ' — تقدر تشوف الجدول كامل وتطلب تعديله من صفحة القرض.', '/member/loans');
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- policy settings
create or replace function public.set_loan_schedule_policy(p_due_day int, p_min numeric, p_cap numeric) returns void
language plpgsql security definer set search_path = public as $$
declare o jsonb;
begin
  perform public.assert_manager();
  if p_due_day is null or p_due_day < 1 or p_due_day > 28 then raise exception 'يوم الاستحقاق بين 1 و 28'; end if;
  if p_min is null or p_min <= 0 then raise exception 'الحد الأدنى للقسط غير صالح'; end if;
  if p_cap is not null and p_cap < p_min then raise exception 'حد الأقساط الشهرية أقل من الحد الأدنى للقسط'; end if;
  select jsonb_build_object('due_day', loan_due_day, 'min', loan_min_installment, 'cap', loan_member_monthly_cap) into o from public.fund_settings where id = 1;
  update public.fund_settings set loan_due_day = p_due_day, loan_min_installment = p_min, loan_member_monthly_cap = nullif(p_cap, 0),
         updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._log('policy_change', 'fund_settings', '1', jsonb_build_object('due_day', p_due_day, 'min', p_min, 'cap', p_cap), o, 'سياسة جدولة الأقساط');
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public._due_in_month(date), public._next_due(date), public._schedule_plan(numeric,text,date,int,text),
  public._check_member_plan(text,date,int), public._apply_schedule(uuid,text,date,int,text), public.trg_installments_guard(),
  public._capped_count(numeric,int,numeric), public._member_cap(uuid,uuid), public._rewrite_schedule(uuid,jsonb,text,text,boolean),
  public._settled_row(uuid,date), public._member_seq_plan(uuid,date,int,numeric,uuid[]), public._apply_extra_payment(uuid,date),
  public.trg_loan_repayment_extra()
  from public, anon, authenticated;
revoke execute on function public.request_loan(numeric,text,int,text,text,date), public.loan_plan_preview(numeric,text,date,int,uuid),
  public.request_loan_reschedule(uuid,text,date,int,text), public.cancel_loan_reschedule(uuid), public.decide_loan_reschedule(uuid,boolean,text),
  public.admin_reschedule_loan(uuid,text,date,int,text), public.bulk_reschedule_preview(date,int,numeric), public.bulk_reschedule_apply(date,int,uuid[],numeric)
  from public, anon;
revoke execute on function public.set_loan_schedule_policy(int,numeric,numeric) from public, anon;
grant execute on function public.set_loan_schedule_policy(int,numeric,numeric) to authenticated;
grant execute on function public.request_loan(numeric,text,int,text,text,date), public.loan_plan_preview(numeric,text,date,int,uuid),
  public.request_loan_reschedule(uuid,text,date,int,text), public.cancel_loan_reschedule(uuid), public.decide_loan_reschedule(uuid,boolean,text),
  public.admin_reschedule_loan(uuid,text,date,int,text), public.bulk_reschedule_preview(date,int,numeric), public.bulk_reschedule_apply(date,int,uuid[],numeric)
  to authenticated;
