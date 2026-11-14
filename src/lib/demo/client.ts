// DEMO MODE ONLY (NEXT_PUBLIC_DEMO=1).
// A drop-in stand-in for the supabase-js client: the real Postgres schema, accounting engine,
// RLS policies and API functions run inside the browser (PGlite / WASM), persisted in IndexedDB.
// Every query is executed as role `authenticated` with the signed-in user's id — exactly like PostgREST.
import { SCHEMA_SQL, SEED_SQL } from './sql.generated';

const DB_NAME = 'idb://asf-demo-v1';
const SESSION_KEY = 'asf-demo-session';
type Res<T = any> = { data: T; error: { message: string } | null; count?: number | null };

let dbPromise: Promise<any> | null = null;
let status: (s: string) => void = () => {};
export function onDemoStatus(f: (s: string) => void) { status = f; }

async function openDb(): Promise<any> {
  const load = (p: string) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ p);
  const base = process.env.NEXT_PUBLIC_PGLITE_BASE || '/pglite';
  const [{ PGlite }, { pgcrypto }] = await Promise.all([load(`${base}/index.js`), load(`${base}/contrib/pgcrypto.js`)]);
  const ts = (v: string) => v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const opts = {
    extensions: { pgcrypto },
    parsers: { 1082: (v: string) => v, 1114: ts, 1184: ts, 20: (v: string) => Number(v), 1700: (v: string) => v },
  };
  let db: any;
  try { db = new PGlite(DB_NAME, opts); await db.waitReady; }
  catch { db = new PGlite(opts); await db.waitReady; }
  const ready = await db.query(`select to_regclass('public.fund_settings') is not null as ok`);
  if (!ready.rows[0].ok) {
    status('تجهيز قاعدة البيانات…');
    await db.exec(SCHEMA_SQL);
    status('تحميل البيانات التجريبية…');
    await db.exec(SEED_SQL);
  }
  status('');
  return db;
}
export const db = () => (dbPromise ??= openDb());

export async function resetDemo() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  await new Promise<void>(r => { const q = indexedDB.deleteDatabase('/pglite/asf-demo-v1'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  if (process.env.NEXT_PUBLIC_SPA === '1') { location.hash = '/login/'; location.reload(); } else location.href = '/login/';
}

// ---------------------------------------------------------------- session
type Session = { user: { id: string; email: string }; access_token: string };
const listeners = new Set<(e: string, s: Session | null) => void>();
const readSession = (): Session | null => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'); } catch { return null; } };
const writeSession = (s: Session | null) => { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {} };

async function asUser<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  const d = await db();
  const uid = readSession()?.user.id ?? '';
  return d.transaction(async (tx: any) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await tx.exec(uid ? 'set local role authenticated' : 'set local role anon');
    return fn(tx);
  });
}

const err = (e: any): { message: string } => ({ message: String(e?.message ?? e).replace(/^error:\s*/i, '') });
const ident = (s: string) => '"' + s.trim().replace(/"/g, '') + '"';

// ---------------------------------------------------------------- query builder (subset used by the app)
class Query implements PromiseLike<Res> {
  private cols = '*';
  private countOnly = false;
  private where: string[] = [];
  private params: any[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  constructor(private table: string) {}
  select(cols = '*', opts?: { count?: string; head?: boolean }) { this.cols = cols; this.countOnly = !!opts?.head; return this; }
  private add(op: string, col: string, v: any) { this.params.push(v); this.where.push(`t.${ident(col)} ${op} $${this.params.length}`); return this; }
  eq(c: string, v: any) { return this.add('=', c, v); }
  gte(c: string, v: any) { return this.add('>=', c, v); }
  lte(c: string, v: any) { return this.add('<=', c, v); }
  in(c: string, v: any[]) { this.params.push(v.map(String)); this.where.push(`t.${ident(c)}::text = any($${this.params.length}::text[])`); return this; }
  order(c: string, o?: { ascending?: boolean }) { const asc = o?.ascending !== false; this.orders.push(`t.${ident(c)} ${asc ? 'asc nulls last' : 'desc nulls first'}`); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  private sql() {
    const fields = this.cols.split(/,(?![^(]*\))/).map(c => c.trim()).filter(Boolean).map(c => {
      const emb = c.match(/^(\w+)\(([^)]*)\)$/);
      if (emb) {
        const [, rel, sub] = emb;
        const fk = rel.replace(/s$/, '') + '_id';
        const obj = sub.split(',').map(s => `'${s.trim()}', r.${ident(s)}`).join(', ');
        return `(select json_build_object(${obj}) from public.${ident(rel)} r where r.id = t.${ident(fk)}) as ${ident(rel)}`;
      }
      return c === '*' ? 't.*' : `t.${ident(c)}`;
    });
    let s = `select ${this.countOnly ? 'count(*)::int as count' : fields.join(', ')} from public.${ident(this.table)} t`;
    if (this.where.length) s += ` where ${this.where.join(' and ')}`;
    if (!this.countOnly && this.orders.length) s += ` order by ${this.orders.join(', ')}`;
    if (!this.countOnly && this.lim) s += ` limit ${this.lim}`;
    return s;
  }
  async run(): Promise<Res> {
    try {
      const rows = await asUser(async tx => (await tx.query(this.sql(), this.params)).rows);
      if (this.countOnly) return { data: null, error: null, count: rows[0]?.count ?? 0 };
      if (this.mode === 'many') return { data: rows, error: null };
      if (this.mode === 'single' && rows.length !== 1) return { data: null, error: { message: 'السجل غير موجود' } };
      return { data: rows[0] ?? null, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  }
  then<A = Res, B = never>(ok?: ((v: Res) => A | PromiseLike<A>) | null, no?: ((r: any) => B | PromiseLike<B>) | null) { return this.run().then(ok, no); }
}

async function rpc(fn: string, params: Record<string, any> = {}): Promise<Res> {
  try {
    const keys = Object.keys(params);
    const args = keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ');
    const vals = keys.map(k => {
      const v = params[k];
      if (v === undefined || v === null) return null;
      if (Array.isArray(v) && v.every(x => typeof x === 'string')) return k === 'p_lines' ? JSON.stringify(v) : `{${v.join(',')}}`;
      if (typeof v === 'object') return JSON.stringify(v);
      return typeof v === 'number' ? String(v) : v;
    });
    const r = await asUser(async tx => (await tx.query(`select public.${ident(fn)}(${args}) as r`, vals)).rows[0]?.r);
    return { data: r ?? null, error: null };
  } catch (e) { return { data: null, error: err(e) }; }
}

// ---------------------------------------------------------------- auth / storage
const auth = {
  async getSession() { return { data: { session: readSession() }, error: null }; },
  onAuthStateChange(cb: (e: string, s: Session | null) => void) {
    listeners.add(cb);
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const d = await db();
      const r = await d.query(`select id, email from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`, [email, password]);
      if (!r.rows.length) return { data: null, error: { message: 'Invalid login credentials' } };
      const s: Session = { user: { id: r.rows[0].id, email: r.rows[0].email }, access_token: 'demo' };
      writeSession(s);
      listeners.forEach(l => l('SIGNED_IN', s));
      return { data: { session: s }, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
  async signOut() { writeSession(null); listeners.forEach(l => l('SIGNED_OUT', null)); return { error: null }; },
  async updateUser({ password }: { password?: string }) {
    const s = readSession();
    if (s && password) {
      const d = await db();
      await d.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id = $1`, [s.user.id, password]);
    }
    return { data: { user: s?.user }, error: null };
  },
  mfa: {
    async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }; },
    async listFactors() { return { data: { totp: [] }, error: null }; },
    async enroll() { return { data: null, error: { message: 'التحقق بخطوتين يعمل في النسخة الفعلية فقط' } }; },
    async challenge() { return { data: null, error: { message: 'غير متاح في النسخة التجريبية' } }; },
    async verify() { return { data: null, error: { message: 'غير متاح في النسخة التجريبية' } }; },
    async unenroll() { return { data: null, error: null }; },
  },
};

const files = new Map<string, Blob>();
const storage = {
  from: () => ({
    async upload(path: string, file: Blob) { files.set(path, file); return { data: { path }, error: null }; },
    async createSignedUrl(path: string) {
      const f = files.get(path);
      return f ? { data: { signedUrl: URL.createObjectURL(f) }, error: null } : { data: null, error: { message: 'الملف غير متاح في جلسة العرض هذه' } };
    },
  }),
};

export function createDemoClient() {
  return { from: (t: string) => new Query(t), rpc, auth, storage };
}
