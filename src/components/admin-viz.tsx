'use client';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { num } from '@/lib/format';

/** Initials disc with a stable colour per name — makes queues and leaderboards scannable. */
const PALETTE = ['#4A2A5A', '#7a4f8c', '#B8925A', '#2f6f7a', '#a8654a', '#3f8a6e', '#6f5aa0', '#8e6c8a'];
export function Avatar({ name, size = 36 }: { name?: string | null; size?: number }) {
  const n = (name ?? '؟').trim();
  const parts = n.split(/\s+/);
  const init = (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[1][0] : '');
  let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: PALETTE[Math.abs(h) % PALETTE.length] }}>{init}</span>
  );
}

/** Progress ring (SVG). */
export function Ring({ pct, size = 56, stroke = 6, color = 'var(--color-gold-500)', track = 'var(--color-canvas)', children }: {
  pct: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode;
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  );
}

/** Horizontal stacked bar with a legend. */
export function SegBar({ parts, height = 12, legend = true, dark }: { parts: { label: string; value: number; color: string }[]; height?: number; legend?: boolean; dark?: boolean }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  return (
    <div>
      <div className={clsx('flex overflow-hidden rounded-full', dark ? 'bg-white/10' : 'bg-canvas')} style={{ height }}>
        {parts.filter(p => p.value > 0).map(p => <span key={p.label} title={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
      {legend && <div className={clsx('mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]', dark ? 'text-brand-200' : 'text-muted')}>
        {parts.filter(p => p.value > 0).map(p => <span key={p.label} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: p.color }} />{p.label}
          <b className={clsx('num-cell', dark ? 'text-white' : 'text-ink')}>{Math.round((p.value / total) * 100)}%</b></span>)}
      </div>}
    </div>
  );
}

/** Plum band with the shurfa pattern — each admin page fills it with its own story. */
export function Band({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('shurfa relative mb-5 overflow-hidden rounded-2xl bg-brand-900 p-5 text-white sm:p-6', className)}>
      <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative">{children}</div>
    </div>
  );
}
export function BandStat({ label, value, sub, tone, big }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'gold' | 'neg' | 'pos'; big?: boolean }) {
  return (
    <div>
      <div className="text-xs text-brand-200">{label}</div>
      <div className={clsx('mt-1 font-semibold num-cell', big ? 'font-display text-[26px] leading-tight xl:text-[30px]' : 'text-lg leading-tight xl:text-xl',
        tone === 'gold' && 'text-gold-300', tone === 'neg' && 'text-[#f0b59c]', tone === 'pos' && 'text-[#9fd3b4]')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-brand-200">{sub}</div>}
    </div>
  );
}

/** Twin bars per month (in / out), drawn for the plum band. */
export function FlowBars({ data, inLabel, outLabel }: { data: { label: string; in: number; out: number }[]; inLabel: string; outLabel: string }) {
  const max = Math.max(1, ...data.flatMap(d => [d.in, d.out]));
  return (
    <div>
      <div className="flex h-24 items-end gap-1.5 sm:gap-2.5">
        {data.map(d => <div key={d.label} className="flex flex-1 flex-col items-center gap-1" title={`${d.label}: ${Math.round(d.in)} / ${Math.round(d.out)}`}>
          <div className="flex h-20 w-full items-end justify-center gap-0.5">
            <span className="w-1/2 max-w-3 rounded-t-sm bg-gold-300" style={{ height: `${(d.in / max) * 100}%` }} />
            <span className="w-1/2 max-w-3 rounded-t-sm bg-[#f0b59c]" style={{ height: `${(d.out / max) * 100}%` }} />
          </div>
          <span className="text-[9px] text-brand-300">{d.label}</span>
        </div>)}
      </div>
      <div className="mt-2 flex gap-4 text-[11px] text-brand-200">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-gold-300" />{inLabel}</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[#f0b59c]" />{outLabel}</span>
      </div>
    </div>
  );
}

const MON = ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
/** Last N months as {key 'YYYY-MM', label}. */
export function lastMonths(n: number, from = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(from.getFullYear(), from.getMonth() - (n - 1 - i), 1));
    return { key: d.toISOString().slice(0, 7), label: MON[d.getUTCMonth()] };
  });
}
export const sumBy = <T,>(xs: T[], f: (x: T) => any) => xs.reduce((s, x) => s + num(f(x) ?? 0), 0);
