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

describe('profit distribution & period close', () => {
  it('sets up members with contributions', async () => {
    await s.as(manager);
    ali = await s.val(`select admin_create_member('علي النجدي', 'ali@test.sa', 'Password#1', '0500000001', $1::date)`, [sixMonthsAgo]);
    sara = await s.val(`select admin_create_member('سارة النجدي', 'sara@test.sa', 'Password#2', null, $1::date)`, [sixMonthsAgo]);
    const c1 = await s.val(`select id from contributions where member_id = $1 order by period limit 1`, [ali]);
    await s.q(`select record_contribution_payment($1, 200, $2::date)`, [c1, today]).catch(() => null);
  });

  it('distributes realized surplus to members and locks closed periods', async () => {
    await s.as(manager);
    await s.q(`select record_income('أرباح بنكية', 'أرباح للتوزيع', 'البنك', 1000, $1::date)`, [today]);
    const avail = n(await s.val(`select distributable_surplus()`));
    expect(avail).toBeGreaterThanOrEqual(1000);
    const prev = await s.q(`select * from preview_profit_distribution(1000, 'equal')`);
    expect(prev.length).toBeGreaterThan(0);
    expect(prev.reduce((a: number, r: any) => a + n(r.amount), 0)).toBeCloseTo(1000, 2);
    const depBefore = n(await s.sysVal(`select account_balance('member_deposits')`));
    const did = await s.val(`select post_profit_distribution('أرباح الربع', 1000, 'equal', 'deposit')`);
    expect(n(await s.sysVal(`select account_balance('member_deposits')`))).toBeCloseTo(depBefore + 1000, 2);
    expect(n(await s.sysVal(`select sum(amount) from profit_distribution_lines where distribution_id = $1`, [did]))).toBeCloseTo(1000, 2);
    await expectFail(s.q(`select post_profit_distribution('كثير جداً', 99999999, 'equal', 'deposit')`), /أكبر من الفائض/);
    // merge field
    const anyMember = prev[0].member_id;
    expect(n((await s.sysVal(`select member_merge_fields($1)`, [anyMember]))['حصة_الأرباح'])).toBeGreaterThan(0);
    // period close locks earlier dates
    const lastYear = new Date().getFullYear() - 1;
    const cid = await s.val(`select close_fiscal_period('year', $1)`, [lastYear]);
    await expectFail(s.q(`select record_income('تبرعات وهبات', 'متأخر', null, 10, $1::date)`, [`${lastYear}-06-01`]), /مقفلة/);
    await s.q(`select record_income('تبرعات وهبات', 'حالي', null, 10, $1::date)`, [today]);
    await expectFail(s.q(`select close_fiscal_period('year', $1)`, [lastYear]), /مسبقاً/);
    await expectFail(s.q(`select close_fiscal_period('year', $1)`, [lastYear + 1]), /لم تنتهِ/);
    await s.q(`select reopen_fiscal_period($1, 'تصحيح قيد')`, [cid]);
    await s.q(`select record_income('تبرعات وهبات', 'بعد الفتح', null, 10, $1::date)`, [`${lastYear}-06-01`]);
  });

});
