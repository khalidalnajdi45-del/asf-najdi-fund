import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb, Session } from './db';

it('demo seed posts through the real API and leaves a fully reconciled ledger', async () => {
  const s = new Session(await freshDb());
  await s.system();
  await s.db.exec(readFileSync(join(__dirname, '../supabase/seed.sql'), 'utf8'));
  const chk = await s.one(`select integrity_check() r`);
  expect(chk.r.checks.filter((c: any) => !c.ok)).toEqual([]);
  const counts = await s.one(`select (select count(*) from members) m, (select count(*) from loans) l,
     (select count(*) from investments) i, (select count(*) from journal_entries) j,
     (select count(*) from loans where status = 'overdue') od, (select count(*) from loans where status = 'fully_repaid') fr,
     (select account_balance('cash')) cash`);
  console.log(counts);
  expect(Number(counts.m)).toBe(12);
  expect(Number(counts.od)).toBe(1);
  expect(Number(counts.fr)).toBe(2);
  expect(Number(counts.cash)).toBeGreaterThan(0);
}, 120_000);
