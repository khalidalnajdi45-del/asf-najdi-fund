import { describe, it, expect, beforeAll } from 'vitest';
import { freshDb, Session } from './db';

let s: Session; let manager: string, aliUser: string, ali: string, today: string;
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

describe('push notifications', () => {
  it('stores subscriptions privately and per-category prefs', async () => {
    await s.as(aliUser);
    await s.q(`select save_push_subscription('https://web.push.apple.com/abc', 'pk', 'au', 'iPhone')`);
    await s.q(`select save_push_subscription('https://web.push.apple.com/abc', 'pk2', 'au2', 'iPhone')`);
    await s.q(`select set_push_pref('tasks', false)`);
    const st = await s.val<any>(`select my_push_settings()`);
    expect(Number(st.devices)).toBe(1);
    expect(st.prefs.tasks).toBe(false);
    await expect(s.q(`select * from push_subscriptions`)).rejects.toThrow();
    await expect(s.q(`select set_push_pref('nope', true)`)).rejects.toThrow();
    await s.system();
    expect(await s.val(`select _push_wanted($1, 'contribution_reminder')`, [aliUser])).toBe(true);
    expect(await s.val(`select _push_wanted($1, 'task_reminder')`, [aliUser])).toBe(false);
    expect(await s.val(`select _push_wanted($1, 'announcement')`, [manager])).toBe(false); // no device
    expect(await s.val(`select push_category('loan_request')`)).toBe('admin');
  });

  it('reminds about tasks once, and the morning run works', async () => {
    await s.as(aliUser);
    const hhmm = await s.val(`select to_char((now() at time zone 'Asia/Riyadh') + interval '10 minutes', 'HH24:MI')`);
    const d = await s.val(`select ((now() at time zone 'Asia/Riyadh') + interval '10 minutes')::date::text`);
    await s.q(`select add_my_task('اجتماع العائلة', $1::date, $2)`, [d, hhmm]);
    await s.system();
    expect(await s.val(`select run_task_reminders()`)).toBe(1);
    await s.val(`select run_task_reminders()`);
    expect(Number(await s.val(`select count(*) from notifications where type = 'task_reminder' and user_id = $1`, [aliUser]))).toBe(1);
    await s.val(`select run_morning_push()`);
    await s.val(`select run_morning_push()`); // idempotent
  });
});
