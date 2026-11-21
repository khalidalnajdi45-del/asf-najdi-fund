import { describe, it, expect, beforeAll } from 'vitest';
import { freshDb, Session } from './db';

let s: Session; let manager: string, ali: string, aliUser: string, sara: string, saraUser: string, today: string;
beforeAll(async () => {
  s = new Session(await freshDb());
  await s.system();
  today = await s.val(`select fund_today()::text`);
  manager = await s.val(`select _create_auth_user('manager@test.sa', 'Manager#2026', 'مدير الصندوق', 'manager')`);
  await s.as(manager);
  ali = await s.val(`select admin_create_member('علي النجدي', 'ali@test.sa', 'Password#1', null, $1::date)`, [today]);
  sara = await s.val(`select admin_create_member('سارة النجدي', 'sara@test.sa', 'Password#1', null, $1::date)`, [today]);
  await s.system();
  aliUser = await s.val(`select user_id from members where id = $1`, [ali]);
  saraUser = await s.val(`select user_id from members where id = $1`, [sara]);
}, 60_000);

describe('monthly member activity + backup + member invitations', () => {
  it('aggregates deposits per member and month', async () => {
    await s.as(manager);
    await s.q(`select record_deposit($1, 2500, $2::date, 'تحويل', 'T-1')`, [ali, today]);
    const r = await s.val<any[]>(`select report_member_activity($1)`, [Number(today.slice(0, 4))]);
    const a = r.find(x => x.member_id === ali);
    expect(Number(a.months[today.slice(0, 7)].dep)).toBe(2500);
    await s.system();
    const b = await s.val<any>(`select backup_payload($1::date)`, [today]);
    expect(b.transactions.length).toBeGreaterThan(0);
    await s.as(aliUser);
    await expect(s.q(`select report_member_activity(2026)`)).rejects.toThrow();
  });

  it('lets a member invite everyone and manage only their own invitation', async () => {
    await s.as(aliUser);
    const d = await s.val(`select (fund_today() + 5)::text`);
    const ev = await s.val(`select create_event(jsonb_build_object('kind','desert','title','كشتة علي','event_date',$1::text))`, [d]);
    const row = await s.one(`select is_mine, creator_name, host from v_event_summary where id = $1`, [ev]);
    expect(row.is_mine).toBe(true);
    expect(row.creator_name).toBe('علي النجدي');
    await s.system();
    expect(Number(await s.val(`select count(*) from notifications where type = 'event_invite' and link like '%events'`))).toBeGreaterThanOrEqual(2);
    await s.as(saraUser);
    await s.q(`select rsvp_event($1, 'yes', 2, null)`, [ev]);
    await expect(s.q(`select cancel_event($1, null)`, [ev])).rejects.toThrow();
    await expect(s.q(`select event_responses($1)`, [ev])).rejects.toThrow();
    await s.as(aliUser);
    const rs = await s.val<any[]>(`select event_responses($1)`, [ev]);
    expect(rs[0].member_name).toBe('سارة النجدي');
    await s.q(`select update_event($1, jsonb_build_object('kind','sea','title','طلعة بحرية','event_date',$2::text))`, [ev, d]);
    await s.q(`select cancel_event($1, 'تأجيل')`, [ev]);
  });
});
