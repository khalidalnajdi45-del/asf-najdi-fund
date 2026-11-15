import { describe, it, expect, beforeAll } from 'vitest';
import { freshDb, Session } from './db';

let s: Session;
let manager: string, aliUser: string, saraUser: string, ali: string, sara: string;
let today: string, monthStart: string, sixMonthsAgo: string;

const n = (v: any) => Number(v);
const expectFail = async (p: Promise<any>, re?: RegExp) => {
  let err: any = null;
  try { await p; } catch (e) { err = e; }
  expect(err, 'expected an error').not.toBeNull();
  if (re) expect(String(err.message)).toMatch(re);
};

beforeAll(async () => {
  s = new Session(await freshDb());
  await s.system();
  today = await s.val(`select fund_today()::text`);
  monthStart = await s.val(`select date_trunc('month', fund_today())::date::text`);
  sixMonthsAgo = await s.val(`select (date_trunc('month', fund_today()) - interval '6 months')::date::text`);
  await s.q(`update fund_settings set contribution_start_period = $1`, [sixMonthsAgo]);
  manager = await s.val(`select _create_auth_user('manager@test.sa', 'Manager#2026', 'مدير الصندوق', 'manager')`);
}, 60_000);

describe('members', () => {
  it('manager creates members; passwords are hashed; obligations auto-generated', async () => {
    await s.as(manager);
    ali = await s.val(`select admin_create_member('علي النجدي', 'ali@test.sa', 'Password#1', '0500000001', $1::date)`, [sixMonthsAgo]);
    sara = await s.val(`select admin_create_member('سارة النجدي', 'sara@test.sa', 'Password#2', null, $1::date)`, [sixMonthsAgo]);
    await s.system();
    const u = await s.one(`select encrypted_password from auth.users where email = 'ali@test.sa'`);
    expect(u.encrypted_password).toMatch(/^\$2/);
    expect(u.encrypted_password).not.toContain('Password#1');
    aliUser = await s.val(`select user_id from members where id = $1`, [ali]);
    saraUser = await s.val(`select user_id from members where id = $1`, [sara]);
    const months = n(await s.val(`select count(*) from contributions where member_id = $1`, [ali]));
    expect(months).toBe(7);                     // 6 past months + current
    expect(n(await s.val(`select sum(amount_due) from contributions where member_id = $1`, [ali]))).toBe(1400);
  });

  it('members cannot create members or record money', async () => {
    await s.as(aliUser);
    await expectFail(s.q(`select admin_create_member('x y','x@test.sa','Password#9')`), /مدير الصندوق فقط/);
    await expectFail(s.q(`select record_contribution_payment($1, $2::date, 200, $2::date)`, [ali, monthStart]), /مدير الصندوق فقط/);
    await expectFail(s.q(`select record_deposit($1, 1000, $2::date)`, [ali, today]), /مدير الصندوق فقط/);
  });

  it('anonymous callers cannot execute the API', async () => {
    await s.system();
    await s.db.exec('set role anon');
    await expectFail(s.q(`select manager_dashboard()`), /permission denied/);
    await expectFail(s.q(`select * from members`), /permission denied/);
    await s.system();
  });
});

describe('monthly contributions', () => {
  it('records a payment with a balanced journal and correct status', async () => {
    await s.as(manager);
    const tx = await s.val(`select record_contribution_payment($1, $2::date, 200, $3::date, 'BANK-1', 'k-contrib-1')`, [ali, monthStart, today]);
    const st = await s.one(`select status, amount_paid from v_contribution_status where member_id = $1 and period = $2::date`, [ali, monthStart]);
    expect(st.status).toBe('paid');
    expect(n(st.amount_paid)).toBe(200);
    const lines = await s.q(`select account_code, debit, credit from v_journal where transaction_id = $1 order by account_code`, [tx]);
    expect(lines.map(l => [l.account_code, n(l.debit), n(l.credit)])).toEqual([['1000', 200, 0], ['3000', 0, 200]]);
  });

  it('is idempotent and prevents duplicate / over payment', async () => {
    await s.as(manager);
    const a = await s.val(`select record_contribution_payment($1, $2::date, 200, $3::date, 'BANK-1', 'k-contrib-1')`, [ali, monthStart, today]);
    const b = await s.val(`select financial_transaction_id from contribution_payments where member_id = $1`, [ali]);
    expect(a).toBe(b);
    expect(n(await s.val(`select count(*) from contribution_payments where member_id = $1`, [ali]))).toBe(1);
    await expectFail(s.q(`select record_contribution_payment($1, $2::date, 50, $3::date)`, [ali, monthStart, today]), /مسدد بالكامل/);
  });

  it('tracks partial and overdue', async () => {
    await s.as(manager);
    await s.q(`select record_contribution_payment($1, $2::date, 100, $3::date)`, [sara, monthStart, today]);
    expect(await s.val(`select status from v_contribution_status where member_id = $1 and period = $2::date`, [sara, monthStart])).toBe('partial');
    await expectFail(s.q(`select record_contribution_payment($1, $2::date, 150, $3::date)`, [sara, monthStart, today]), /يتجاوز المستحق/);
    expect(await s.val(`select status from v_contribution_status where member_id = $1 and period = $2::date`, [sara, sixMonthsAgo])).toBe('overdue');
    // pay Ali's back months so he can borrow later
    const periods = await s.q(`select period::text p from contributions where member_id = $1 and period < $2::date order by period`, [ali, monthStart]);
    for (const p of periods) await s.q(`select record_contribution_payment($1, $2::date, 200, $3::date)`, [ali, p.p, today]);
    expect(n(await s.val(`select contributions_total from v_member_balances where member_id = $1`, [ali]))).toBe(1400);
    expect(n(await s.val(`select contributions_overdue from v_member_balances where member_id = $1`, [ali]))).toBe(0);
  });
});

describe('voluntary deposits & withdrawals', () => {
  it('member deposit request does not change balances until confirmed', async () => {
    await s.as(aliUser);
    const req = await s.val(`select request_deposit(5000, 'تحويل بنكي', 'إيداع')`);
    expect(n(await s.val(`select deposit_balance from v_member_balances where member_id = $1`, [ali]))).toBe(0);
    await s.as(manager);
    await s.q(`select confirm_deposit($1, $2::date, 'TRF-77', 'k-dep-1')`, [req, today]);
    const b = await s.one(`select deposit_balance, contributions_total from v_member_balances where member_id = $1`, [ali]);
    expect(n(b.deposit_balance)).toBe(5000);
    expect(n(b.contributions_total)).toBe(1400);       // contributions are never mixed with deposits
    const inc = await s.one(`select report_income_statement($1::date, $1::date) r`, [today]);
    expect(n(inc.r.total_income)).toBe(0);             // deposits are a liability, not income
  });

  it('withdrawal only reduces the balance once approved AND paid', async () => {
    await s.as(aliUser);
    await expectFail(s.q(`select request_withdrawal(6000, 'x')`), /يتجاوز الرصيد المتاح/);
    const w = await s.val(`select request_withdrawal(2000, 'حاجة شخصية')`);
    let b = await s.one(`select deposit_balance, available_to_withdraw from v_member_balances where member_id = $1`, [ali]);
    expect(n(b.deposit_balance)).toBe(5000);
    expect(n(b.available_to_withdraw)).toBe(3000);
    await expectFail(s.q(`select approve_withdrawal($1)`, [w]), /مدير الصندوق فقط/);
    await s.as(manager);
    await expectFail(s.q(`select pay_withdrawal($1, $2::date)`, [w, today]), /يجب اعتماد الطلب/);
    await s.q(`select approve_withdrawal($1, 'موافق')`, [w]);
    b = await s.one(`select deposit_balance from v_member_balances where member_id = $1`, [ali]);
    expect(n(b.deposit_balance)).toBe(5000);
    await s.q(`select pay_withdrawal($1, $2::date, 'TRF-OUT-1', 'k-wd-1')`, [w, today]);
    b = await s.one(`select deposit_balance, available_to_withdraw from v_member_balances where member_id = $1`, [ali]);
    expect(n(b.deposit_balance)).toBe(3000);
    expect(n(b.available_to_withdraw)).toBe(3000);
    expect(await s.val(`select status from deposit_withdrawals where id = $1`, [w])).toBe('paid');
  });
});

describe('loans', () => {
  let loan: string;
  it('approval is not disbursement', async () => {
    await s.as(aliUser);
    loan = await s.val(`select request_loan(3000, 'إصلاح سيارة', 6, null)`);
    await expectFail(s.q(`select request_loan(1000, 'طلب آخر', 3, null)`), /طلب أو قرض قائم/);
    await s.as(manager);
    const cashBefore = n(await s.sysVal(`select account_balance('cash')`));
    await s.q(`select approve_loan($1, 3000, 6, 'monthly', 0, null, 'معتمد')`, [loan]);
    expect(await s.val(`select status from loans where id = $1`, [loan])).toBe('approved');
    expect(n(await s.sysVal(`select account_balance('cash')`))).toBe(cashBefore);
    expect(n(await s.sysVal(`select account_balance('loans_receivable')`))).toBe(0);
  });

  it('disbursement posts cash, receivable and a schedule atomically', async () => {
    await s.as(manager);
    const cashBefore = n(await s.sysVal(`select account_balance('cash')`));
    await s.q(`select disburse_loan($1, $2::date, 'TRF-L1', 'k-disb-1')`, [loan, today]);
    await s.q(`select disburse_loan($1, $2::date, 'TRF-L1', 'k-disb-1')`, [loan, today]);   // idempotent replay
    expect(n(await s.sysVal(`select account_balance('cash')`))).toBe(cashBefore - 3000);
    expect(n(await s.sysVal(`select account_balance('loans_receivable')`))).toBe(3000);
    const sch = await s.q(`select amount_due from loan_installments where loan_id = $1 order by seq`, [loan]);
    expect(sch.length).toBe(6);
    expect(sch.reduce((a, r) => a + n(r.amount_due), 0)).toBe(3000);
    expect(await s.val(`select status from loans where id = $1`, [loan])).toBe('disbursed');
  });

  it('atomicity: a failing disbursement leaves nothing behind', async () => {
    await s.as(saraUser);
    await expectFail(s.q(`select request_loan(2000, 'تعليم', 4, null)`), /اشتراكات شهرية متأخرة/);
    await s.system();
    await s.q(`update fund_settings set loan_block_if_overdue = false`);
    await s.as(saraUser);
    const big = await s.val(`select request_loan(49000, 'شراء أرض', 24, null)`);
    await s.as(manager);
    await s.q(`select approve_loan($1, 49000, 24, 'monthly')`, [big]);
    const txBefore = n(await s.val(`select count(*) from financial_transactions`));
    await expectFail(s.q(`select disburse_loan($1, $2::date)`, [big, today]), /لا يكفي/);
    expect(n(await s.val(`select count(*) from financial_transactions`))).toBe(txBefore);
    expect(n(await s.val(`select count(*) from loan_installments where loan_id = $1`, [big]))).toBe(0);
    expect(await s.val(`select status from loans where id = $1`, [big])).toBe('approved');
    await s.q(`select cancel_loan($1, 'سيولة غير كافية')`, [big]);
  });

  it('repayments reduce outstanding; early repayment closes the loan', async () => {
    await s.as(manager);
    await s.q(`select record_loan_repayment($1, 500, $2::date, 'R1', 'k-rep-1')`, [loan, today]);
    let l = await s.one(`select outstanding, status, paid_count from v_loan_summary where id = $1`, [loan]);
    expect(n(l.outstanding)).toBe(2500);
    expect(l.status).toBe('active');
    expect(n(l.paid_count)).toBe(1);
    await expectFail(s.q(`select record_loan_repayment($1, 2600, $2::date)`, [loan, today]), /يتجاوز الرصيد القائم/);
    await s.q(`select record_loan_repayment($1, 2500, $2::date, 'R2')`, [loan, today]);
    l = await s.one(`select outstanding, status, closed_on from v_loan_summary where id = $1`, [loan]);
    expect(n(l.outstanding)).toBe(0);
    expect(l.status).toBe('fully_repaid');
    expect(n(await s.sysVal(`select account_balance('loans_receivable')`))).toBe(0);
    await expectFail(s.q(`select record_loan_repayment($1, 1, $2::date)`, [loan, today]), /لا يمكن تسجيل سداد/);
  });
});

describe('investments', () => {
  let inv: string;
  it('records capital, unrealized gains separately from cash and income', async () => {
    await s.as(manager);
    const cash0 = n(await s.sysVal(`select account_balance('cash')`));
    inv = await s.val(`select create_investment('وديعة بنك الراجحي', 'bank_deposit', 'وديعة 6 أشهر', 'بنك الراجحي', $1::date, null, 1000, null, 'INV-1', 'k-inv-1')`, [today]);
    expect(n(await s.sysVal(`select account_balance('cash')`))).toBe(cash0 - 1000);
    await s.q(`select revalue_investment($1, 1150, $2::date, 'تقييم')`, [inv, today]);
    let p = await s.one(`select cost_basis, unrealized_pl, current_value, realized_pl from v_investment_positions where id = $1`, [inv]);
    expect([n(p.cost_basis), n(p.unrealized_pl), n(p.current_value), n(p.realized_pl)]).toEqual([1000, 150, 1150, 0]);
    expect(n(await s.sysVal(`select account_balance('cash')`))).toBe(cash0 - 1000);           // unrealized ≠ cash
    const is = await s.one(`select report_income_statement($1::date, $1::date) r`, [today]);
    expect(n(is.r.total_income)).toBe(0);                                                     // unrealized ≠ income
    expect(n(is.r.unrealized_change)).toBe(150);
  });

  it('records realized income, a loss revaluation and a full exit', async () => {
    await s.as(manager);
    await s.q(`select record_investment_income($1, 40, $2::date, 'أرباح')`, [inv, today]);
    await s.q(`select revalue_investment($1, 980, $2::date)`, [inv, today]);
    expect(n(await s.val(`select unrealized_pl from v_investment_positions where id = $1`, [inv]))).toBe(-20);
    await s.q(`select exit_investment($1, 1100, $2::date)`, [inv, today]);
    const p = await s.one(`select status, cost_basis, unrealized_pl, realized_pl from v_investment_positions where id = $1`, [inv]);
    expect(p.status).toBe('exited');
    expect([n(p.cost_basis), n(p.unrealized_pl), n(p.realized_pl)]).toEqual([0, 0, 140]);   // 40 income + 100 gain
    expect(n(await s.sysVal(`select account_balance('investments_fv')`))).toBe(0);
    expect(n(await s.sysVal(`select account_balance('unrealized_reserve')`))).toBe(0);
  });

  it('partial exit with a realized loss', async () => {
    await s.as(manager);
    const inv2 = await s.val(`select create_investment('محفظة أسهم', 'equity', null, 'دراية', $1::date, null, 800)`, [today]);
    await s.q(`select exit_investment($1, 300, $2::date, 400)`, [inv2, today]);
    const p = await s.one(`select status, cost_basis, realized_pl from v_investment_positions where id = $1`, [inv2]);
    expect([p.status, n(p.cost_basis), n(p.realized_pl)]).toEqual(['active', 400, -100]);
  });
});

describe('expenses, reversals, immutability', () => {
  it('records an expense', async () => {
    await s.as(manager);
    await s.q(`select record_expense('رسوم بنكية', 'رسوم حوالات', 'البنك', 35, $1::date, 'FEE-1')`, [today]);
    expect(n(await s.sysVal(`select account_balance('operating_expenses')`))).toBe(35);
  });

  it('reverses a contribution payment instead of editing it', async () => {
    await s.as(manager);
    const tx = await s.val(`select financial_transaction_id from contribution_payments where member_id = $1 order by created_at desc limit 1`, [sara]);
    await s.q(`select reverse_transaction($1, 'تسجيل بالخطأ')`, [tx]);
    expect(await s.val(`select status from v_contribution_status where member_id = $1 and period = $2::date`, [sara, monthStart])).not.toBe('partial');
    await expectFail(s.q(`select reverse_transaction($1, 'مرة ثانية')`, [tx]), /مسبقاً/);
    await s.system();
    await expectFail(s.q(`update financial_transactions set amount = 1 where id = $1`, [tx]), /غير قابل للتعديل/);
    await expectFail(s.q(`delete from journal_entry_lines`), /غير قابل للتعديل/);
    await expectFail(s.q(`delete from audit_logs`), /غير قابل للتعديل/);
  });

  it('rejects unbalanced or sub-ledger manual journals', async () => {
    await s.as(manager);
    await expectFail(s.q(`select post_manual_journal($1::date, 'قيد خاطئ', '[{"code":"1000","dr":100},{"code":"3900","cr":90}]'::jsonb)`, [today]), /غير متوازن/);
    await expectFail(s.q(`select post_manual_journal($1::date, 'تلاعب', '[{"code":"2000","dr":100},{"code":"1000","cr":100}]'::jsonb)`, [today]), /سجل تفصيلي/);
    await s.q(`select post_manual_journal($1::date, 'رصيد افتتاحي للبنك', '[{"code":"1000","dr":250},{"code":"3900","cr":250}]'::jsonb)`, [today]);
    await s.system();
    await expectFail(s.db.exec(`begin;
      insert into financial_transactions(tx_type, tx_date, description, amount, created_by, approved_by)
        values ('manual_journal', current_date, 'x', 1, gen_random_uuid(), gen_random_uuid());
      insert into journal_entries(entry_date, description, financial_transaction_id, created_by)
        select current_date, 'x', id, gen_random_uuid() from financial_transactions where description = 'x';
      insert into journal_entry_lines(entry_id, account_id, debit) select id, 1, 10 from journal_entries where description = 'x';
      insert into journal_entry_lines(entry_id, account_id, credit) select id, 2, 9 from journal_entries where description = 'x';
      commit;`), /غير متوازن|غير مكتمل/);
    await s.db.exec('rollback').catch(() => {});
  });
});

describe('member data isolation (RLS)', () => {
  it('a member sees only their own rows', async () => {
    await s.as(aliUser);
    expect((await s.q(`select id from members`)).map(r => r.id)).toEqual([ali]);
    const mids = new Set((await s.q(`select member_id from financial_transactions`)).map(r => r.member_id));
    expect([...mids]).toEqual([ali]);
    expect((await s.q(`select member_id from v_member_balances`)).length).toBe(1);
    expect((await s.q(`select * from journal_entries`)).length).toBe(0);
    expect((await s.q(`select * from investments`)).length).toBe(0);
    expect((await s.q(`select * from audit_logs`)).length).toBe(0);
    expect((await s.q(`select * from loans where member_id = $1`, [sara])).length).toBe(0);
    expect((await s.q(`select * from notifications where user_id = $1`, [saraUser])).length).toBe(0);
  });

  it('a member cannot write tables directly or read other statements', async () => {
    await s.as(aliUser);
    await expectFail(s.q(`insert into member_deposits(member_id, amount) values ($1, 10)`, [ali]), /permission denied/);
    await expectFail(s.q(`update loans set status = 'fully_repaid'`), /permission denied/);
    await expectFail(s.q(`select member_statement($1, '2020-01-01'::date, $2::date)`, [sara, today]), /عضو آخر/);
    await expectFail(s.q(`select member_dashboard($1)`, [sara]), /مدير الصندوق فقط/);
    const st = await s.one(`select member_statement($1, '2020-01-01'::date, $2::date) r`, [ali, today]);
    expect(st.r.transactions.length).toBeGreaterThan(5);
    expect(n(st.r.balances.deposit_balance)).toBe(3000);
  });

  it('members can mark their own notifications read', async () => {
    await s.as(aliUser);
    const unread = n(await s.val(`select count(*) from notifications where not is_read`));
    expect(unread).toBeGreaterThan(0);
    expect(n(await s.val(`select mark_notifications_read(null)`))).toBe(unread);
  });
});

describe('reports & integrity', () => {
  it('produces dashboards, statements and a monthly report', async () => {
    await s.as(manager);
    const d = await s.one(`select manager_dashboard() r`);
    expect(n(d.r.total_assets) - n(d.r.total_liabilities)).toBe(n(d.r.net_position));
    expect(n(d.r.cash)).toBe(n(await s.sysVal(`select account_balance('cash')`)));
    const rep = await s.one(`select report_period_summary($1::date, $2::date) r`, [monthStart, today]);
    expect(rep.r.balance_sheet.total_assets).toBeDefined();
    expect(n(rep.r.balance_sheet.total_assets)).toBe(n(rep.r.balance_sheet.total_liabilities) + n(rep.r.balance_sheet.total_equity));
    const cf = rep.r.cash_flow;
    expect(n(cf.opening_cash) + n(cf.net_change)).toBe(n(cf.closing_cash));
    const tb = await s.one(`select report_trial_balance() r`);
    expect(n(tb.r.total_debit)).toBe(n(tb.r.total_credit));
    await s.one(`select report_liquidity() r, report_contribution_matrix(extract(year from fund_today())::int) m`);
  });

  it('every journal entry balances and all sub-ledgers reconcile', async () => {
    await s.system();
    const bad = await s.q(`select entry_id from journal_entry_lines group by entry_id having sum(debit) <> sum(credit)`);
    expect(bad).toEqual([]);
    const chk = await s.one(`select integrity_check() r`);
    expect(chk.r.checks.filter((c: any) => !c.ok)).toEqual([]);
    expect(chk.r.ok).toBe(true);
  });

  it('logs policy changes in the audit trail', async () => {
    await s.as(manager);
    await s.q(`select update_fund_settings('{"monthly_contribution": 250}'::jsonb)`);
    await s.system();
    const log = await s.one(`select old_data->>'monthly_contribution' o, new_data->>'monthly_contribution' nw from audit_logs where action = 'policy_change' order by id desc limit 1`);
    expect([n(log.o), n(log.nw)]).toEqual([200, 250]);
    await s.as(manager);
    await expectFail(s.q(`select update_fund_settings('{"contribution_treatment":"liability_refundable"}'::jsonb)`), /لا يمكن تغيير المعالجة/);
  });
});

describe('family events & welcome phrases', () => {
  it('manager edits welcome phrases; members cannot', async () => {
    await s.as(manager);
    await s.q(`select set_welcome_phrases('["  أهلاً بالعائلة ", "", "صندوقنا بيتنا"]'::jsonb)`);
    expect(await s.val(`select welcome_phrases from fund_settings`)).toEqual(['أهلاً بالعائلة', 'صندوقنا بيتنا']);
    await expectFail(s.q(`select set_welcome_phrases('[]'::jsonb)`), /عبارة واحدة/);
    await s.as(aliUser);
    await expectFail(s.q(`select set_welcome_phrases('["x y"]'::jsonb)`), /مدير الصندوق فقط/);
  });

  it('invitation, notification, RSVP and counts', async () => {
    await s.as(manager);
    const future = await s.val(`select (fund_today() + 20)::text`);
    const ev = await s.val(`select create_event($1::jsonb)`, [JSON.stringify({ kind: 'desert', title: 'كشتة العائلة', event_date: future, start_time: 'العصر', location: 'روضة خريم' })]);
    await s.as(aliUser);
    expect(Number(await s.val(`select count(*) from notifications where type = 'event_invite'`))).toBe(1);
    await expectFail(s.q(`select create_event('{"kind":"eid","title":"x y","event_date":"2030-01-01"}'::jsonb)`), /مدير الصندوق فقط/);
    await s.q(`select rsvp_event($1, 'yes', 3, 'نجي كلنا')`, [ev]);
    await s.q(`select rsvp_event($1, 'yes', 4)`, [ev]);
    await s.as(saraUser);
    await s.q(`select rsvp_event($1, 'no')`, [ev]);
    expect((await s.q(`select * from event_rsvps`)).length).toBe(1);   // sees only own RSVP
    await s.as(manager);
    const sum = await s.one(`select yes_count, no_count, guests_count, expected_attendance from v_event_summary where id = $1`, [ev]);
    expect([Number(sum.yes_count), Number(sum.no_count), Number(sum.guests_count), Number(sum.expected_attendance)]).toEqual([1, 1, 4, 5]);
    await s.q(`select cancel_event($1, 'تأجيل بسبب الطقس')`, [ev]);
    await s.as(aliUser);
    await expectFail(s.q(`select rsvp_event($1, 'yes')`, [ev]), /غير متاحة/);
  });
});

describe('monthly member reports', () => {
  it('issues snapshots that reconcile with live balances, notifies, and stays private', async () => {
    await s.as(manager);
    const members = Number(await s.val(`select count(*) from members where status = 'active' and join_date <= (date_trunc('month', fund_today()) + interval '1 month - 1 day')::date`));
    const n = Number(await s.val(`select issue_monthly_reports($1::date, 'شكراً لالتزامكم', true)`, [monthStart]));
    expect(n).toBe(members);
    // re-issuing the same month replaces rather than duplicates
    await s.q(`select issue_monthly_reports($1::date, null, false)`, [monthStart]);
    expect(Number(await s.val(`select count(*) from monthly_reports where period = $1::date`, [monthStart]))).toBe(members);
    const r = await s.one(`select report from monthly_reports where member_id = $1 and period = $2::date`, [ali, monthStart]);
    const b = await s.one(`select * from v_member_balances where member_id = $1`, [ali]);
    expect(n2(r.report.deposits.closing)).toBe(n2(b.deposit_balance));
    expect(n2(r.report.contribution.total_paid)).toBe(n2(b.contributions_total));
    expect(n2(r.report.loans.outstanding)).toBe(n2(b.loan_outstanding));
    expect(n2(r.report.net_position)).toBe(n2(b.contributions_total) + n2(b.deposit_balance) - n2(b.loan_outstanding));
    await expectFail(s.q(`select issue_monthly_reports((fund_today() + 40)::date)`), /لم يبدأ/);

    await s.as(aliUser);
    expect((await s.q(`select * from monthly_reports`)).length).toBe(1);
    expect(Number(await s.val(`select count(*) from notifications where type = 'monthly_report'`))).toBe(1);
    const id = await s.val(`select id from monthly_reports`);
    await s.q(`select mark_report_read($1)`, [id]);
    expect(await s.val(`select read_at is not null from monthly_reports where id = $1`, [id])).toBe(true);
    await expectFail(s.q(`select issue_monthly_reports()`), /مدير الصندوق فقط/);
  });

  it('auto-issue runs once per month and respects the setting', async () => {
    await s.system();
    const first = Number(await s.val(`select auto_monthly_reports()`));
    expect(first).toBeGreaterThan(0);
    expect(Number(await s.val(`select auto_monthly_reports()`))).toBe(0);
    await s.as(manager);
    await s.q(`select set_monthly_report_prefs(false, 'ملاحظة')`);
    expect(await s.val(`select monthly_report_auto from fund_settings`)).toBe(false);
  });

  it('mailer queue: only unsent reports, marks success and failure', async () => {
    await s.system();
    const pending = await s.q(`select * from reports_to_email($1::date)`, [monthStart]);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((r: any) => r.email)).toBe(true);
    const [a, b] = pending;
    await s.q(`select mark_report_emailed($1, $2, null)`, [a.id, a.email]);
    if (b) await s.q(`select mark_report_emailed($1, $2, 'smtp down')`, [b.id, b.email]);
    const after = await s.q(`select id from reports_to_email($1::date)`, [monthStart]);
    expect(after.length).toBe(pending.length - 1);              // sent one drops out, failed one is retried
    expect((await s.q(`select id from reports_to_email(null, array[$1]::uuid[], true)`, [a.id])).length).toBe(1);
    await s.as(aliUser);
    await expectFail(s.q(`select * from reports_to_email()`), /permission denied/);
  });
});
const n2 = (v: any) => Math.round(Number(v) * 100) / 100;

describe('stock portfolio & members view', () => {
  it('holdings, market prices, valuation sync and member visibility', async () => {
    await s.as(manager);
    const inv = await s.val(`select create_investment('محفظة الصندوق', 'equity', null, 'الأهلي المالية', $1::date, null, 500)`, [today]);
    await s.q(`select upsert_holding($1, '2222', 'أرامكو', 10, 26)`, [inv]);
    await s.q(`select upsert_holding($1, '4250', 'جبل عمر', 10, 15)`, [inv]);
    await s.q(`select set_portfolio_cash($1, 90)`, [inv]);
    expect(n(await s.val(`select portfolio_market_value($1)`, [inv]))).toBe(10 * 26 + 10 * 15 + 90);      // no prices yet → at cost
    await expectFail(s.q(`select apply_market_prices('[{"symbol":"2222","price":30}]'::jsonb)`), /permission denied/);
    await s.system();
    expect(n(await s.val(`select apply_market_prices('[{"symbol":"2222","price":30,"prev_close":29},{"symbol":"4250","price":14,"prev_close":14.5}]'::jsonb)`))).toBe(2);
    await s.as(manager);
    const mv = 10 * 30 + 10 * 14 + 90;
    expect(n(await s.val(`select portfolio_market_value($1)`, [inv]))).toBe(mv);
    await s.q(`select sync_portfolio_valuation($1)`, [inv]);
    expect(n(await s.val(`select current_value from v_investment_positions where id = $1`, [inv]))).toBe(mv);
    expect(await s.val(`select sync_portfolio_valuation($1)`, [inv])).toBeNull();                      // unchanged → no entry
    expect((await s.val(`select integrity_check()`) as any).ok).toBe(true);

    // members: names & prices only by default
    await s.as(aliUser);
    expect((await s.q(`select * from portfolio_holdings`)).length).toBe(0);
    const v: any = await s.val(`select member_investments()`);
    const port = v.items.find((x: any) => x.id === inv);
    expect(v.mode).toBe('names');
    expect(port.value).toBeNull();
    expect(port.holdings.map((h: any) => h.symbol).sort()).toEqual(['2222', '4250']);
    expect(port.holdings.every((h: any) => h.quantity === null && h.market_value === null && n(h.price) > 0)).toBe(true);
    await expectFail(s.q(`select set_member_investments_view('full')`), /مدير الصندوق فقط/);
    await s.as(manager);
    await s.q(`select set_member_investments_view('full')`);
    await s.as(aliUser);
    const f: any = await s.val(`select member_investments()`);
    expect(n(f.items.find((x: any) => x.id === inv).holdings[0].quantity)).toBe(10);
    await s.as(manager);
    await s.q(`select set_member_investments_view('hidden')`);
    await s.as(aliUser);
    expect(((await s.val(`select member_investments()`)) as any).items.length).toBe(0);
    await s.as(manager);
    await s.q(`select set_member_investments_view('names')`);
  });
});
