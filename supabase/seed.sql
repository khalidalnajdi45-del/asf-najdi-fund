-- =====================================================================
-- DEMO DATA (بيانات تجريبية) — clearly flagged via fund_settings.demo_mode.
-- Every amount is posted through the real API functions, so all journals,
-- sub-ledgers and audit logs are genuine. Run once on an empty database.
-- Logins: manager@najdi-fund.demo / Demo@2026!   memberNN@najdi-fund.demo / Member@2026!
-- =====================================================================
do $seed$
declare
  v_mgr uuid; v_m uuid[] := '{}'; v_u uuid[] := '{}'; v_id uuid; v_loan uuid; v_inv uuid; v_tx uuid;
  r record; i int; p date; v_today date := public.fund_today(); v_cur date := date_trunc('month', public.fund_today())::date;
  names text[] := array['عبدالله سعود النجدي','محمد عبدالعزيز النجدي','فهد سعود النجدي','نورة عبدالله النجدي',
                        'خالد ناصر النجدي','سارة محمد النجدي','تركي عبدالرحمن النجدي','عبدالعزيز فهد النجدي',
                        'هيفاء سعود النجدي','سلمان خالد النجدي','ريم عبدالعزيز النجدي','ناصر عبدالله النجدي'];
  joins date[] := array['2025-11-01','2025-11-01','2025-11-01','2025-11-01','2025-11-01','2025-11-01',
                        '2025-11-01','2025-11-01','2026-01-01','2026-02-01','2026-04-01','2026-06-01']::date[];
begin
  if exists (select 1 from public.app_users) then raise exception 'Seed expects an empty database'; end if;

  update public.fund_settings set fund_name = 'صندوق النجدي الادخاري', demo_mode = true,
         contribution_start_period = '2025-11-01', loan_block_if_overdue = false where id = 1;

  v_mgr := public._create_auth_user('manager@najdi-fund.demo', 'Demo@2026!', 'مدير الصندوق (تجريبي)', 'manager');
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);

  -- ---------------- members
  for i in 1..12 loop
    v_id := public.admin_create_member(names[i], format('member%s@najdi-fund.demo', lpad(i::text,2,'0')), 'Member@2026!',
                                       '05' || lpad((50000000 + i * 1234567 % 49999999)::text, 8, '0'), joins[i], 'عضو تجريبي');
    v_m := v_m || v_id;
    v_u := v_u || (select user_id from public.members where id = v_id);
  end loop;
  perform public.generate_contribution_obligations();

  -- ---------------- contributions (most pay on time; a few patterns of arrears)
  for r in select c.*, array_position(v_m, c.member_id) as k from public.contributions c order by c.period loop
    continue when r.k = 7  and r.period >= v_cur - interval '2 months';   -- member 7: last 3 months unpaid
    continue when r.k = 11 and r.period >= v_cur - interval '1 month';    -- member 11: last 2 months unpaid
    continue when r.period = v_cur and r.k in (3,6,9,12);                 -- not yet paid this month
    p := least(r.due_date - 5 + (abs(hashtext(r.id::text)) % 9), v_today);
    if r.k = 4 and r.period = v_cur - interval '1 month' then
      perform public.record_contribution_payment(r.member_id, r.period, 100, p, 'SADAD-' || (abs(hashtext(r.id::text)) % 99999));
    else
      perform public.record_contribution_payment(r.member_id, r.period, r.amount_due, p, 'SADAD-' || (abs(hashtext(r.id::text)) % 99999));
    end if;
  end loop;

  -- ---------------- voluntary deposits
  perform public.record_deposit(v_m[1], 15000, '2025-11-20', 'تحويل بنكي', 'TRF-23011');
  perform public.record_deposit(v_m[2], 8000,  '2025-12-05', 'تحويل بنكي', 'TRF-23102');
  perform public.record_deposit(v_m[4], 5000,  '2026-01-12', 'تحويل بنكي', 'TRF-24005');
  perform public.record_deposit(v_m[5], 12000, '2026-02-03', 'تحويل بنكي', 'TRF-24190');
  perform public.record_deposit(v_m[8], 3000,  '2026-03-18', 'نقداً',      'CASH-0091');
  perform public.record_deposit(v_m[1], 5000,  '2026-05-02', 'تحويل بنكي', 'TRF-25230');
  perform public.record_deposit(v_m[10], 7500, '2026-07-09', 'تحويل بنكي', 'TRF-26014');
  perform public.record_deposit(v_m[6], 4000,  '2026-08-21', 'تحويل بنكي', 'TRF-26377');

  -- member-initiated requests
  perform set_config('request.jwt.claim.sub', v_u[3]::text, true);
  perform public.request_deposit(2500, 'تحويل بنكي', 'إيداع من مكافأة نهاية السنة');
  perform set_config('request.jwt.claim.sub', v_u[2]::text, true);
  v_id := public.request_withdrawal(3000, 'سداد رسوم دراسية');
  update public.deposit_withdrawals set requested_at = '2026-09-10 09:00+03' where id = v_id;
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  perform public.approve_withdrawal(v_id, 'معتمد');
  perform public.pay_withdrawal(v_id, '2026-09-14', 'TRF-OUT-118');
  perform set_config('request.jwt.claim.sub', v_u[5]::text, true);
  v_id := public.request_withdrawal(4000, 'تجهيزات منزل');
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  perform public.approve_withdrawal(v_id, 'معتمد — يصرف بداية الشهر');
  perform set_config('request.jwt.claim.sub', v_u[1]::text, true);
  perform public.request_withdrawal(2000, 'سفر');

  -- ---------------- investments
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  v_inv := public.create_investment('صكوك حكومية — إصدار 2025', 'other', 'صكوك محلية قصيرة الأجل', 'وزارة المالية / المركز الوطني لإدارة الدين',
                                    '2025-12-01', '2026-06-01', 6000, 'تجريبي', 'INV-SK-01');
  perform public.exit_investment(v_inv, 6180, '2026-06-01', null, 'استحقاق كامل');
  v_inv := public.create_investment('وديعة مرابحة 12 شهر', 'bank_deposit', 'وديعة مرابحة بعائد ربع سنوي', 'مصرف الراجحي',
                                    '2026-01-15', '2027-01-15', 15000, 'تجريبي', 'INV-DP-02');
  perform public.record_investment_income(v_inv, 150, '2026-04-15', 'عائد الربع الأول');
  perform public.record_investment_income(v_inv, 150, '2026-07-15', 'عائد الربع الثاني');
  perform public.record_investment_income(v_inv, 150, '2026-10-15', 'عائد الربع الثالث');
  v_inv := public.create_investment('صندوق الأسهم السعودية', 'fund', 'صندوق استثماري مفتوح', 'الأهلي المالية',
                                    '2026-02-01', null, 10000, 'تجريبي', 'INV-FD-03');
  perform public.revalue_investment(v_inv, 10420, '2026-06-30', 'تقييم نهاية الربع الثاني');
  perform public.revalue_investment(v_inv, 10850, '2026-09-30', 'تقييم نهاية الربع الثالث');
  v_inv := public.create_investment('محفظة أسهم قيادية', 'equity', 'أسهم مدرجة في تداول', 'دراية المالية',
                                    '2026-05-10', null, 5000, 'تجريبي', 'INV-EQ-04');
  perform public.record_investment_income(v_inv, 85, '2026-08-20', 'توزيعات نقدية');
  perform public.revalue_investment(v_inv, 4720, '2026-10-31', 'تقييم سوقي');
  perform public.upsert_holding(v_inv, '2222', 'أرامكو', 60, 26.40);
  perform public.upsert_holding(v_inv, '1120', 'الراجحي', 10, 98.00);
  perform public.upsert_holding(v_inv, '7010', 'اس تي سي', 20, 40.00);
  perform public.upsert_holding(v_inv, '2010', 'سابك', 10, 75.00);
  perform public.set_portfolio_cash(v_inv, 886);
  perform public.apply_market_prices('[{"symbol":"2222","price":26.64,"prev_close":26.50},{"symbol":"1120","price":96.20,"prev_close":97.00},{"symbol":"7010","price":41.52,"prev_close":41.20},{"symbol":"2010","price":68.10,"prev_close":69.00}]'::jsonb);

  -- ---------------- loans
  -- fully repaid
  perform set_config('request.jwt.claim.sub', v_u[5]::text, true);
  v_loan := public.request_loan(3000, 'صيانة منزل', 6, null);
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  update public.loans set request_date = '2025-12-01' where id = v_loan;
  perform public.approve_loan(v_loan, 3000, 6, 'monthly', 0, null, 'معتمد');
  perform public.disburse_loan(v_loan, '2025-12-10', 'TRF-L-501');
  for r in select * from public.loan_installments where loan_id = v_loan order by seq loop
    perform public.record_loan_repayment(v_loan, r.amount_due, r.due_date, 'SADAD-L501-' || r.seq);
  end loop;

  -- active, on schedule
  perform set_config('request.jwt.claim.sub', v_u[2]::text, true);
  v_loan := public.request_loan(6000, 'شراء سيارة مستعملة', 12, 'يفضل السداد الشهري');
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  update public.loans set request_date = '2026-02-25' where id = v_loan;
  perform public.approve_loan(v_loan, 6000, 12, 'monthly', 0, null, 'معتمد');
  perform public.disburse_loan(v_loan, '2026-03-05', 'TRF-L-502');
  for r in select * from public.loan_installments where loan_id = v_loan and due_date <= v_today order by seq loop
    perform public.record_loan_repayment(v_loan, r.amount_due, r.due_date, 'SADAD-L502-' || r.seq);
  end loop;

  -- overdue (last installments missed)
  perform set_config('request.jwt.claim.sub', v_u[9]::text, true);
  v_loan := public.request_loan(10000, 'تكاليف زواج', 20, null);
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  update public.loans set request_date = '2026-05-20' where id = v_loan;
  perform public.approve_loan(v_loan, 10000, 20, 'monthly', 0, null, 'معتمد');
  perform public.disburse_loan(v_loan, '2026-06-01', 'TRF-L-503');
  for r in select * from public.loan_installments where loan_id = v_loan and due_date <= v_today - 45 order by seq loop
    perform public.record_loan_repayment(v_loan, r.amount_due, r.due_date + 2, 'SADAD-L503-' || r.seq);
  end loop;

  -- early repayment
  perform set_config('request.jwt.claim.sub', v_u[1]::text, true);
  v_loan := public.request_loan(4000, 'علاج أسنان', 8, null);
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  update public.loans set request_date = '2026-04-01' where id = v_loan;
  perform public.approve_loan(v_loan, 4000, 8, 'monthly', 0, null, 'معتمد');
  perform public.disburse_loan(v_loan, '2026-04-08', 'TRF-L-504');
  perform public.record_loan_repayment(v_loan, 500, '2026-05-08', 'SADAD-L504-1');
  perform public.record_loan_repayment(v_loan, 3500, '2026-07-01', 'SADAD-L504-EARLY');

  -- approved, awaiting disbursement
  perform set_config('request.jwt.claim.sub', v_u[6]::text, true);
  v_loan := public.request_loan(4000, 'رسوم دورة تدريبية', 8, null);
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  perform public.approve_loan(v_loan, 4000, 8, 'monthly', 0, null, 'معتمد — بانتظار الصرف');

  -- rejected
  perform set_config('request.jwt.claim.sub', v_u[8]::text, true);
  v_loan := public.request_loan(45000, 'مشروع تجاري', 24, null);
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  perform public.reject_loan(v_loan, 'المبلغ يتجاوز السيولة المتاحة حالياً');

  -- pending
  perform set_config('request.jwt.claim.sub', v_u[3]::text, true);
  perform public.request_loan(8000, 'ترميم منزل', 16, 'أحتاجه قبل نهاية الشهر');
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);

  -- ---------------- expenses
  perform public.record_expense('مصاريف قانونية', 'صياغة ومراجعة النظام الأساسي للصندوق', 'مكتب محاماة', 750, '2025-11-25', 'INV-LAW-77');
  perform public.record_expense('تقنية واشتراكات', 'اشتراك سنوي لمنصة إدارة الصندوق', 'مزود خدمة', 360, '2026-01-05', 'SUB-2026');
  for i in 0..9 loop
    perform public.record_expense('رسوم بنكية', 'رسوم حوالات شهرية', 'البنك', 12.50,
                                  (date '2026-01-28' + (i || ' months')::interval)::date, 'FEE-' || i);
  end loop;

  -- ---------------- a correction example (reversing entry instead of editing)
  v_tx := public.record_deposit(v_m[12], 1000, '2026-10-02', 'تحويل بنكي', 'TRF-DUP-1');
  perform public.reverse_transaction(v_tx, 'إيداع مكرر سجل بالخطأ', '2026-10-03');

  -- ---------------- family occasions (invitations + RSVPs)
  perform public.create_event(jsonb_build_object('kind','gathering','title','لقاء العائلة الشهري','event_date', v_today - 40,
    'start_time','بعد صلاة المغرب','location','مجلس العائلة — الرياض','notify', false));
  v_id := public.create_event(jsonb_build_object('kind','desert','title','كشتة الشتاء','message','جلسة بر وشبة نار وقهوة وحطب… لا تفوتكم',
    'event_date', v_today + 13,'start_time','العصر حتى العشاء','location','روضة خريم','location_url','https://maps.google.com/?q=روضة+خريم',
    'host','أبناء سعود النجدي','notify', false));
  for i in 1..9 loop
    perform set_config('request.jwt.claim.sub', v_u[i]::text, true);
    perform public.rsvp_event(v_id, (array['yes','yes','maybe','yes','no','yes','yes','maybe','yes'])[i], (array[3,2,0,4,0,1,2,0,5])[i],
                              case i when 5 then 'مسافر ذاك اليوم — بالتوفيق' when 3 then 'أأكد لكم قبلها بيومين' end);
  end loop;
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  v_id := public.create_event(jsonb_build_object('kind','sea','title','طلعة بحرية — الخبر','message','يوم بحر وصيد وجلسة حلوة مع الأهل، القارب يتسع لـ 20 شخصاً',
    'event_date', v_today + 41,'start_time','7:00 صباحاً','location','مرسى الخبر','host','فهد سعود النجدي'));
  for i in 1..4 loop
    perform set_config('request.jwt.claim.sub', v_u[i + 3]::text, true);
    perform public.rsvp_event(v_id, (array['yes','maybe','yes','yes'])[i], (array[2,0,1,3])[i], null);
  end loop;
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  perform public.create_event(jsonb_build_object('kind','ramadan','title','فطور العائلة السنوي','event_date', date '2027-02-20',
    'start_time','قبل أذان المغرب','location','بيت العائلة — الحريق','host','عبدالله سعود النجدي'));
  perform public.create_event(jsonb_build_object('kind','eid','title','معايدة عيد الفطر','event_date', date '2027-03-10',
    'start_time','بعد صلاة العيد','location','بيت العائلة — الحريق'));

  -- ---------------- monthly account reports for the last two months
  perform public.issue_monthly_reports((v_cur - interval '2 months')::date, null, false);
  perform public.issue_monthly_reports((v_cur - interval '1 month')::date, 'شكراً لالتزامكم بالاشتراكات — نذكّركم بكشتة الشتاء نهاية الشهر.', true);
  -- demo: pretend the mailer already delivered most of last month's e-mails
  update public.monthly_reports mr set email_to = public.member_email(mr.member_id), emailed_at = mr.created_at + interval '20 minutes', email_attempts = 1
   where mr.period < v_cur and mr.member_id <> all(v_m[11:12]);
  update public.monthly_reports mr set email_to = public.member_email(mr.member_id), email_error = 'Mailbox unavailable (550)', email_attempts = 1
   where mr.period = (v_cur - interval '1 month')::date and mr.member_id = v_m[12];

  perform public.send_announcement('اجتماع الجمعية العمومية', 'يسرنا دعوتكم لاجتماع الجمعية العمومية السنوي للصندوق — سيتم إرسال التفاصيل لاحقاً.');
  perform public.run_daily_jobs();

  -- historical back-filling raised transient 'overdue' alerts for loans that are current now — drop them
  delete from public.notifications n where n.type = 'repayment_overdue'
     and not exists (select 1 from public.loans l where l.status = 'overdue' and n.link like '%' || l.id::text);
  -- older notifications read, recent ones unread
  update public.notifications set is_read = true, read_at = now() where type not in ('announcement','contribution_overdue','repayment_overdue');
  update public.fund_settings set loan_block_if_overdue = true where id = 1;
end
$seed$;
