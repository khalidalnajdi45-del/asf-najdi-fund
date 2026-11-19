// Money arrives from Postgres numeric as strings — never parsed to floats for arithmetic in the DB.
// The UI only formats; all calculations happen server-side with exact decimals.

let arabicDigits = false;
export function setArabicDigits(v: boolean) { arabicDigits = v; }
export function getArabicDigits() { return arabicDigits; }
const locale = () => (arabicDigits ? 'ar-SA' : 'ar-SA-u-nu-latn');

export function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  return typeof v === 'number' ? v : Number(v);
}

export function sar(v: unknown, opts: { sign?: boolean; compact?: boolean } = {}) {
  const n = num(v);
  const f = new Intl.NumberFormat(locale(), {
    minimumFractionDigits: opts.compact ? 0 : 2, maximumFractionDigits: 2,
    notation: opts.compact && Math.abs(n) >= 100000 ? 'compact' : 'standard',
    signDisplay: opts.sign ? 'exceptZero' : 'auto',
  }).format(n);
  return `${f} ر.س`;
}

export function plain(v: unknown, digits = 0) {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(num(v));
}

export function pct(v: unknown, digits = 1) {
  return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: digits }).format(num(v));
}

export function date(v: unknown) {
  if (!v) return '—';
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : String(v));
  // strip the bidi marks Intl adds: inside LTR number cells they flip the order (e.g. "102026/05/")
  return new Intl.DateTimeFormat(locale(), { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Riyadh' }).format(d).replace(/[\u200e\u200f\u061c]/g, '');
}

export function dateTime(v: unknown) {
  if (!v) return '—';
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(String(v)));
}

export function monthLabel(v: unknown) {
  if (!v) return '—';
  const s = String(v);
  const d = new Date(`${s.length === 7 ? s + '-01' : s.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'long' }).format(d);
}

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
}

export function firstOfMonth(offsetMonths = 0) {
  const [y, m] = today().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  return d.toISOString().slice(0, 10);
}

export function lastOfMonth(offsetMonths = 0) {
  const [y, m] = today().split('-').map(Number);
  const d = new Date(Date.UTC(y, m + offsetMonths, 0));
  return d.toISOString().slice(0, 10);
}

/** Members log in with a username backed by a synthetic auth address — show the username, never that address. */
export const LOGIN_DOMAIN = 'members.najdi-fund.app';
export const isLoginAlias = (e?: string | null) => !!e && e.toLowerCase().endsWith('@' + LOGIN_DOMAIN);
export const loginName = (e?: string | null) => (isLoginAlias(e) ? e!.split('@')[0] : e ?? '');
