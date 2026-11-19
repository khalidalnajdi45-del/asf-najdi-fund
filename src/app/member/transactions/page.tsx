'use client';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CalendarCheck, Gift, HandCoins, RotateCcw, Search, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date, num, sar, stripMemberName, today } from '@/lib/format';
import { txTypeLabels } from '@/lib/labels';
import { Card, Empty, Loading, PageHeader, Tag } from '@/components/ui';
import { Hero } from '@/components/member-hero';

/** From the member's point of view: money they paid in (+ to the fund) vs money they received. */
const PAID_IN = new Set(['contribution_payment', 'deposit', 'loan_repayment']);
const RECEIVED = new Set(['loan_disbursement', 'withdrawal_payment', 'profit_distribution']);
const FILTERS: [string, string, (t: string) => boolean][] = [
  ['all', 'الكل', () => true],
  ['contrib', 'اشتراكات', t => t === 'contribution_payment'],
  ['deposit', 'ودائع', t => ['deposit', 'withdrawal_payment', 'profit_distribution'].includes(t)],
  ['loan', 'قروض', t => t === 'loan_disbursement' || t === 'loan_repayment'],
  ['other', 'أخرى', t => !['contribution_payment', 'deposit', 'withdrawal_payment', 'profit_distribution', 'loan_disbursement', 'loan_repayment'].includes(t)],
];
const ICON: Record<string, React.ReactNode> = {
  contribution_payment: <CalendarCheck className="size-5" />, deposit: <ArrowDownToLine className="size-5" />, withdrawal_payment: <ArrowUpFromLine className="size-5" />,
  loan_disbursement: <HandCoins className="size-5" />, loan_repayment: <Wallet className="size-5" />, profit_distribution: <Gift className="size-5" />, reversal: <RotateCcw className="size-5" />,
};
const monthName = (k: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { month: 'long', year: 'numeric' }).format(new Date(`${k}-01T12:00:00`));

export default function MyTransactions() {
  const { memberId } = useAuth();
  const d = useData<any[]>(() => q(supabase().from('v_transactions').select('*').eq('member_id', memberId!).order('tx_date', { ascending: false }).order('created_at', { ascending: false })), [memberId]);
  const [f, setF] = useState('all');
  const [s, setS] = useState('');
  const rows = d.data ?? [];
  const list = useMemo(() => {
    const test = FILTERS.find(x => x[0] === f)![2];
    const needle = s.trim();
    return rows.filter(r => test(r.tx_type) && (!needle || `${r.tx_no} ${r.description} ${r.reference ?? ''} ${num(r.amount)}`.includes(needle)));
  }, [rows, f, s]);
  if (!d.data) return <Loading />;

  const live = rows.filter(r => !r.is_reversed && r.tx_type !== 'reversal');
  const yr = today().slice(0, 4);
  const paidIn = live.filter(r => PAID_IN.has(r.tx_type)).reduce((a, r) => a + num(r.amount), 0);
  const received = live.filter(r => RECEIVED.has(r.tx_type)).reduce((a, r) => a + num(r.amount), 0);
  const groups = list.reduce((g: Record<string, any[]>, r) => ((g[String(r.tx_date).slice(0, 7)] ??= []).push(r), g), {});

  return (
    <>
      <PageHeader title="عملياتي المالية" subtitle="كل حركة مالية على حسابك، مع رقم العملية للمراجعة" />
      <Hero items={[
        { label: 'دفعت للصندوق', value: sar(paidIn), sub: 'اشتراكات + ودائع + سداد قروض' },
        { label: 'استلمت من الصندوق', value: sar(received), tone: 'gold', sub: 'قروض + سحوبات + أرباح' },
        { label: `عمليات ${yr}`, value: <span className="num-cell">{live.filter(r => String(r.tx_date).startsWith(yr)).length}</span>, sub: `من أصل ${live.length} عملية` },
      ]} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {FILTERS.map(([k, l]) => (
            <button key={k} onClick={() => setF(k)} className={clsx('whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs transition',
              f === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface text-ink-2 hover:border-brand-200')}>{l}</button>
          ))}
        </div>
        <label className="relative ms-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input value={s} onChange={e => setS(e.target.value)} placeholder="بحث برقم العملية أو المرجع"
            className="h-9 w-full rounded-full border border-line bg-surface pe-3 ps-9 text-sm outline-none focus:border-brand-400" />
        </label>
      </div>

      {!list.length ? <Card><Empty>لا توجد عمليات</Empty></Card> :
        <div className="space-y-5">
          {Object.entries(groups).map(([k, items]) => (
            <section key={k}>
              <h3 className="mb-2 flex items-center justify-between px-1 text-xs text-muted"><span className="font-medium">{monthName(k)}</span><span className="num-cell">{items.length} عملية</span></h3>
              <Card pad={false}><ul className="divide-y divide-line">
                {items.map(r => {
                  const inbound = PAID_IN.has(r.tx_type), out = RECEIVED.has(r.tx_type), rev = r.tx_type === 'reversal';
                  return (
                    <li key={r.id} className={clsx('flex items-center gap-3 px-4 py-3', r.is_reversed && 'opacity-60')}>
                      <span className={clsx('flex size-10 shrink-0 items-center justify-center rounded-xl',
                        rev ? 'bg-clay/10 text-neg' : out ? 'bg-gold-100 text-gold-700' : 'bg-brand-50 text-brand-600')}>{ICON[r.tx_type] ?? <Wallet className="size-5" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 font-medium">{txTypeLabels[r.tx_type] ?? r.tx_type}{r.is_reversed && <Tag tone="red">معكوسة</Tag>}</span>
                        <span className="block truncate text-xs text-muted">{stripMemberName(r.description, r.member_name)}</span>
                        <span className="block text-[11px] text-muted"><span className="num-cell">{r.tx_no}</span> · {date(r.tx_date)}{r.reference ? <> · <span className="num-cell">{r.reference}</span></> : null}</span>
                      </span>
                      <span className={clsx('shrink-0 font-semibold num-cell', rev ? 'text-neg' : inbound ? 'text-brand-700' : out ? 'text-pos' : 'text-ink')}>
                        {sar(r.amount)}</span>
                    </li>
                  );
                })}
              </ul></Card>
            </section>
          ))}
        </div>}
    </>
  );
}
