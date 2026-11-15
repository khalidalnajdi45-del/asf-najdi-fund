'use client';
import clsx from 'clsx';
import { Banknote, Building2, Landmark, LineChart, PieChart } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/hooks';
import { date, dateTime, num, sar } from '@/lib/format';
import { marketOpen } from '@/lib/market';
import { categoryLabel, useSettings } from '@/lib/settings';
import { Card, Empty, ErrorBox, Loading, PageHeader, Tag } from '@/components/ui';
import { Chg } from '@/components/portfolio';

type H = { symbol: string; name: string; price: string | null; day_change_pct: string | null; price_at: string | null; quantity: string | null; market_value: string | null };
type Item = { id: string; name: string; category: string; provider: string | null; since: string; value: string | null; holdings: H[] };
type R = { mode: 'hidden' | 'names' | 'full'; items: Item[] };

const icons: Record<string, React.ReactNode> = {
  equity: <LineChart className="size-5" />, bank_deposit: <Landmark className="size-5" />, fund: <PieChart className="size-5" />,
  real_estate: <Building2 className="size-5" />, other: <Banknote className="size-5" />,
};

export default function MemberInvestments() {
  const { data: s } = useSettings();
  const d = useData<R>(() => rpc<R>('member_investments'));
  if (d.error) return <ErrorBox>{d.error}</ErrorBox>;
  if (!d.data) return <Loading />;
  const { mode, items } = d.data;
  const full = mode === 'full';
  const lastAt = items.flatMap(i => i.holdings.map(h => h.price_at)).filter(Boolean).sort().pop();

  return (
    <>
      <PageHeader title="استثمارات الصندوق" subtitle="أين تُستثمر أموال الصندوق — تُعرض الأسعار من السوق مباشرة" />
      {mode === 'hidden' || !items.length ? <Card><Empty>لا توجد استثمارات معروضة حالياً</Empty></Card> : (
        <div className="space-y-4">
          {items.map(i => (
            <Card key={i.id} pad={false}
              title={<span className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icons[i.category] ?? icons.other}</span>{i.name}</span>}
              subtitle={`${categoryLabel(s, i.category)}${i.provider ? ' · ' + i.provider : ''} · منذ ${date(i.since)}`}
              actions={full && i.value ? <span className="font-semibold num">{sar(i.value)}</span> : i.holdings.length ? (marketOpen() ? <Tag tone="green">السوق مفتوح</Tag> : <Tag>السوق مغلق</Tag>) : undefined}>
              {i.holdings.length > 0 && (
                <ul className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-3">
                  {i.holdings.map(h => (
                    <li key={h.symbol} className="-mb-px flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:border-e">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{h.name}</div>
                        <div className="text-xs text-muted num">{h.symbol}{full && h.quantity ? ` · ${num(h.quantity).toLocaleString('en-US')} سهم` : ''}</div>
                      </div>
                      <div className="text-end">
                        <div className={clsx('font-semibold num', !h.price && 'text-muted')}>{h.price ? num(h.price).toFixed(2) : '—'}</div>
                        <Chg p={h.day_change_pct} className="block text-xs" />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
          {lastAt && <p className="text-xs text-muted">آخر تحديث للأسعار {dateTime(lastAt)} — تتحدث كل 15 دقيقة أثناء جلسة التداول (الأحد–الخميس 10:00–15:00).</p>}
        </div>
      )}
    </>
  );
}
