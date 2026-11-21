import { describe, it, expect, beforeAll } from 'vitest';
import { freshDb, Session } from './db';

let s: Session;
let manager: string, aliUser: string, ali: string, saraUser: string, sara: string;
let today: string;
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
  await s.q(`update fund_settings set loan_max_amount = 10000, loan_auto_approve = false, loan_block_if_overdue = false`);
  manager = await s.val(`select _create_auth_user('manager@test.sa', 'Manager#2026', 'مدير الصندوق', 'manager')`);
  await s.as(manager);
  ali = await s.val(`select admin_create_member('علي النجدي', 'ali@test.sa', 'Password#1', null, $1::date)`, [today]);
  sara = await s.val(`select admin_create_member('سارة النجدي', 'sara@test.sa', 'Password#2', null, $1::date)`, [today]);
  await s.q(`select record_deposit($1, 50000, $2::date)`, [sara, today]);
  await s.system();
  aliUser = await s.val(`select user_id from members where id = $1`, [ali]);
  saraUser = await s.val(`select user_id from members where id = $1`, [sara]);
}, 60_000);

describe('loan scheduling', () => {
  let loan: string;
  it('member request above the platform cap is refused without stating the cap', async () => {
    await s.as(aliUser);
    await expectFail(s.q(`select request_loan(12000, 'شراء سيارة', 12)`), /تواصل مع مدير الصندوق/);
  });

  it('request with a chosen start month: installments fall on the 28th', async () => {
    await s.as(aliUser);
    const start = await s.val(`select (date_trunc('month', fund_today()) + interval '3 months')::date::text`);
    loan = await s.val(`select request_loan(1250, 'ترميم', 12, null, 'installments', $1::date)`, [start]);
    const l = await s.one(`select preferred_start::text ps, repayment_mode from loans where id = $1`, [loan]);
    expect(l.ps.slice(8)).toBe('28');
    await s.as(manager);
    await s.q(`select approve_loan($1, 1250, 12, 'monthly')`, [loan]);
    await s.q(`select disburse_loan($1, $2::date)`, [loan, today]);
    const rows = await s.q(`select due_date::text d, amount_due a from loan_installments where loan_id = $1 order by seq`, [loan]);
    expect(rows.length).toBe(12);                                    // 1250 / 12 ≥ 100
    expect(rows.every((r: any) => r.d.endsWith('-28'))).toBe(true);
    expect(rows[0].d).toBe(l.ps);
    expect(rows.reduce((a: number, r: any) => a + n(r.a), 0)).toBe(1250);
    expect(n(rows[0].a)).toBe(104);                                   // whole riyals, last takes the remainder
    expect(n(rows[11].a)).toBe(106);
  });

  it('minimum installment of 100 reduces the number of installments', async () => {
    await s.as(manager);
    const p = await s.val<any>(`select loan_plan_preview(450, 'installments', null, 12)`);
    expect(p.rows.length).toBe(4);
    expect(p.rows.every((r: any) => n(r.amount) >= 100)).toBe(true);
  });

  it('member reschedule waits for approval, keeps paid amounts settled', async () => {
    await s.as(manager);
    await s.q(`select record_loan_repayment($1, 300, $2::date)`, [loan, today]);
    await s.as(aliUser);
    const before = await s.q(`select seq, due_date, amount_due from loan_installments where loan_id = $1 order by seq`, [loan]);
    const start = await s.val(`select (fund_today() + interval '2 months')::date::text`);
    const req = await s.val(`select request_loan_reschedule($1, 'installments', $2::date, 5, 'ظرف طارئ')`, [loan, start]);
    await expectFail(s.q(`select request_loan_reschedule($1, 'lump', $2::date, 1)`, [loan, start]), /قيد المراجعة/);
    expect(await s.q(`select seq, due_date, amount_due from loan_installments where loan_id = $1 order by seq`, [loan])).toEqual(before);
    await expectFail(s.q(`select decide_loan_reschedule($1, true)`, [req]), /مدير الصندوق/);
    await s.as(manager);
    await s.q(`select decide_loan_reschedule($1, true, 'موافق')`, [req]);
    const rows = await s.q(`select seq, due_date::text d, amount_due a from loan_installments where loan_id = $1 order by seq`, [loan]);
    expect(rows.length).toBe(6);                                      // settled line + 5
    expect(n(rows[0].a)).toBe(300);
    expect(rows.slice(1).reduce((a: number, r: any) => a + n(r.a), 0)).toBe(950);
    const l = await s.one(`select outstanding, paid_count, overdue_count from v_loan_summary where id = $1`, [loan]);
    expect([n(l.outstanding), n(l.paid_count), n(l.overdue_count)]).toEqual([950, 1, 0]);
  });

  it('a member cannot rewrite the schedule directly, and the table stays locked', async () => {
    await s.as(aliUser);
    await expectFail(s.q(`select admin_reschedule_loan($1, 'lump', $2::date, 1)`, [loan, today]), /مدير الصندوق/);
    await s.system();
    await expectFail(s.q(`delete from loan_installments where loan_id = $1`, [loan]), /إعادة جدولة/);
  });

  it('lump-sum request and bulk rescheduling of all open loans', async () => {
    await s.as(saraUser);
    const when = await s.val(`select (fund_today() + interval '6 months')::date::text`);
    const l2 = await s.val(`select request_loan(3000, 'زواج', 1, null, 'lump', $1::date)`, [when]);
    await s.as(manager);
    await s.q(`select approve_loan($1, 3000, 1, 'monthly')`, [l2]);
    await s.q(`select disburse_loan($1, $2::date)`, [l2, today]);
    const one = await s.q(`select due_date::text d, amount_due a from loan_installments where loan_id = $1`, [l2]);
    expect(one).toEqual([{ d: when, a: '3000.00' }]);

    const jan = await s.val(`select (date_trunc('year', fund_today()) + interval '1 year' + interval '27 days')::date::text`);
    const pv = await s.val<any[]>(`select bulk_reschedule_preview($1::date, 12)`, [jan]);
    expect(pv.length).toBe(2);
    expect(await s.val(`select bulk_reschedule_apply($1::date, 12)`, [jan])).toBe(2);
    const r2 = await s.q(`select due_date::text d, amount_due a from loan_installments where loan_id = $1 order by seq`, [l2]);
    expect(r2.length).toBe(12);
    expect(r2[0].d).toBe(jan);
    expect(r2.reduce((a: number, r: any) => a + n(r.a), 0)).toBe(3000);
    expect(n(await s.val(`select count(*) from audit_logs where action = 'reschedule'`))).toBeGreaterThanOrEqual(3);
  });

  it('extra payment settles the last installments; monthly amount unchanged', async () => {
    await s.as(manager);
    const l3 = await s.val(`select admin_create_loan($1, 1200, 6, 'monthly', 'تجربة', 0, null, true, $2::date)`, [sara, today]);
    const before = await s.q(`select due_date::text d, amount_due a from loan_installments where loan_id = $1 order by seq`, [l3]);
    expect(before.length).toBe(6);
    await s.q(`select record_loan_repayment($1, 500, $2::date)`, [l3, today]);
    const rows = await s.q(`select due_date::text d, amount_due a from loan_installments where loan_id = $1 order by seq`, [l3]);
    const v = await s.q(`select status, amount_due a from v_installment_status where loan_id = $1 order by seq`, [l3]);
    expect(v[0].status).toBe('paid');
    expect(n(rows[0].a)).toBe(500);
    expect(n(rows[1].a)).toBe(200);                                  // monthly stays 200
    expect(rows[rows.length - 1].d < before[5].d).toBe(true);        // ends earlier
    expect(rows.reduce((a: number, r: any) => a + n(r.a), 0)).toBe(1200);
    expect(v.slice(1).every((r: any) => r.status !== 'paid')).toBe(true);
  });

  it('bulk plan keeps a member within 800 a month, loans one after another; manager can exceed', async () => {
    await s.as(manager);
    const jan = await s.val(`select (date_trunc('year', fund_today()) + interval '1 year' + interval '27 days')::date::text`);
    const pv = await s.val<any[]>(`select bulk_reschedule_preview($1::date, 12)`, [jan]);
    const sm = pv.find((x: any) => x.member_name === 'سارة النجدي');
    expect(sm.loans.length).toBe(2);
    expect(sm.months.every((m: any) => n(m.amount) <= 800)).toBe(true);
    await s.q(`select bulk_reschedule_apply($1::date, 12)`, [jan]);
    const sched = await s.q(`select i.due_date::text d, sum(i.amount_due) a from loan_installments i join loans l on l.id = i.loan_id
                               where l.member_id = $1 and i.due_date >= $2::date group by 1 order by 1`, [sara, jan]);
    expect(sched.every((r: any) => n(r.a) <= 800)).toBe(true);
    const k = await s.q(`select l.loan_no, max(i.due_date)::text last, min(i.due_date) filter (where i.due_date >= $2::date)::text first
                           from loan_installments i join loans l on l.id = i.loan_id where l.member_id = $1 group by 1 order by 2`, [sara, jan]);
    expect(k[0].last <= k[1].first).toBe(true);                       // second loan starts when the first ends
    const big = await s.val(`select admin_reschedule_loan($1, 'installments', $2::date, 2)`, [k[1].loan_no ? (await s.val(`select id from loans where loan_no = $1`, [k[1].loan_no])) : null, jan]);
    expect(n(big)).toBeGreaterThan(1);
  });
});
