'use client';
import clsx from 'clsx';
import { Banknote, Building2, Landmark, LineChart, PieChart, Sparkles } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/hooks';
import { date, dateTime, num, sar, today } from '@/lib/format';
import { marketOpen } from '@/lib/market';
import { categoryLabel, useSettings } from '@/lib/settings';
import { Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';

type H = { symbol: string; name: string; price: string | null; day_change_pct: string | null; price_at: string | null; quantity: string | null; market_value: string | null };
type Item = { id: string; name: string; category: string; provider: string | null; since: string; value: string | null; holdings: H[] };
type R = { mode: 'hidden' | 'names' | 'full'; items: Item[] };

const icons: Record<string, React.ReactNode> = {
  equity: <LineChart className="size-5" />, bank_deposit: <Landmark className="size-5" />, fund: <PieChart className="size-5" />,
  real_estate: <Building2 className="size-5" />, other: <Banknote className="size-5" />,
};
const pctTxt = (p: number) => `${p > 0 ? '+' : ''}${(p * 100).toFixed(2)}%`;
const months = (since: string) => {
  const a = new Date(since), b = new Date(today());
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth());
};
/** Tile colour by day change: deeper green / clay as the move grows (capped at ±3%). */
function tile(p: number | null) {
  if (p === null) return { background: 'var(--color-canvas)', color: 'var(--color-ink)' };
  const k = Math.min(1, Math.abs(p) / 0.03);
  const [r, g, b] = p >= 0 ? [78, 107, 92] : [168, 101, 74];
  return { background: `rgba(${r},${g},${b},${0.12 + k * 0.78})`, color: k > 0.45 ? '#fff' : 'var(--color-ink)' };
}

export default function MemberInvestments() {
  const { data: s } = useSettings();
  const d = useData<R>(() => rpc<R>('member_investments'));
  if (d.error) return <ErrorBox>{d.error}</ErrorBox>;
  if (!d.data) return <Loading />;
  const { mode, items } = d.data;
  const full = mode === 'full';
  const holdings = items.flatMap(i => i.holdings);
  const priced = holdings.filter(h => h.day_change_pct !== null);
  const avg = priced.length ? priced.reduce((a, h) => a + num(h.day_change_pct), 0) / priced.length : null;
  const up = priced.filter(h => num(h.day_change_pct) > 0).length, dn = priced.filter(h => num(h.day_change_pct) < 0).length;
  const lastAt = holdings.map(h => h.price_at).filter(Boolean).sort().pop();
  const open = marketOpen();
  const others = items.filter(i => !i.holdings.length);
  const equities = items.filter(i => i.holdings.length);

  if (mode === 'hidden' || !items.length) return (<><PageHeader title="استثمارات الصندوق" /><Card><Empty>لا توجد استثمارات معروضة حالياً</Empty></Card></>);

  return (
    <>
      <PageHeader title="استثمارات الصندوق" subtitle="وين تشتغل فلوس الصندوق — الأسعار مباشرة من السوق المالية السعودية" />

      {/* hero */}
      <div className="shurfa relative mb-5 overflow-hidden rounded-2xl bg-brand-900 p-5 text-white sm:p-7">
        <div className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full bg-gold-500/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-gold-300"><Sparkles className="size-4" /> محفظة الصندوق</div>
            <div className="mt-2 font-display text-3xl font-semibold sm:text-4xl">{items.length} أوعية استثمارية</div>
            <div className="mt-1 text-sm text-brand-100">{holdings.length ? `${holdings.length} شركة مدرجة` : ''}{holdings.length && others.length ? ' · ' : ''}{others.length ? `${others.length} استثمار ثابت` : ''}</div>
          </div>
          {avg !== null && <div className="text-end">
            <div className="text-xs text-brand-200">أداء الأسهم اليوم</div>
            <div dir="ltr" className={clsx('font-display text-3xl font-semibold num', avg > 0 ? 'text-[#9fd3b4]' : avg < 0 ? 'text-[#f0b59c]' : 'text-white')}>{pctTxt(avg)}</div>
            <div className="mt-1 flex items-center justify-end gap-2 text-xs text-brand-100">
              <span className="num">▲ {up}</span><span className="num">▼ {dn}</span>
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5">
                <span className={clsx('size-1.5 rounded-full', open ? 'animate-pulse bg-[#7fd3a0]' : 'bg-brand-200')} />{open ? 'السوق مفتوح' : 'السوق مغلق'}</span>
            </div>
          </div>}
        </div>
        {/* category chips */}
        <div className="relative mt-5 flex flex-wrap gap-2">
          {Object.entries(items.reduce((m: Record<string, number>, i) => ({ ...m, [i.category]: (m[i.category] ?? 0) + 1 }), {})).map(([c, k]) => (
            <span key={c} className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs">
              <span className="text-gold-300 [&_svg]:size-3.5">{icons[c] ?? icons.other}</span>{categoryLabel(s, c)} <span className="num text-brand-200">{k}</span></span>
          ))}
        </div>
      </div>

      {/* ticker */}
      {priced.length > 2 && <div className="ticker mb-5 overflow-hidden rounded-xl border border-line bg-surface py-2.5" dir="ltr">
        <div className="ticker-track flex w-max gap-8">
          {[...priced, ...priced].map((h, i) => (
            <span key={i} className="flex items-center gap-2 whitespace-nowrap text-sm">
              <span className="font-medium text-ink" dir="rtl">{h.name}</span>
              <span className="num text-muted">{num(h.price).toFixed(2)}</span>
              <span className={clsx('num text-xs', num(h.day_change_pct) > 0 ? 'text-pos' : num(h.day_change_pct) < 0 ? 'text-neg' : 'text-muted')}>{num(h.day_change_pct) > 0 ? '▲' : num(h.day_change_pct) < 0 ? '▼' : '•'} {pctTxt(num(h.day_change_pct))}</span>
            </span>
          ))}
        </div>
      </div>}

      {/* heat map */}
      {equities.map(i => (
        <Card key={i.id} className="mb-5" title={<span className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icons[i.category] ?? icons.other}</span>{i.name}</span>}
          subtitle={`خريطة أداء اليوم · ${i.provider ?? categoryLabel(s, i.category)} · منذ ${date(i.since)}`}
          actions={full && i.value ? <span className="font-semibold num">{sar(i.value)}</span> : undefined}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {i.holdings.map(h => {
              const p = h.day_change_pct === null ? null : num(h.day_change_pct);
              return (
                <div key={h.symbol} className="flex min-h-[104px] flex-col justify-between rounded-xl p-3 transition-transform hover:-translate-y-0.5" style={tile(p)}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold leading-snug">{h.name}</span>
                    <span className="num text-[10px] opacity-70">{h.symbol}</span>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <span className="num text-lg font-semibold">{h.price ? num(h.price).toFixed(2) : '—'}</span>
                    <span dir="ltr" className="num text-xs font-medium">{p === null ? '' : pctTxt(p)}</span>
                  </div>
                  {full && h.quantity && <div className="mt-1 text-[10px] opacity-75 num">{num(h.quantity).toLocaleString('en-US')} سهم</div>}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-muted">
            <span>هبوط</span><span className="h-2 w-24 rounded-full" style={{ background: 'linear-gradient(to right, rgba(78,107,92,.9), rgba(78,107,92,.15), rgba(168,101,74,.15), rgba(168,101,74,.9))' }} /><span>صعود</span>
          </div>
        </Card>
      ))}

      {/* fixed investments */}
      {others.length > 0 && <div className="grid gap-4 sm:grid-cols-2">
        {others.map(i => (
          <div key={i.id} className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5">
            <div className="absolute -left-6 -top-6 size-24 rounded-full bg-gold-100" />
            <div className="relative flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand-600 text-gold-300">{icons[i.category] ?? icons.other}</span>
              <div className="min-w-0"><div className="truncate font-semibold">{i.name}</div>
                <div className="text-xs text-muted">{categoryLabel(s, i.category)}{i.provider ? ` · ${i.provider}` : ''}</div></div>
            </div>
            <div className="relative mt-4 flex items-end justify-between">
              <div><div className="text-[11px] text-muted">يعمل منذ</div><div className="font-medium">{date(i.since)}</div></div>
              <div className="text-end"><div className="font-display text-2xl font-semibold text-brand-700 num">{months(i.since)}</div><div className="text-[11px] text-muted">شهراً</div></div>
            </div>
            {full && i.value && <div className="relative mt-3 border-t border-line pt-3 text-sm">القيمة الحالية <span className="float-left font-semibold num">{sar(i.value)}</span></div>}
          </div>
        ))}
      </div>}

      {lastAt && <p className="mt-5 text-xs text-muted">آخر تحديث للأسعار {dateTime(lastAt)} — تتحدث كل 15 دقيقة أثناء جلسة التداول (الأحد–الخميس 10:00–15:00).</p>}
    </>
  );
}
