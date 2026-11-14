'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Copy, Download, MapPin, Share2 } from 'lucide-react';
import { drawInvitation, downloadInvitation, formatEventDate, shareInvitation, THEMES, KIND_ORDER, type EventKind, type InvitationData } from '@/lib/invitation';
import { Button, Tag, useToast } from './ui';

export type EventRow = {
  id: string; kind: EventKind; title: string; message: string | null; event_date: string; start_time: string | null;
  location: string | null; location_url: string | null; host: string | null; rsvp_enabled: boolean; status: 'active' | 'cancelled';
  created_at: string; yes_count: number; no_count: number; maybe_count: number; guests_count: number; expected_attendance: number;
};

export const kindLabel = (k: string) => THEMES[k as EventKind]?.label ?? k;
export const rsvpLabels: Record<string, string> = { yes: 'سأحضر', maybe: 'ربما', no: 'أعتذر' };

export function isPast(d: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  return d < today;
}
export function daysUntil(d: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  return Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
}
export function countdown(d: string) {
  const n = daysUntil(d);
  if (n < 0) return 'انتهت';
  if (n === 0) return 'اليوم';
  if (n === 1) return 'غداً';
  if (n === 2) return 'بعد يومين';
  if (n <= 10) return `بعد ${n} أيام`;
  return `بعد ${n} يوماً`;
}

export function toInvitation(e: Partial<EventRow> & { kind: EventKind }, fundName?: string | null): InvitationData {
  return {
    kind: e.kind, title: e.title ?? '', message: e.message ?? null, event_date: e.event_date ?? '', start_time: e.start_time ?? null,
    location: e.location ?? null, host: e.host ?? null, fund_name: fundName, cancelled: e.status === 'cancelled',
  };
}

/** Live canvas preview — same renderer as the downloaded image. */
export function InvitationCanvas({ data, className }: { data: InvitationData; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(data);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive && ref.current) drawInvitation(ref.current, data).catch(() => {}); }, 60);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} width={1080} height={1350} role="img" aria-label={`دعوة: ${data.title}`}
    className={clsx('aspect-[4/5] w-full rounded-xl bg-canvas shadow-[0_6px_24px_rgba(42,23,51,0.18)]', className)} />;
}

const swatch: Record<EventKind, string> = {
  eid: 'linear-gradient(160deg,#5b3470,#2A1733)', ramadan: 'linear-gradient(160deg,#140d22,#3a2150)',
  sea: 'linear-gradient(180deg,#f2cfa1,#9cc9cb 45%,#2f6f7a)', desert: 'linear-gradient(180deg,#f8e3b9,#e08d58 50%,#a8654a)',
  gathering: 'linear-gradient(180deg,#fbf7f0,#F6F1E8)', general: 'linear-gradient(160deg,#4A2A5A,#2A1733)',
};
const glyph: Record<EventKind, string> = { eid: '✦', ramadan: '☾', sea: '⛵', desert: '⛺', gathering: '⌂', general: '✉' };

export function ThemePicker({ value, onChange }: { value: EventKind; onChange: (k: EventKind) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {KIND_ORDER.map(k => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          className={clsx('group overflow-hidden rounded-lg border-2 text-center transition', value === k ? 'border-gold-500' : 'border-transparent hover:border-line')}>
          <div className={clsx('flex h-14 items-center justify-center text-2xl', k === 'gathering' ? 'text-brand-800' : 'text-gold-300')} style={{ background: swatch[k] }}>{glyph[k]}</div>
          <div className={clsx('py-1.5 text-xs', value === k ? 'font-semibold text-ink' : 'text-muted')}>{THEMES[k].label}</div>
        </button>
      ))}
    </div>
  );
}

export function inviteText(e: EventRow, fundName?: string | null) {
  const { greg, hijri } = formatEventDate(e.event_date);
  return [
    `✨ ${THEMES[e.kind].kicker}`, `*${e.title}*`, e.message ?? THEMES[e.kind].message, '',
    `📅 ${greg}${hijri ? ` (${hijri})` : ''}`, e.start_time ? `🕰 ${e.start_time}` : '',
    e.location ? `📍 ${e.location}` : '', e.location_url ?? '', e.host ? `الداعي: ${e.host}` : '', '',
    fundName ?? 'صندوق النجدي الادخاري',
  ].filter((l, i, a) => l !== '' || (a[i - 1] ?? '') !== '').join('\n').trim();
}

export function ShareBar({ e, fundName }: { e: EventRow; fundName?: string | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const data = toInvitation(e, fundName);
  const copy = () => navigator.clipboard.writeText(inviteText(e, fundName)).then(() => toast.ok('تم نسخ نص الدعوة — الصقه في واتساب'), () => toast.err('تعذر النسخ'));
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" loading={busy} icon={<Download className="size-4" />}
        onClick={async () => { setBusy(true); try { await downloadInvitation(data); } finally { setBusy(false); } }}>تنزيل الصورة</Button>
      <Button size="sm" variant="ghost" icon={<Share2 className="size-4" />}
        onClick={async () => { try { if (!(await shareInvitation(data))) toast.ok('المشاركة غير مدعومة على هذا الجهاز — نزّل الصورة'); } catch {} }}>مشاركة</Button>
      <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={copy}>نسخ نص الدعوة</Button>
      {e.location_url && <a href={e.location_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-sm text-brand-700 hover:bg-brand-50"><MapPin className="size-4" />الموقع</a>}
    </div>
  );
}

/** Compact strip on the dashboard pointing to the nearest upcoming occasion. */
export function NextEventStrip({ href }: { href: string }) {
  const [e, setE] = useState<EventRow | null>(null);
  useEffect(() => {
    let alive = true;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
    import('@/lib/supabase').then(({ supabase }) => supabase().from('v_event_summary').select('*').eq('status', 'active').gte('event_date', today).order('event_date').limit(1))
      .then(r => { if (alive) setE((r.data?.[0] as EventRow) ?? null); }, () => {});
    return () => { alive = false; };
  }, []);
  if (!e) return null;
  const { greg } = formatEventDate(e.event_date);
  return (
    <a href={href} className="mb-4 flex items-center gap-3 rounded-xl border border-gold-100 bg-gold-100/50 px-4 py-3 text-sm transition hover:border-gold-500">
      <span className="text-xl" aria-hidden>{glyph[e.kind]}</span>
      <span className="min-w-0 flex-1"><b className="text-ink">{e.title}</b><span className="block truncate text-xs text-muted">{greg}{e.location ? ` · ${e.location}` : ''}</span></span>
      <Tag tone="violet">{countdown(e.event_date)}</Tag>
    </a>
  );
}
