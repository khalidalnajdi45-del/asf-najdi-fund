'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Clock, Gift, Plus } from 'lucide-react';
import { go } from '@/lib/nav';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { date, dateTime, num, sar } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { Hero, Sparkline } from '@/components/member-hero';

const monthKey = (d: string) => String(d).slice(0, 7);
const monthName = (k: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { month: 'long', year: 'numeric' }).format(new Date(`${k}-01T12:00:00`));

export default function MyDeposits() {
  const { memberId } = useAuth();
  const sb = supabase();
  const [err, setErr] = useState<string | null>(null);
  const d = useData<any>(async () => {
    const [bal, deps, wds, txs] = await Promise.all([
      q(sb.from('v_member_balances').select('*').eq('member_id', memberId!).single()),
      q(sb.from('member_deposits').select('*').eq('member_id', memberId!)),
      q(sb.from('deposit_withdrawals').select('*').eq('member_id', memberId!)),
      q(sb.from('v_transactions').select('id, is_reversed').eq('member_id', memberId!)),
    ]);
    return { bal, deps, wds, reversed: new Set((txs as any[]).filter(t => t.is_reversed).map(t => t.id)) };
  }, [memberId]);
  const x = d.data;
  if (!x) return <Loading />;

  const requests = [
    ...x.deps.filter((r: any) => r.status === 'requested').map((r: any) => ({ ...r, kind: 'deposit' })),
    ...x.wds.filter((r: any) => r.status === 'pending' || r.status === 'approved').map((r: any) => ({ ...r, kind: 'withdrawal' })),
  ];
  const cancel = async (r: any) => {
    setErr(null);
    try { await rpc('cancel_my_request', { p_kind: r.kind, p_id: r.id }); d.reload(); } catch (e: any) { setErr(e.message); }
  };

  // effective movements, oldest → newest, with running balance
  const moves = [
    ...x.deps.filter((r: any) => r.status === 'confirmed').map((r: any) => ({ id: 'd' + r.id, date: r.deposited_on ?? r.requested_at?.slice(0, 10), kind: r.method === 'توزيع أرباح' ? 'profit' : 'in', amount: num(r.amount), ref: r.reference, note: r.request_note ?? r.decision_note, tx: r.financial_transaction_id })),
    ...x.wds.filter((r: any) => r.status === 'paid').map((r: any) => ({ id: 'w' + r.id, date: r.paid_on ?? r.requested_at?.slice(0, 10), kind: 'out', amount: num(r.amount), ref: r.reference, note: r.reason, tx: r.financial_transaction_id })),
  ].filter(m => !(m.tx && x.reversed.has(m.tx))).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let run = 0;
  const withBal = moves.map(m => ({ ...m, balance: (run += (m.kind === 'out' ? -1 : 1) * m.amount) }));
  const groups = [...withBal].reverse().reduce((g: Record<string, any[]>, m) => ((g[monthKey(m.date)] ??= []).push(m), g), {});
  const profits = moves.filter(m => m.kind === 'profit').reduce((a, m) => a + m.amount, 0);

  return (
    <>
      <PageHeader title="ودائعي الاختيارية" subtitle="مبالغ إضافية تودعها في الصندوق ويحق لك طلب سحبها"
        actions={<>
          <Button variant="secondary" icon={<ArrowUpFromLine className="size-4" />} onClick={() => go('/member/withdrawals/new/')}>طلب سحب</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => go('/member/deposits/new/')}>طلب إيداع</Button>
        </>} />
      <Hero items={[
        { label: 'رصيد ودائعك', value: sar(x.bal.deposit_balance), sub: profits > 0 ? <>منها أرباح موزعة <span className="num-cell">{sar(profits)}</span></> : `${moves.length} حركة` },
        { label: 'المتاح للسحب', value: sar(x.bal.available_to_withdraw), tone: 'gold' },
        { label: 'أودعت / سحبت', value: <span className="text-xl">{sar(x.bal.deposits_total)}</span>, sub: <>سحوبات <span className="num-cell">{sar(x.bal.withdrawals_paid)}</span></> },
      ]}>{withBal.length > 1 && <Sparkline points={[0, ...withBal.map(m => m.balance)]} />}</Hero>

      <ErrorBox>{err}</ErrorBox>
      {requests.length > 0 && <div className="mb-5 space-y-2">
        {requests.map((r: any) => (
          <div key={r.kind + r.id} className="flex items-center justify-between gap-3 rounded-xl border border-gold-300 bg-gold-100/60 px-4 py-3">
            <span className="flex items-center gap-3"><Clock className="size-5 text-gold-700" />
              <span><span className="font-medium">طلب {r.kind === 'deposit' ? 'إيداع' : 'سحب'} <span className="num-cell">{sar(r.amount)}</span></span>
                <span className="block text-xs text-muted">{dateTime(r.requested_at)}</span></span></span>
            <span className="flex items-center gap-3"><Badge status={r.status} />
              {(r.status === 'requested' || r.status === 'pending') && <button className="text-xs text-neg hover:underline" onClick={() => cancel(r)}>إلغاء</button>}</span>
          </div>
        ))}
      </div>}

      {!withBal.length ? <Card><Empty>ما عندك ودائع للحين — تقدر تطلب إيداع من الزر فوق</Empty></Card> :
        <div className="space-y-5">
          {Object.entries(groups).map(([k, items]) => (
            <section key={k}>
              <h3 className="mb-2 px-1 text-xs font-medium text-muted">{monthName(k)}</h3>
              <Card pad={false}><ul className="divide-y divide-line">
                {items.map(m => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={clsx('flex size-10 shrink-0 items-center justify-center rounded-xl',
                      m.kind === 'out' ? 'bg-clay/10 text-neg' : m.kind === 'profit' ? 'bg-gold-100 text-gold-700' : 'bg-brand-50 text-brand-600')}>
                      {m.kind === 'out' ? <ArrowUpFromLine className="size-5" /> : m.kind === 'profit' ? <Gift className="size-5" /> : <ArrowDownToLine className="size-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{m.kind === 'out' ? 'سحب' : m.kind === 'profit' ? 'توزيع أرباح' : 'إيداع'}</span>
                      <span className="block truncate text-xs text-muted">{date(m.date)}{m.kind === 'profit' && m.ref ? ` · ${m.ref}` : m.ref ? ` · ${m.ref}` : ''}</span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className={clsx('block font-semibold num-cell', m.kind === 'out' ? 'text-neg' : 'text-pos')}>{m.kind === 'out' ? '−' : '+'}{sar(m.amount)}</span>
                      <span className="block text-[11px] text-muted num-cell">الرصيد {sar(m.balance)}</span>
                    </span>
                  </li>
                ))}
              </ul></Card>
            </section>
          ))}
        </div>}
    </>
  );
}
