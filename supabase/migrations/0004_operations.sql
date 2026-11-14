-- =====================================================================
-- Financial operations (the API). Each function = one atomic DB transaction.
-- Every money movement: financial_transactions row + balanced journal entry
-- + sub-ledger row, committed together or not at all.
-- =====================================================================

-- ---------------------------------------------------------------- users
create or replace function public._create_auth_user(p_email text, p_password text, p_full_name text, p_role text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := gen_random_uuid(); v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'البريد الإلكتروني غير صالح'; end if;
  if p_password is null or length(p_password) < 8 then raise exception 'كلمة المرور يجب ألا تقل عن 8 أحرف'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'البريد الإلكتروني مستخدم مسبقاً'; end if;
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                         confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', p_full_name),
          now(), now(), '', '', '', '');
  insert into auth.identities(id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid::text, v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  insert into public.app_users(id, role, email, full_name) values (v_uid, p_role, v_email, trim(p_full_name));
  return v_uid;
end $$;

create or replace function public.admin_create_member(p_full_name text, p_email text, p_password text,
  p_phone text default null, p_join_date date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_mid uuid;
begin
  perform public.assert_manager();
  v_uid := public._create_auth_user(p_email, p_password, p_full_name, 'member');
  insert into public.members(user_id, full_name, phone, email, join_date, notes, created_by)
  values (v_uid, trim(p_full_name), nullif(trim(p_phone),''), lower(trim(p_email)),
          coalesce(p_join_date, public.fund_today()), p_notes, auth.uid())
  returning id into v_mid;
  perform public.generate_contribution_obligations();
  perform public._notify(v_uid, 'welcome', 'مرحباً بك في الصندوق', 'تم إنشاء حسابك بنجاح. يمكنك متابعة اشتراكاتك وودائعك وقروضك من لوحة التحكم.', '/member');
  return v_mid;
end $$;

create or replace function public.admin_update_member(p_member uuid, p_full_name text, p_phone text,
  p_notes text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare m public.members;
begin
  perform public.assert_manager();
  select * into m from public.members where id = p_member for update;
  if not found then raise exception 'العضو غير موجود'; end if;
  if p_status not in ('active','inactive') then raise exception 'حالة غير صالحة'; end if;
  if p_status = 'inactive' and m.status = 'active' and exists (
       select 1 from public.v_member_balances where member_id = p_member and (deposit_balance > 0 or loan_outstanding > 0)) then
    raise exception 'لا يمكن تعطيل عضو لديه ودائع أو قروض قائمة — قم بتسويتها أولاً';
  end if;
  update public.members set full_name = trim(p_full_name), phone = nullif(trim(p_phone),''), notes = p_notes, status = p_status
   where id = p_member;
  update public.app_users set full_name = trim(p_full_name), is_active = (p_status = 'active') where id = m.user_id;
end $$;

create or replace function public.admin_reset_password(p_member uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid;
begin
  perform public.assert_manager();
  if p_password is null or length(p_password) < 8 then raise exception 'كلمة المرور يجب ألا تقل عن 8 أحرف'; end if;
  select user_id into v_uid from public.members where id = p_member;
  if v_uid is null then raise exception 'العضو غير موجود'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = v_uid;
  perform public._log('reset_password', 'members', p_member::text);
end $$;

create or replace function public.update_my_profile(p_full_name text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or public.current_app_role() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if length(trim(coalesce(p_full_name,''))) < 2 then raise exception 'الاسم مطلوب'; end if;
  update public.app_users set full_name = trim(p_full_name) where id = v_uid;
  update public.members set full_name = trim(p_full_name), phone = nullif(trim(p_phone),'') where user_id = v_uid;
end $$;

-- -------------------------------------------------------- contributions
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
   where m.status = 'active'
  on conflict (member_id, period) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.record_contribution_payment(p_member uuid, p_period date, p_amount numeric,
  p_paid_on date, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tx uuid; m public.members; v_c uuid; v_out numeric; v_period date; s public.fund_settings := public.settings(); v_acct text;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  p_amount := public.money(p_amount);
  v_period := date_trunc('month', p_period)::date;
  select * into m from public.members where id = p_member for update;
  if not found then raise exception 'العضو غير موجود'; end if;
  if v_period > date_trunc('month', public.fund_today() + interval '12 months') then
    raise exception 'لا يمكن السداد المسبق لأكثر من 12 شهراً';
  end if;
  select id into v_c from public.contributions where member_id = p_member and period = v_period;
  if v_c is null then
    insert into public.contributions(member_id, period, amount_due, due_date)
    values (p_member, v_period, s.monthly_contribution, v_period + (s.contribution_due_day - 1)) returning id into v_c;
  end if;
  select amount_outstanding into v_out from public.v_contribution_status where id = v_c;
  if v_out <= 0 then raise exception 'اشتراك شهر % مسدد بالكامل', to_char(v_period, 'YYYY-MM'); end if;
  if p_amount > v_out then raise exception 'المبلغ (%) يتجاوز المستحق لهذا الشهر (%)', p_amount, v_out; end if;
  v_acct := case s.contribution_treatment when 'liability_refundable' then 'contrib_refundable' else 'contrib_capital' end;
  v_tx := public._new_tx('contribution_payment', p_paid_on,
            'اشتراك شهري ' || to_char(v_period, 'YYYY-MM') || ' — ' || m.full_name, p_amount, p_member,
            null, null, p_reference, p_key);
  perform public._post(v_tx, p_paid_on, 'اشتراك شهري ' || to_char(v_period, 'YYYY-MM') || ' — ' || m.full_name,
    jsonb_build_array(jsonb_build_object('a','cash','dr',p_amount),
                      jsonb_build_object('a',v_acct,'cr',p_amount,'m',p_member)));
  insert into public.contribution_payments(contribution_id, member_id, amount, paid_on, reference, financial_transaction_id, created_by)
  values (v_c, p_member, p_amount, p_paid_on, nullif(trim(p_reference),''), v_tx, auth.uid());
  perform public._notify_member(p_member, 'contribution_recorded', 'تم تسجيل اشتراكك',
    'تم استلام ' || p_amount || ' ريال عن اشتراك شهر ' || to_char(v_period, 'YYYY-MM') || '.', '/member/contributions');
  return v_tx;
end $$;

-- ------------------------------------------------------------- deposits
create or replace function public.request_deposit(p_amount numeric, p_method text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m uuid := public.assert_member(); v uuid;
begin
  insert into public.member_deposits(member_id, amount, method, request_note)
  values (v_m, public.money(p_amount), p_method, p_note) returning id into v;
  perform public._notify_managers('deposit_request', 'طلب إيداع جديد',
    (select full_name from public.members where id = v_m) || ' — ' || p_amount || ' ريال', '/admin/deposits');
  return v;
end $$;

create or replace function public._post_deposit(p_member uuid, p_amount numeric, p_date date, p_ref text, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tx uuid; v_name text;
begin
  select full_name into v_name from public.members where id = p_member;
  v_tx := public._new_tx('deposit', p_date, 'إيداع اختياري — ' || v_name, p_amount, p_member, null, null, p_ref, p_key);
  perform public._post(v_tx, p_date, 'إيداع اختياري — ' || v_name,
    jsonb_build_array(jsonb_build_object('a','cash','dr',p_amount),
                      jsonb_build_object('a','member_deposits','cr',p_amount,'m',p_member)));
  return v_tx;
end $$;

create or replace function public.record_deposit(p_member uuid, p_amount numeric, p_date date,
  p_method text default null, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tx uuid;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  perform 1 from public.members where id = p_member and status = 'active' for update;
  if not found then raise exception 'العضو غير موجود أو غير نشط'; end if;
  p_amount := public.money(p_amount);
  v_tx := public._post_deposit(p_member, p_amount, p_date, p_reference, p_key);
  insert into public.member_deposits(member_id, amount, status, method, deposited_on, reference, financial_transaction_id, decided_by, decided_at)
  values (p_member, p_amount, 'confirmed', p_method, p_date, nullif(trim(p_reference),''), v_tx, auth.uid(), now());
  perform public._notify_member(p_member, 'deposit_received', 'تم استلام إيداعك', 'تم إضافة ' || p_amount || ' ريال إلى رصيد ودائعك.', '/member/deposits');
  return v_tx;
end $$;

create or replace function public.confirm_deposit(p_deposit uuid, p_date date, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.member_deposits; v_tx uuid;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  select * into d from public.member_deposits where id = p_deposit for update;
  if not found then raise exception 'طلب الإيداع غير موجود'; end if;
  if d.status <> 'requested' then raise exception 'لا يمكن تأكيد طلب حالته "%"', d.status; end if;
  v_tx := public._post_deposit(d.member_id, d.amount, p_date, p_reference, p_key);
  update public.member_deposits set status = 'confirmed', deposited_on = p_date, reference = nullif(trim(p_reference),''),
         financial_transaction_id = v_tx, decided_by = auth.uid(), decided_at = now() where id = p_deposit;
  perform public._notify_member(d.member_id, 'deposit_received', 'تم استلام إيداعك', 'تم تأكيد إيداع ' || d.amount || ' ريال.', '/member/deposits');
  return v_tx;
end $$;

create or replace function public.reject_deposit(p_deposit uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.member_deposits;
begin
  perform public.assert_manager();
  select * into d from public.member_deposits where id = p_deposit for update;
  if not found or d.status <> 'requested' then raise exception 'لا يمكن رفض هذا الطلب'; end if;
  update public.member_deposits set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_deposit;
  perform public._notify_member(d.member_id, 'deposit_rejected', 'لم يتم تأكيد طلب الإيداع', coalesce(p_note, ''), '/member/deposits');
end $$;

-- ---------------------------------------------------------- withdrawals
create or replace function public.request_withdrawal(p_amount numeric, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m uuid := public.assert_member(); v_avail numeric; v uuid;
begin
  perform 1 from public.members where id = v_m for update;
  p_amount := public.money(p_amount);
  if p_amount < (public.settings()).withdrawal_min_amount then
    raise exception 'الحد الأدنى للسحب % ريال', (public.settings()).withdrawal_min_amount;
  end if;
  select available_to_withdraw into v_avail from public.v_member_balances where member_id = v_m;
  if p_amount > v_avail then raise exception 'المبلغ المطلوب يتجاوز الرصيد المتاح للسحب (% ريال)', v_avail; end if;
  insert into public.deposit_withdrawals(member_id, amount, reason) values (v_m, p_amount, p_reason) returning id into v;
  perform public._notify_managers('withdrawal_request', 'طلب سحب وديعة',
    (select full_name from public.members where id = v_m) || ' — ' || p_amount || ' ريال', '/admin/withdrawals');
  return v;
end $$;

create or replace function public.approve_withdrawal(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare w public.deposit_withdrawals; v_bal numeric; v_other numeric;
begin
  perform public.assert_manager();
  select * into w from public.deposit_withdrawals where id = p_id for update;
  if not found or w.status <> 'pending' then raise exception 'لا يمكن اعتماد هذا الطلب'; end if;
  select deposit_balance into v_bal from public.v_member_balances where member_id = w.member_id;
  select coalesce(sum(amount),0) into v_other from public.deposit_withdrawals
   where member_id = w.member_id and status = 'approved' and id <> p_id;
  if w.amount > v_bal - v_other then raise exception 'رصيد الودائع لا يغطي هذا الطلب'; end if;
  update public.deposit_withdrawals set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
  perform public._notify_member(w.member_id, 'withdrawal_approved', 'تمت الموافقة على طلب السحب',
    'تمت الموافقة على سحب ' || w.amount || ' ريال، وسيتم الصرف قريباً.', '/member/deposits');
end $$;

create or replace function public.reject_withdrawal(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare w public.deposit_withdrawals;
begin
  perform public.assert_manager();
  select * into w from public.deposit_withdrawals where id = p_id for update;
  if not found or w.status not in ('pending','approved') then raise exception 'لا يمكن رفض هذا الطلب'; end if;
  update public.deposit_withdrawals set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_id;
  perform public._notify_member(w.member_id, 'withdrawal_rejected', 'تم رفض طلب السحب', coalesce(p_note,''), '/member/deposits');
end $$;

create or replace function public.pay_withdrawal(p_id uuid, p_paid_on date, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare w public.deposit_withdrawals; v_tx uuid; v_bal numeric; v_name text;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  select * into w from public.deposit_withdrawals where id = p_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if w.status <> 'approved' then raise exception 'يجب اعتماد الطلب قبل الصرف (الحالة الحالية: %)', w.status; end if;
  if p_paid_on < (w.requested_at at time zone 'Asia/Riyadh')::date + (public.settings()).withdrawal_notice_days then
    raise exception 'لم تنتهِ مدة الإشعار المطلوبة قبل الصرف';
  end if;
  perform 1 from public.members where id = w.member_id for update;
  select deposit_balance, full_name into v_bal, v_name from public.v_member_balances where member_id = w.member_id;
  if w.amount > v_bal then raise exception 'رصيد الودائع (%) أقل من مبلغ السحب', v_bal; end if;
  perform public._assert_cash(w.amount);
  v_tx := public._new_tx('withdrawal_payment', p_paid_on, 'صرف سحب وديعة — ' || v_name, w.amount, w.member_id, null, null, p_reference, p_key);
  perform public._post(v_tx, p_paid_on, 'صرف سحب وديعة — ' || v_name,
    jsonb_build_array(jsonb_build_object('a','member_deposits','dr',w.amount,'m',w.member_id),
                      jsonb_build_object('a','cash','cr',w.amount)));
  update public.deposit_withdrawals set status = 'paid', paid_on = p_paid_on, reference = nullif(trim(p_reference),''),
         financial_transaction_id = v_tx where id = p_id;
  perform public._notify_member(w.member_id, 'withdrawal_paid', 'تم صرف مبلغ السحب', 'تم تحويل ' || w.amount || ' ريال إليك.', '/member/deposits');
  return v_tx;
end $$;

create or replace function public.cancel_my_request(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_m uuid := public.assert_member(); n int;
begin
  if p_kind = 'deposit' then
    update public.member_deposits set status = 'cancelled' where id = p_id and member_id = v_m and status = 'requested';
  elsif p_kind = 'withdrawal' then
    update public.deposit_withdrawals set status = 'cancelled' where id = p_id and member_id = v_m and status = 'pending';
  elsif p_kind = 'loan' then
    update public.loans set status = 'cancelled', decision_note = 'ألغاه العضو' where id = p_id and member_id = v_m and status = 'pending';
  else raise exception 'نوع غير معروف'; end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'لا يمكن إلغاء هذا الطلب'; end if;
end $$;

-- ---------------------------------------------------------------- loans
create or replace function public.request_loan(p_amount numeric, p_purpose text, p_months int, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m uuid := public.assert_member(); s public.fund_settings := public.settings(); v uuid;
begin
  perform 1 from public.members where id = v_m for update;
  p_amount := public.money(p_amount);
  if p_amount > s.loan_max_amount then raise exception 'الحد الأعلى للقرض % ريال', s.loan_max_amount; end if;
  if p_months is null or p_months < 1 or p_months > s.loan_max_months then raise exception 'مدة السداد يجب أن تكون بين 1 و % شهراً', s.loan_max_months; end if;
  if length(trim(coalesce(p_purpose,''))) < 3 then raise exception 'يرجى توضيح الغرض من القرض'; end if;
  if s.loan_one_active_per_member and exists (select 1 from public.loans where member_id = v_m
       and status in ('pending','approved','disbursed','active','overdue')) then
    raise exception 'لديك طلب أو قرض قائم — لا يمكن تقديم طلب جديد قبل إغلاقه';
  end if;
  if s.loan_block_if_overdue and exists (select 1 from public.v_contribution_status where member_id = v_m and is_overdue) then
    raise exception 'يوجد اشتراكات شهرية متأخرة — يرجى سدادها قبل طلب قرض';
  end if;
  insert into public.loans(member_id, requested_amount, purpose, preferred_months, notes)
  values (v_m, p_amount, trim(p_purpose), p_months, p_notes) returning id into v;
  perform public._notify_member(v_m, 'loan_received', 'تم استلام طلب القرض', 'طلبك بمبلغ ' || p_amount || ' ريال قيد المراجعة.', '/member/loans/view?id=' || v);
  perform public._notify_managers('loan_request', 'طلب قرض جديد',
    (select full_name from public.members where id = v_m) || ' — ' || p_amount || ' ريال', '/admin/loans/view?id=' || v);
  return v;
end $$;

create or replace function public.approve_loan(p_loan uuid, p_amount numeric, p_installments int, p_frequency text,
  p_fee numeric default null, p_first_due date default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare l public.loans; s public.fund_settings := public.settings(); v_fee numeric;
begin
  perform public.assert_manager();
  select * into l from public.loans where id = p_loan for update;
  if not found or l.status <> 'pending' then raise exception 'لا يمكن اعتماد هذا الطلب'; end if;
  p_amount := public.money(p_amount);
  if p_installments is null or p_installments < 1 or p_installments > 120 then raise exception 'عدد الأقساط غير صالح'; end if;
  if p_frequency not in ('monthly','quarterly') then raise exception 'دورية السداد غير صالحة'; end if;
  v_fee := coalesce(p_fee, round(p_amount * s.loan_default_fee_pct / 100, 2));
  if v_fee < 0 or v_fee <> round(v_fee,2) then raise exception 'الرسوم غير صالحة'; end if;
  if p_first_due is not null and p_first_due < public.fund_today() then raise exception 'تاريخ أول قسط لا يمكن أن يكون في الماضي'; end if;
  update public.loans set status = 'approved', approved_amount = p_amount, installments_count = p_installments,
         frequency = p_frequency, fee_amount = v_fee, first_due_date = p_first_due,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_loan;
  perform public._notify_member(l.member_id, 'loan_approved', 'تمت الموافقة على قرضك',
    'تمت الموافقة على ' || p_amount || ' ريال على ' || p_installments || ' قسط. سيتم إشعارك عند الصرف.', '/member/loans/view?id=' || p_loan);
end $$;

create or replace function public.reject_loan(p_loan uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.loans;
begin
  perform public.assert_manager();
  select * into l from public.loans where id = p_loan for update;
  if not found or l.status <> 'pending' then raise exception 'لا يمكن رفض هذا الطلب'; end if;
  update public.loans set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_loan;
  perform public._notify_member(l.member_id, 'loan_rejected', 'تم رفض طلب القرض', coalesce(p_note,''), '/member/loans/view?id=' || p_loan);
end $$;

create or replace function public.cancel_loan(p_loan uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare l public.loans;
begin
  perform public.assert_manager();
  select * into l from public.loans where id = p_loan for update;
  if not found or l.status not in ('pending','approved') then raise exception 'يمكن إلغاء القروض غير المصروفة فقط'; end if;
  update public.loans set status = 'cancelled', decision_note = p_note, decided_by = auth.uid(), decided_at = now() where id = p_loan;
  perform public._notify_member(l.member_id, 'loan_cancelled', 'تم إلغاء القرض', coalesce(p_note,''), '/member/loans');
end $$;

create or replace function public.disburse_loan(p_loan uuid, p_date date, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.loans; v_tx uuid; v_total numeric; v_each numeric; v_first date; v_step interval; i int; v_name text;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  select * into l from public.loans where id = p_loan for update;
  if not found then raise exception 'القرض غير موجود'; end if;
  if l.status <> 'approved' then raise exception 'لا يمكن صرف قرض حالته "%" — يجب اعتماده أولاً', l.status; end if;
  perform public._assert_cash(l.approved_amount);
  select full_name into v_name from public.members where id = l.member_id;
  v_step := case l.frequency when 'quarterly' then interval '3 months' else interval '1 month' end;
  v_first := coalesce(l.first_due_date, (p_date + v_step)::date);
  if v_first <= p_date then raise exception 'تاريخ أول قسط يجب أن يكون بعد تاريخ الصرف'; end if;
  v_total := l.approved_amount + l.fee_amount;
  v_tx := public._new_tx('loan_disbursement', p_date, 'صرف قرض ' || l.loan_no || ' — ' || v_name, l.approved_amount,
                         l.member_id, l.id, null, p_reference, p_key);
  perform public._post(v_tx, p_date, 'صرف قرض ' || l.loan_no || ' — ' || v_name,
    jsonb_build_array(jsonb_build_object('a','loans_receivable','dr',v_total,'m',l.member_id),
                      jsonb_build_object('a','cash','cr',l.approved_amount),
                      jsonb_build_object('a','loan_fee_income','cr',l.fee_amount)));
  v_each := trunc(v_total / l.installments_count, 2);
  for i in 1..l.installments_count loop
    insert into public.loan_installments(loan_id, seq, due_date, amount_due)
    values (l.id, i, (v_first + v_step * (i-1))::date,
            case when i = l.installments_count then v_total - v_each * (l.installments_count - 1) else v_each end);
  end loop;
  update public.loans set status = 'disbursed', disbursed_on = p_date, disbursement_tx_id = v_tx, first_due_date = v_first where id = l.id;
  perform public._notify_member(l.member_id, 'loan_disbursed', 'تم صرف القرض',
    'تم صرف ' || l.approved_amount || ' ريال. أول قسط بتاريخ ' || v_first || '.', '/member/loans/view?id=' || l.id);
  return v_tx;
end $$;

create or replace function public._refresh_loan_status(p_loan uuid) returns text
language plpgsql security definer set search_path = public as $$
declare l record; v_new text;
begin
  select * into l from public.v_loan_summary where id = p_loan;
  if l.status not in ('disbursed','active','overdue','fully_repaid') then return l.status; end if;
  if not exists (select 1 from public.v_active_tx where id = l.disbursement_tx_id) then return l.status; end if;
  v_new := case when l.outstanding <= 0 then 'fully_repaid'
                when l.overdue_count > 0 then 'overdue'
                when l.amount_repaid > 0 then 'active'
                else 'disbursed' end;
  if v_new <> l.status then
    update public.loans set status = v_new,
           closed_on = case when v_new = 'fully_repaid' then (select max(paid_on) from public.loan_repayments where loan_id = p_loan) end
     where id = p_loan;
    if v_new = 'fully_repaid' then
      perform public._notify_member(l.member_id, 'loan_repaid', 'تم سداد القرض بالكامل', 'شكراً لك، تم إغلاق القرض ' || l.loan_no || '.', '/member/loans');
    elsif v_new = 'overdue' then
      perform public._notify_member(l.member_id, 'repayment_overdue', 'قسط متأخر', 'لديك قسط متأخر على القرض ' || l.loan_no || '.',
                                    '/member/loans/view?id=' || l.id, 'loan-overdue-' || l.id || '-' || public.fund_today());
    end if;
  end if;
  return v_new;
end $$;

create or replace function public.refresh_loan_statuses() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_old text;
begin
  if auth.uid() is not null then perform public.assert_manager(); end if;
  for r in select id, status from public.loans where status in ('disbursed','active','overdue') loop
    if public._refresh_loan_status(r.id) <> r.status then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.record_loan_repayment(p_loan uuid, p_amount numeric, p_paid_on date,
  p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare l record; v_tx uuid;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  perform 1 from public.loans where id = p_loan for update;
  select * into l from public.v_loan_summary where id = p_loan;
  if l.id is null then raise exception 'القرض غير موجود'; end if;
  if l.status not in ('disbursed','active','overdue') then raise exception 'لا يمكن تسجيل سداد لقرض حالته "%"', l.status; end if;
  p_amount := public.money(p_amount);
  if p_paid_on < l.disbursed_on then raise exception 'تاريخ السداد قبل تاريخ الصرف'; end if;
  if p_amount > l.outstanding then raise exception 'المبلغ (%) يتجاوز الرصيد القائم (%)', p_amount, l.outstanding; end if;
  v_tx := public._new_tx('loan_repayment', p_paid_on, 'سداد قرض ' || l.loan_no || ' — ' || l.member_name, p_amount,
                         l.member_id, l.id, null, p_reference, p_key);
  perform public._post(v_tx, p_paid_on, 'سداد قرض ' || l.loan_no || ' — ' || l.member_name,
    jsonb_build_array(jsonb_build_object('a','cash','dr',p_amount),
                      jsonb_build_object('a','loans_receivable','cr',p_amount,'m',l.member_id)));
  insert into public.loan_repayments(loan_id, member_id, amount, paid_on, reference, financial_transaction_id, created_by)
  values (l.id, l.member_id, p_amount, p_paid_on, nullif(trim(p_reference),''), v_tx, auth.uid());
  perform public._notify_member(l.member_id, 'repayment_recorded', 'تم تسجيل سداد القسط',
    'تم استلام ' || p_amount || ' ريال. المتبقي: ' || (l.outstanding - p_amount) || ' ريال.', '/member/loans/view?id=' || l.id);
  perform public._refresh_loan_status(l.id);
  return v_tx;
end $$;

-- ---------------------------------------------------------- investments
create or replace function public._inv_tx(p_inv uuid, p_kind text, p_date date, p_cash numeric, p_cost numeric,
  p_unreal numeric, p_realized numeric, p_val numeric, p_note text, p_tx uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.investment_transactions(investment_id, kind, tx_date, cash_amount, cost_delta, unrealized_delta,
                                             realized_pl, valuation_after, note, financial_transaction_id)
  values (p_inv, p_kind, p_date, p_cash, p_cost, p_unreal, p_realized, p_val, p_note, p_tx)
$$;

create or replace function public.add_investment_capital(p_inv uuid, p_amount numeric, p_date date,
  p_note text default null, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.investments; v_tx uuid;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  select * into i from public.investments where id = p_inv for update;
  if not found or i.status <> 'active' then raise exception 'الاستثمار غير موجود أو غير نشط'; end if;
  p_amount := public.money(p_amount);
  perform public._assert_cash(p_amount);
  v_tx := public._new_tx('investment_capital', p_date, 'ضخ رأس مال — ' || i.name, p_amount, null, null, p_inv, p_reference, p_key);
  perform public._post(v_tx, p_date, 'ضخ رأس مال — ' || i.name,
    jsonb_build_array(jsonb_build_object('a','investments_cost','dr',p_amount), jsonb_build_object('a','cash','cr',p_amount)));
  perform public._inv_tx(p_inv, 'capital_in', p_date, p_amount, p_amount, 0, 0, null, p_note, v_tx);
  return v_tx;
end $$;

create or replace function public.create_investment(p_name text, p_category text, p_description text, p_provider text,
  p_date date, p_maturity date, p_capital numeric, p_notes text default null, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform public.assert_manager();
  if p_key is not null and public._existing_tx(p_key) is not null then
    return (select investment_id from public.financial_transactions where idempotency_key = p_key);
  end if;
  if not exists (select 1 from jsonb_array_elements((public.settings()).investment_categories) c where c->>'key' = p_category) then
    raise exception 'فئة الاستثمار غير معتمدة';
  end if;
  if p_maturity is not null and p_maturity <= p_date then raise exception 'تاريخ الاستحقاق يجب أن يكون بعد تاريخ الاستثمار'; end if;
  insert into public.investments(name, category, description, provider, investment_date, maturity_date, notes, created_by)
  values (trim(p_name), p_category, p_description, p_provider, p_date, p_maturity, p_notes, auth.uid()) returning id into v;
  perform public.add_investment_capital(v, p_capital, p_date, 'رأس المال الأولي', p_reference, p_key);
  return v;
end $$;

create or replace function public.update_investment(p_inv uuid, p_name text, p_description text, p_provider text,
  p_maturity date, p_notes text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.investments;
begin
  perform public.assert_manager();
  select * into i from public.investments where id = p_inv for update;
  if not found then raise exception 'الاستثمار غير موجود'; end if;
  if i.status = 'exited' then raise exception 'لا يمكن تعديل استثمار تم التخارج منه'; end if;
  if p_status not in ('active','matured') then raise exception 'حالة غير صالحة'; end if;
  update public.investments set name = trim(p_name), description = p_description, provider = p_provider,
         maturity_date = p_maturity, notes = p_notes, status = p_status where id = p_inv;
end $$;

create or replace function public.revalue_investment(p_inv uuid, p_valuation numeric, p_date date, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare p record; v_delta numeric; v_tx uuid;
begin
  perform public.assert_manager();
  perform 1 from public.investments where id = p_inv for update;
  select * into p from public.v_investment_positions where id = p_inv;
  if p.id is null or p.status = 'exited' then raise exception 'الاستثمار غير موجود أو تم التخارج منه'; end if;
  if p_valuation is null or p_valuation < 0 or p_valuation <> round(p_valuation,2) then raise exception 'القيمة غير صالحة'; end if;
  v_delta := (p_valuation - p.cost_basis) - p.unrealized_pl;
  if v_delta = 0 then raise exception 'القيمة الجديدة مطابقة للقيمة الحالية'; end if;
  v_tx := public._new_tx('investment_revaluation', p_date, 'إعادة تقييم — ' || p.name, abs(v_delta), null, null, p_inv);
  perform public._post(v_tx, p_date, 'إعادة تقييم (غير محققة) — ' || p.name,
    jsonb_build_array(jsonb_build_object('a','investments_fv','dr',v_delta),
                      jsonb_build_object('a','unrealized_reserve','cr',v_delta)));
  perform public._inv_tx(p_inv, 'revaluation', p_date, 0, 0, v_delta, 0, p_valuation, p_note, v_tx);
  return v_tx;
end $$;

create or replace function public.record_investment_income(p_inv uuid, p_amount numeric, p_date date,
  p_note text default null, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.investments; v_tx uuid;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  select * into i from public.investments where id = p_inv for update;
  if not found then raise exception 'الاستثمار غير موجود'; end if;
  p_amount := public.money(p_amount);
  v_tx := public._new_tx('investment_income', p_date, 'عائد استثمار محقق — ' || i.name, p_amount, null, null, p_inv, p_reference, p_key);
  perform public._post(v_tx, p_date, 'عائد استثمار محقق — ' || i.name,
    jsonb_build_array(jsonb_build_object('a','cash','dr',p_amount), jsonb_build_object('a','investment_income','cr',p_amount)));
  perform public._inv_tx(p_inv, 'income', p_date, p_amount, 0, 0, p_amount, null, p_note, v_tx);
  return v_tx;
end $$;

-- Full or partial exit. Realized P/L = proceeds - cost portion. Unrealized reserve is released proportionally.
create or replace function public.exit_investment(p_inv uuid, p_proceeds numeric, p_date date, p_cost_portion numeric default null,
  p_note text default null, p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare p record; v_tx uuid; v_cost numeric; v_unreal numeric; v_gain numeric; v_full boolean;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  perform 1 from public.investments where id = p_inv for update;
  select * into p from public.v_investment_positions where id = p_inv;
  if p.id is null or p.status = 'exited' then raise exception 'الاستثمار غير موجود أو تم التخارج منه'; end if;
  if p_proceeds is null or p_proceeds < 0 or p_proceeds <> round(p_proceeds,2) then raise exception 'مبلغ التخارج غير صالح'; end if;
  v_cost := coalesce(p_cost_portion, p.cost_basis);
  if v_cost <= 0 or v_cost > p.cost_basis then raise exception 'التكلفة المتخارج منها يجب أن تكون بين 0 و %', p.cost_basis; end if;
  v_full := (v_cost = p.cost_basis);
  v_unreal := case when v_full then p.unrealized_pl else round(p.unrealized_pl * v_cost / p.cost_basis, 2) end;
  v_gain := p_proceeds - v_cost;
  v_tx := public._new_tx('investment_exit', p_date, case when v_full then 'تخارج كامل — ' else 'تخارج جزئي — ' end || p.name,
                         p_proceeds, null, null, p_inv, p_reference, p_key);
  perform public._post(v_tx, p_date, 'تخارج من استثمار — ' || p.name,
    jsonb_build_array(jsonb_build_object('a','cash','dr',p_proceeds),
                      jsonb_build_object('a','investments_cost','cr',v_cost),
                      jsonb_build_object('a','unrealized_reserve','dr',v_unreal),
                      jsonb_build_object('a','investments_fv','cr',v_unreal),
                      jsonb_build_object('a','investment_income','cr',greatest(v_gain,0)),
                      jsonb_build_object('a','investment_losses','dr',greatest(-v_gain,0))));
  perform public._inv_tx(p_inv, 'exit', p_date, p_proceeds, -v_cost, -v_unreal, v_gain, null, p_note, v_tx);
  if v_full then update public.investments set status = 'exited' where id = p_inv; end if;
  return v_tx;
end $$;

-- ------------------------------------------------------------- expenses
create or replace function public.record_expense(p_category text, p_description text, p_payee text, p_amount numeric,
  p_date date, p_reference text default null, p_key text default null, p_document uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tx uuid;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  p_amount := public.money(p_amount);
  if length(trim(coalesce(p_description,''))) < 2 then raise exception 'وصف المصروف مطلوب'; end if;
  perform public._assert_cash(p_amount);
  v_tx := public._new_tx('expense', p_date, 'مصروف: ' || p_description, p_amount, null, null, null, p_reference, p_key, p_document);
  perform public._post(v_tx, p_date, 'مصروف: ' || p_description,
    jsonb_build_array(jsonb_build_object('a','operating_expenses','dr',p_amount), jsonb_build_object('a','cash','cr',p_amount)));
  insert into public.expenses(category, description, payee, amount, expense_date, reference, financial_transaction_id, created_by)
  values (p_category, trim(p_description), p_payee, p_amount, p_date, nullif(trim(p_reference),''), v_tx, auth.uid());
  return v_tx;
end $$;

-- ------------------------------------------------- manual / corrective journals
-- Restricted to accounts that have no member/loan/investment sub-ledger, so sub-ledgers always reconcile.
create or replace function public.post_manual_journal(p_date date, p_description text, p_lines jsonb,
  p_reference text default null, p_key text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tx uuid; l jsonb; v_total numeric := 0; v_key text;
begin
  perform public.assert_manager();
  v_tx := public._existing_tx(p_key); if v_tx is not null then return v_tx; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'القيد يحتاج سطرين على الأقل'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    select system_key into v_key from public.accounts where code = l->>'code' and is_active;
    if not found then raise exception 'رمز حساب غير صالح: %', l->>'code'; end if;
    if v_key in ('member_deposits','loans_receivable','investments_cost','investments_fv','contrib_capital','contrib_refundable','unrealized_reserve') then
      raise exception 'الحساب % مرتبط بسجل تفصيلي — استخدم العملية المخصصة له', l->>'code';
    end if;
    v_total := v_total + coalesce((l->>'dr')::numeric, 0);
  end loop;
  if length(trim(coalesce(p_description,''))) < 3 then raise exception 'وصف القيد مطلوب'; end if;
  v_tx := public._new_tx('manual_journal', p_date, p_description, v_total, null, null, null, p_reference, p_key);
  perform public._post(v_tx, p_date, p_description, p_lines);
  return v_tx;
end $$;

-- ------------------------------------------------------------ reversals
create or replace function public.reverse_transaction(p_tx uuid, p_reason text, p_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t public.financial_transactions; e public.journal_entries; v_rev uuid; v_date date; v_avail numeric;
begin
  perform public.assert_manager();
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'سبب العكس مطلوب'; end if;
  select * into t from public.financial_transactions where id = p_tx for update;
  if not found then raise exception 'العملية غير موجودة'; end if;
  if t.tx_type = 'reversal' then raise exception 'لا يمكن عكس قيد عكسي — سجّل العملية من جديد'; end if;
  if exists (select 1 from public.financial_transactions where reverses_tx_id = p_tx) then raise exception 'تم عكس هذه العملية مسبقاً'; end if;
  v_date := coalesce(p_date, public.fund_today());
  if v_date < t.tx_date then raise exception 'تاريخ العكس قبل تاريخ العملية الأصلية'; end if;

  if t.tx_type = 'deposit' then
    select available_to_withdraw into v_avail from public.v_member_balances where member_id = t.member_id;
    if v_avail < t.amount then raise exception 'لا يمكن عكس الإيداع: الرصيد المتاح أقل من مبلغه (يوجد سحوبات مرتبطة)'; end if;
  elsif t.tx_type = 'loan_disbursement' then
    if exists (select 1 from public.loan_repayments r join public.v_active_tx a on a.id = r.financial_transaction_id where r.loan_id = t.loan_id) then
      raise exception 'لا يمكن عكس صرف قرض عليه سدادات — اعكس السدادات أولاً';
    end if;
  elsif t.tx_type in ('investment_capital','investment_revaluation','investment_exit') then
    if exists (select 1 from public.investment_transactions it join public.v_active_tx a on a.id = it.financial_transaction_id
                where it.investment_id = t.investment_id and it.financial_transaction_id <> t.id
                  and (it.tx_date > t.tx_date or (it.tx_date = t.tx_date and it.created_at > t.created_at))
                  and it.kind in ('revaluation','exit')) then
      raise exception 'توجد عمليات تقييم/تخارج لاحقة على هذا الاستثمار — اعكسها أولاً';
    end if;
  elsif t.tx_type = 'withdrawal_payment' then
    raise exception 'لا يمكن عكس صرف سحب — سجّل إيداعاً تصحيحياً للعضو بدلاً من ذلك';
  end if;

  select * into e from public.journal_entries where financial_transaction_id = p_tx;
  v_rev := public._new_tx('reversal', v_date, 'عكس ' || t.tx_no || ': ' || trim(p_reason), t.amount,
                          t.member_id, t.loan_id, t.investment_id, null, null, null, p_tx);
  perform public._post(v_rev, v_date, 'عكس ' || t.tx_no || ': ' || trim(p_reason),
    (select jsonb_agg(jsonb_build_object('acct_id', account_id, 'dr', credit, 'cr', debit, 'm', member_id, 'memo', 'عكس'))
       from public.journal_entry_lines where entry_id = e.id), e.id);

  if t.tx_type = 'loan_repayment' then
    perform public._refresh_loan_status(t.loan_id);
  elsif t.tx_type = 'loan_disbursement' then
    update public.loans set status = 'cancelled', decision_note = 'عكس الصرف: ' || p_reason where id = t.loan_id;
  elsif t.tx_type = 'investment_exit' then
    update public.investments set status = 'active' where id = t.investment_id and status = 'exited';
  end if;
  if t.member_id is not null then
    perform public._notify_member(t.member_id, 'transaction_reversed', 'تصحيح على حسابك',
      'تم عكس العملية ' || t.tx_no || ': ' || trim(p_reason), '/member/transactions');
  end if;
  return v_rev;
end $$;

-- ------------------------------------------------------------- settings
create or replace function public.update_fund_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o public.fund_settings := public.settings(); n public.fund_settings;
begin
  perform public.assert_manager();
  if p ? 'contribution_treatment' and p->>'contribution_treatment' <> o.contribution_treatment
     and exists (select 1 from public.contribution_payments) then
    raise exception 'لا يمكن تغيير المعالجة المحاسبية للاشتراكات بعد تسجيل مدفوعات — يتطلب قرار نظام وإعادة تصنيف';
  end if;
  update public.fund_settings s set
    fund_name                 = coalesce(p->>'fund_name', s.fund_name),
    logo_url                  = case when p ? 'logo_url' then nullif(p->>'logo_url','') else s.logo_url end,
    monthly_contribution      = coalesce((p->>'monthly_contribution')::numeric, s.monthly_contribution),
    contribution_due_day      = coalesce((p->>'contribution_due_day')::smallint, s.contribution_due_day),
    contribution_start_period = coalesce(date_trunc('month', (p->>'contribution_start_period')::date)::date, s.contribution_start_period),
    contribution_treatment    = coalesce(p->>'contribution_treatment', s.contribution_treatment),
    loan_max_amount           = coalesce((p->>'loan_max_amount')::numeric, s.loan_max_amount),
    loan_max_months           = coalesce((p->>'loan_max_months')::smallint, s.loan_max_months),
    loan_default_fee_pct      = coalesce((p->>'loan_default_fee_pct')::numeric, s.loan_default_fee_pct),
    loan_one_active_per_member= coalesce((p->>'loan_one_active_per_member')::boolean, s.loan_one_active_per_member),
    loan_block_if_overdue     = coalesce((p->>'loan_block_if_overdue')::boolean, s.loan_block_if_overdue),
    loan_grace_days           = coalesce((p->>'loan_grace_days')::smallint, s.loan_grace_days),
    withdrawal_notice_days    = coalesce((p->>'withdrawal_notice_days')::smallint, s.withdrawal_notice_days),
    withdrawal_min_amount     = coalesce((p->>'withdrawal_min_amount')::numeric, s.withdrawal_min_amount),
    allow_negative_cash       = coalesce((p->>'allow_negative_cash')::boolean, s.allow_negative_cash),
    approval_requirements     = coalesce(p->'approval_requirements', s.approval_requirements),
    investment_categories     = coalesce(p->'investment_categories', s.investment_categories),
    expense_categories        = coalesce(p->'expense_categories', s.expense_categories),
    fiscal_year_start_month   = coalesce((p->>'fiscal_year_start_month')::smallint, s.fiscal_year_start_month),
    notification_prefs        = coalesce(p->'notification_prefs', s.notification_prefs),
    profit_allocation_policy  = coalesce(p->'profit_allocation_policy', s.profit_allocation_policy),
    demo_mode                 = coalesce((p->>'demo_mode')::boolean, s.demo_mode),
    updated_at = now(), updated_by = auth.uid()
  where id = 1 returning * into n;
  perform public._log('policy_change', 'fund_settings', '1', to_jsonb(n), to_jsonb(o), 'تعديل سياسات الصندوق');
end $$;

-- -------------------------------------------------------- notifications
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  update public.notifications set is_read = true, read_at = now()
   where user_id = auth.uid() and not is_read and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.send_announcement(p_title text, p_body text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.assert_manager();
  if length(trim(coalesce(p_title,''))) < 3 then raise exception 'عنوان الإعلان مطلوب'; end if;
  perform public._notify(id, 'announcement', trim(p_title), p_body, null, null) from public.app_users where is_active;
  select count(*) into n from public.app_users where is_active;
  perform public._log('announcement', 'notifications', null, jsonb_build_object('title', p_title, 'body', p_body));
  return n;
end $$;

-- ---------------------------------------------------------- daily jobs
create or replace function public.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.fund_settings := public.settings(); v_today date := public.fund_today();
        n_obl int; n_loans int; r record; n_rem int := 0;
        d_contrib int := coalesce((s.notification_prefs->>'contribution_reminder_days_before')::int, 3);
        d_repay int := coalesce((s.notification_prefs->>'repayment_reminder_days_before')::int, 3);
        d_mat int := coalesce((s.notification_prefs->>'maturity_notice_days_before')::int, 30);
begin
  if auth.uid() is not null then perform public.assert_manager(); end if;
  n_obl := public.generate_contribution_obligations();
  n_loans := public.refresh_loan_statuses();
  for r in select * from public.v_contribution_status where status in ('unpaid','partial','overdue') and due_date <= v_today + d_contrib loop
    if r.due_date >= v_today then
      perform public._notify_member(r.member_id, 'contribution_reminder', 'تذكير بالاشتراك الشهري',
        'اشتراك شهر ' || to_char(r.period,'YYYY-MM') || ' (' || r.amount_outstanding || ' ريال) مستحق بتاريخ ' || r.due_date || '.',
        '/member/contributions', 'contrib-reminder-' || r.id);
    else
      perform public._notify_member(r.member_id, 'contribution_overdue', 'اشتراك شهري متأخر',
        'اشتراك شهر ' || to_char(r.period,'YYYY-MM') || ' متأخر — المتبقي ' || r.amount_outstanding || ' ريال.',
        '/member/contributions', 'contrib-overdue-' || r.id);
    end if;
    n_rem := n_rem + 1;
  end loop;
  for r in select i.*, l.member_id, l.loan_no from public.v_installment_status i join public.loans l on l.id = i.loan_id
            where i.status <> 'paid' and l.status in ('disbursed','active','overdue') and i.due_date <= v_today + d_repay loop
    if r.due_date >= v_today then
      perform public._notify_member(r.member_id, 'repayment_reminder', 'تذكير بقسط القرض',
        'القسط رقم ' || r.seq || ' على القرض ' || r.loan_no || ' (' || r.amount_remaining || ' ريال) مستحق بتاريخ ' || r.due_date || '.',
        '/member/loans/view?id=' || r.loan_id, 'inst-reminder-' || r.id);
    elsif r.status = 'overdue' then
      perform public._notify_member(r.member_id, 'repayment_overdue', 'قسط متأخر',
        'القسط رقم ' || r.seq || ' على القرض ' || r.loan_no || ' متأخر — المتبقي ' || r.amount_remaining || ' ريال.',
        '/member/loans/view?id=' || r.loan_id, 'inst-overdue-' || r.id);
    end if;
    n_rem := n_rem + 1;
  end loop;
  for r in select * from public.investments where status = 'active' and maturity_date between v_today and v_today + d_mat loop
    perform public._notify(u.id, 'investment_maturity', 'استحقاق استثمار قريب',
      r.name || ' يستحق بتاريخ ' || r.maturity_date || '.', '/admin/investments/view?id=' || r.id, 'maturity-' || r.id)
      from public.app_users u where u.role = 'manager' and u.is_active;
  end loop;
  return jsonb_build_object('obligations_created', n_obl, 'loan_status_changes', n_loans, 'reminders_checked', n_rem);
end $$;

-- ------------------------------------------------------------ documents
create or replace function public.register_document(p_path text, p_name text, p_mime text, p_size bigint,
  p_entity_type text, p_entity_id uuid, p_member uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform public.assert_manager();
  if p_mime is not null and p_mime not in ('application/pdf','image/png','image/jpeg','image/webp',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    raise exception 'نوع الملف غير مسموح';
  end if;
  insert into public.documents(storage_path, file_name, mime_type, size_bytes, entity_type, entity_id, member_id, uploaded_by)
  values (p_path, p_name, p_mime, p_size, p_entity_type, p_entity_id, p_member, auth.uid()) returning id into v;
  return v;
end $$;
