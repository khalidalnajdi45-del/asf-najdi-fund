'use client';
import clsx from 'clsx';
import type { ReactNode } from 'react';

export type HeroItem = { label: string; value: ReactNode; sub?: ReactNode; tone?: 'gold' | 'neg' | 'pos' };

/** Plum identity band used across the member pages (shurfa pattern, gold accents). */
export function Hero({ items, children, className }: { items: HeroItem[]; children?: ReactNode; className?: string }) {
  return (
    <div className={clsx('shurfa relative mb-5 overflow-hidden rounded-2xl bg-brand-900 p-5 text-white sm:p-6', className)}>
      <div className="pointer-events-none absolute -left-20 -top-20 size-64 rounded-full bg-gold-500/10 blur-3xl" />
      <div className={clsx('relative grid gap-5', items.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {items.map((it, i) => (
          <div key={it.label} className={clsx(i > 0 && 'sm:border-s sm:border-white/10 sm:ps-5')}>
            <div className="text-xs text-brand-200">{it.label}</div>
            <div className={clsx('mt-1 font-semibold num-cell', i === 0 ? 'font-display text-3xl' : 'text-2xl',
              it.tone === 'gold' && 'text-gold-300', it.tone === 'neg' && 'text-[#f0b59c]', it.tone === 'pos' && 'text-[#9fd3b4]')}>{it.value}</div>
            {it.sub && <div className="mt-1 text-xs text-brand-200">{it.sub}</div>}
          </div>
        ))}
      </div>
      {children && <div className="relative mt-5">{children}</div>}
    </div>
  );
}

/** Small area chart of a running balance — drawn in gold on the plum band. */
export function Sparkline({ points, height = 56 }: { points: number[]; height?: number }) {
  if (points.length < 2) return null;
  const W = 600, H = height, min = Math.min(0, ...points), max = Math.max(...points), span = max - min || 1;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * W, H - 4 - ((v - min) / span) * (H - 10)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full" style={{ transform: 'scaleX(-1)' }} aria-hidden>
      <defs><linearGradient id="spk" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#B8925A" stopOpacity=".45" /><stop offset="1" stopColor="#B8925A" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#spk)" />
      <path d={line} fill="none" stroke="#D6BC8C" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
