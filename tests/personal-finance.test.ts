import { describe, it, expect, beforeAll } from 'vitest';
import { freshDb, Session } from './db';

let s: Session;
let manager: string, aliUser: string, ali: string;
let today: string;
const n = (v: any) => Number(v);

beforeAll(async () => {
  s = new Session(await freshDb());
  await s.system();
  today = await s.val(`select fund_today()::text`);
  manager = await s.val(`select _create_auth_user('manager@test.sa', 'Manager#2026', 'مدير الصندوق', 'manager')`);
  await s.as(manager);
  ali = await s.val(`select admin_create_member('علي النجدي', 'ali@test.sa', 'Password#1', null, $1::date)`, [today]);
  await s.system();
  aliUser = await s.val(`select user_id from members where id = $1`, [ali]);
}, 60_000);

describe('ماليتي — personal finance', () => {
  it('seeds categories, records income/expense, budgets and goals', async () => {
    await s.as(aliUser);
    const ov = await s.val<any>(`select pf_overview(null)`);
    const cats = ov.categories as any[];
    expect(cats.some(c => c.name === 'مناسبات العائلة')).toBe(true);
    const groc = cats.find(c => c.name === 'بقالة وتموين').id, sal = cats.find(c => c.name === 'الراتب').id;
    await s.q(`select pf_add_tx('income', 12000, $1, $2::date, 'راتب')`, [sal, today]);
    await s.q(`select pf_add_tx('expense', 350.5, $1, $2::date, 'بنده', 'sms')`, [groc, today]);
    await s.q(`select pf_set_budget($1, 1000)`, [groc]);
    const g = await s.val(`select pf_add_goal('سيارة', 20000, null)`);
    await s.q(`select pf_goal_save($1, 2500)`, [g]);
    const o2 = await s.val<any>(`select pf_overview(null)`);
    expect(n(o2.income)).toBe(12000);
    expect(n(o2.expense)).toBe(350.5);
    const b = o2.by_category.find((x: any) => x.name === 'بقالة وتموين');
    expect(n(b.budget)).toBe(1000);
    expect(n(o2.goals[0].saved)).toBe(2500);
    expect(o2.transactions).toHaveLength(2);
    expect(o2.trend).toHaveLength(6);
  });

  it('is private: no table access, and the manager sees only his own (empty) data', async () => {
    await s.as(aliUser);
    await expect(s.q(`select * from pf_transactions`)).rejects.toThrow();
    await s.as(manager);
    await expect(s.q(`select * from pf_transactions`)).rejects.toThrow();
    const o = await s.val<any>(`select pf_overview(null)`);
    expect(o.transactions).toHaveLength(0);
    // manager cannot delete someone else's rows through the API either
    await s.system();
    const id = await s.val(`select id from pf_transactions limit 1`);
    await s.as(manager);
    await s.q(`select pf_delete_tx($1)`, [id]);
    await s.system();
    expect(n(await s.val(`select count(*) from pf_transactions`))).toBe(2);
  });

  it('posts recurring entries once per month up to today', async () => {
    await s.as(aliUser);
    const day = Number(today.slice(8, 10));
    if (day > 28) return; // recurring days are 1..28
    await s.q(`select pf_add_recurring('expense', 1500, null, $1, 'إيجار')`, [day]);
    await s.val(`select pf_overview(null)`);
    await s.val(`select pf_overview(null)`);
    await s.system();
    expect(n(await s.val(`select count(*) from pf_transactions where source = 'recurring'`))).toBe(1);
  });
});
