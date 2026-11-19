'use client';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Flame, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { date, num, sar, today } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { Card, Empty, Loading, PageHeader } from '@/components/ui';
import { Hero } from '@/components/member-hero';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const LEGEND: [string, string][] = [['paid', 'مسدد'], ['partial', 'جزئي'], ['overdue', 'متأخر'], ['waived', 'معفى'], ['upcoming', 'قادم']];

/** Visual state of a month (overdue wins over unpaid/partial once past due). */
function state(r: any): string {
  if (!r) return 'none';
  if (r.status === 'paid' || r.status === 'waived') return r.status;
  if (r.is_overdue || r.status === 'overdue') return 'overdue';
  if (r.status === 'partial') return 'partial';
  return r.due_date > today() ? 'upcoming' : 'unpaid';
}
const tileCls: Record<string, string> = {
  paid: 'border-gold-500 bg-gradient-to-br from-gold-300 to-gold-500 text-brand-900',
  partial: 'border-gold-300 bg-[linear-gradient(135deg,var(--color-gold-300)_50%,var(--color-surface)_50%)] text-ink',
  overdue: 'border-clay/50 bg-clay/10 text-neg',
  unpaid: 'border-gold-300 bg-gold-100/60 text-gold-700',
  waived: 'border-line bg-[repeating-linear-gradient(135deg,var(--color-canvas)_0_6px,var(--color-surface)_6px_12px)] text-muted',
  upcoming: 'border-dashed border-line bg-surface text-muted',
  none: 'border-transparent bg-transparent text-line',
};

export default function MyContributions() {
  const { memberId, fund } = useAuth();
  const sb = supabase();
  const d = useData<any>(async () => {
    const [rows, bal] = await Promise.all([
      q(sb.from('v_contribution_status').select('*').eq('member_id', memberId!).order('period', { ascending: true })),
      q(sb.from('v_member_balances').select('*').eq('member_id', memberId!).single()),
    ]);
    return { rows, bal };
  }, [memberId]);
  const rows: any[] = d.data?.rows ?? [];
  const years = useMemo(() => [...new Set(rows.map(r => String(r.period).slice(0, 4)))].sort().reverse(), [rows]);
  const [year, setYear] = useState<string>('');
  useEffect(() => { if (years.length && !years.includes(year)) setYear(years[0]); }, [years]); // eslint-disable-line
  const [pick, setPick] = useState<any>(null);

  if (!d.data) return <Loading />;
  const b = d.data.bal;
  const byMonth = new Map(rows.filter(r => String(r.period).startsWith(year)).map(r => [Number(String(r.period).slice(5, 7)), r]));
  // current streak of consecutive paid/waived months, counting back from the latest due month
  let streak = 0;
  for (const r of [...rows].reverse()) {
    if (r.due_date > today()) continue;
    if (r.status === 'paid' || r.status === 'waived') streak++; else break;
  }
  const yr = rows.filter(r => String(r.period).startsWith(year));
  const yrPaid = yr.reduce((a, r) => a + num(r.amount_paid), 0), yrDue = yr.filter(r => r.due_date <= today()).reduce((a, r) => a + num(r.amount_due), 0);
  const overdue = num(b.contributions_overdue);

  return (
    <>
      <PageHeader title="اشتراكاتي الشهرية" subtitle={`الاشتراك الإلزامي ${sar(fund?.monthly_contribution)} شهرياً — منفصل عن ودائعك الاختيارية`} />
      <Hero items={[
        { label: 'إجمالي اشتراكاتك', value: sar(b.contributions_total), sub: `${rows.filter(r => r.status === 'paid').length} شهر مسدد` },
        { label: 'هذا العام', value: sar(b.contributions_ytd), tone: 'gold', sub: today().slice(0, 4) },
        overdue > 0
          ? { label: 'المتأخرات', value: sar(overdue), tone: 'neg', sub: `${b.contributions_overdue_months} شهر متأخر` }
          : { label: 'الالتزام', value: 'ملتزم ✓', tone: 'pos', sub: streak ? `${streak} شهر متتالي بدون تأخير` : undefined },
      ]} />

      {!rows.length ? <Card><Empty>لا توجد اشتراكات مستحقة بعد</Empty></Card> : <Card
        title={<span className="flex items-center gap-2"><CalendarCheck className="size-5 text-gold-700" /> تقويم الاشتراكات</span>}
        subtitle={<span className="num-cell">سددت {sar(yrPaid)} من {sar(yrDue)} مستحقة في {year}</span>}
        >
        {years.length > 1 && <div className="no-scrollbar -mt-1 mb-3 flex gap-1.5 overflow-x-auto">{years.map(y => (
          <button key={y} onClick={() => { setYear(y); setPick(null); }} className={clsx('rounded-full px-3 py-1 text-xs num-cell', y === year ? 'bg-brand-600 text-white' : 'bg-canvas text-muted hover:text-ink')}>{y}</button>
        ))}</div>}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {MONTHS.map((m, i) => {
            const r = byMonth.get(i + 1), st = state(r);
            return (
              <button key={m} disabled={!r} onClick={() => setPick(pick?.id === r?.id ? null : r)}
                className={clsx('flex min-h-[84px] flex-col justify-between rounded-xl border p-2.5 text-start transition', tileCls[st],
                  r && 'hover:-translate-y-0.5 hover:shadow-sm', pick && pick.id === r?.id && 'ring-2 ring-brand-500 ring-offset-1')}>
                <span className="text-[13px] font-semibold">{m}</span>
                {r ? <span className="text-[11px] num-cell opacity-90">{st === 'waived' ? 'معفى' : st === 'upcoming' ? date(r.due_date) : sar(r.amount_paid)}</span> : <span className="text-[11px]">—</span>}
              </button>
            );
          })}
        </div>
        {pick && <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-canvas p-3 text-sm sm:grid-cols-4">
          <div><div className="text-[11px] text-muted">المستحق</div><div className="font-medium num-cell">{sar(pick.amount_due)}</div></div>
          <div><div className="text-[11px] text-muted">المسدد</div><div className="font-medium num-cell">{sar(pick.amount_paid)}</div></div>
          <div><div className="text-[11px] text-muted">تاريخ الاستحقاق</div><div className="font-medium">{date(pick.due_date)}</div></div>
          <div><div className="text-[11px] text-muted">آخر دفعة</div><div className="font-medium">{pick.last_paid_on ? date(pick.last_paid_on) : '—'}</div></div>
        </div>}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-muted">
          {LEGEND.map(([k, l]) => <span key={k} className="flex items-center gap-1.5"><span className={clsx('size-3 rounded border', tileCls[k])} />{l}</span>)}
          {streak > 2 && <span className="ms-auto flex items-center gap-1 text-gold-700"><Flame className="size-3.5" /> {streak} شهر متتالي</span>}
        </div>
      </Card>}

      <p className="mt-4 flex items-start gap-2 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" />
        يسجل مدير الصندوق الدفعات بعد استلامها. إذا دفعت ولم تظهر الدفعة، تواصل معه مع مرجع التحويل.</p>
    </>
  );
}
