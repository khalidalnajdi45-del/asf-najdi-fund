import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
export const MIGRATIONS = readdirSync(join(root, 'supabase/migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
const SUPABASE_ONLY = new Set(['0007_platform.sql', '0010_platform_reports.sql', '0012_platform_email.sql', '0013_platform_email_assets.sql']);

export async function freshDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(join(root, 'tests/supabase_stub.sql'), 'utf8'));
  for (const f of MIGRATIONS) {
    if (SUPABASE_ONLY.has(f)) continue;
    await db.exec(readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
  }
  return db;
}

export class Session {
  constructor(public db: PGlite) {}
  uid: string | null = null;
  /** run a query as the DB owner (e.g. to read GL balances), then restore the session user */
  async sysVal<T = any>(sql: string, params: any[] = []): Promise<T> {
    const u = this.uid; await this.as(null);
    try { return await this.val<T>(sql, params); } finally { await this.as(u); }
  }
  async as(uid: string | null) {
    this.uid = uid;
    await this.db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
    if (uid) await this.db.exec('set role authenticated;');
  }
  async system() { await this.as(null); }
  async q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return (await this.db.query<T>(sql, params)).rows;
  }
  async one<T = any>(sql: string, params: any[] = []): Promise<T> {
    const r = await this.q<T>(sql, params); return r[0];
  }
  async val<T = any>(sql: string, params: any[] = []): Promise<T> {
    const r: any = await this.one(sql, params); return r ? (Object.values(r)[0] as T) : (undefined as T);
  }
}
