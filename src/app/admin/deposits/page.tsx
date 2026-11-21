'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { ArrowLeft, Download, Inbox, Plus, Vault } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { date, dateTime, sar } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { Badge, Button, Card, DataTable, PageHeader, Tabs, Tag } from '@/components/ui';
import { ConfirmDepositModal, DepositModal } from '@/components/ops';
import { Avatar, Band, BandStat, FlowBars, lastMonths, SegBar } from '@/components/admin-viz';

export default function DepositsPage() {
  const [tab, setTab] = useState('requests');
  const [rec, setRec] = useState(false);
  const [review, setReview] = useState<any>(null);
  const sb = supabase();
  const d = useData<any>(async () => {
    const [deps, bals, txs] = await Promise.all([
      q(sb.from('member_deposits').select('*, members(full_name, member_no)').order('requested_at', { ascending: false })),
      q(sb.from('v_member_balances').select('*').order('member_no')),
      q(sb.from('v_transactions').select('id, is_reversed, tx_type, tx_date, amount').in('tx_type', ['deposit', 'withdrawal_payment'])),
    ]);
    const reversed = new Set((txs as any[]).filter(t => t.is_reversed).map(t => t.id));
    return { deps: (deps as any[]).map(x => ({ ...x, member_name: x.members?.full_name, member_no: x.members?.member_no, reversed: reversed.has(x.financial_transaction_id) })), bals, txs: (txs as any[]).filter(t => !t.is_reversed && t.tx_type !== 'reversal') };
  });
  const deps = d.data?.deps ?? [];
  const pending = deps.filter((x: any) => x.status === 'requested');
  const bals = (d.data?.bals ?? []) as any[];
  const total = bals.reduce((s, b) => s + Number(b.deposit_balance), 0);
  const pendW = bals.reduce((s, b) => s + Number(b.withdrawals_pending), 0);
  const txs = (d.data?.txs ?? []) as any[];
  const months = lastMonths(12).map(m => ({ label: m.label,
    in: txs.filter(t => t.tx_type === 'deposit' && t.tx_date?.startsWith(m.key)).reduce((a, t) => a + Number(t.amount), 0),
    out: txs.filter(t => t.tx_type === 'withdrawal_payment' && t.tx_date?.startsWith(m.key)).reduce((a, t) => a + Math.abs(Number(t.amount)), 0) }));
  const holders = bals.filter(b => Number(b.deposit_balance) > 0).sort((a, b) => Number(b.deposit_balance) - Number(a.deposit_balance));
  const TOP_C = ['#D6BC8C', '#B8925A', '#9c7bb0', '#7a4f8c', '#c9a6d8'];
  const conc = [...holders.slice(0, 5).map((b, i) => ({ label: b.full_name.split(' ')[0], value: Number(b.deposit_balance), color: TOP_C[i] })),
    { label: 'البقية', value: holders.slice(5).reduce((a, b) => a + Number(b.deposit_balance), 0), color: 'rgba(255,255,255,0.35)' }];
  const maxBal = Math.max(1, ...holders.map(b => Number(b.deposit_balance)));

  const exportAll = () => exportXlsx('الودائع', [
    { name: 'الأرصدة', header: ['رقم العضو', 'العضو', 'إجمالي الإيداعات', 'السحوبات المصروفة', 'الرصيد', 'سحوبات قيد التنفيذ', 'المتاح للسحب'],
      rows: bals.map(b => [b.member_no, b.full_name, n2(b.deposits_total), n2(b.withdrawals_paid), n2(b.deposit_balance), n2(b.withdrawals_pending), n2(b.available_to_withdraw)]) },
    { name: 'الحركات', header: ['التاريخ', 'العضو', 'المبلغ', 'الحالة', 'الطريقة', 'المرجع'],
      rows: deps.map((x: any) => [x.deposited_on ?? x.requested_at?.slice(0, 10), x.member_name, n2(x.amount), x.reversed ? 'معكوس' : x.status, x.method, x.reference]) },
  ]);

  return (
    <>
      <PageHeader title="الودائع الاختيارية" subtitle="إيداعات الأعضاء الإضافية — التزام على الصندوق، وليست دخلاً"
        actions={<>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportAll}>Excel</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setRec(true)}>تسجيل إيداع</Button>
        </>} />
      <Band>
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-gold-300"><Vault className="size-6" /></span>
              <BandStat big label="خزنة الودائع — أمانات الأعضاء" value={sar(total)} tone="gold" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <BandStat label="مودعون" value={holders.length} />
              <BandStat label="بانتظار التأكيد" value={pending.length} sub={sar(pending.reduce((a: number, x: any) => a + Number(x.amount), 0))} />
              <BandStat label="قيد السحب" value={sar(pendW)} tone={pendW > 0 ? 'neg' : undefined} />
            </div>
            {holders.length > 0 && <div><div className="mb-2 text-xs text-brand-200">لمن تعود الودائع؟</div><SegBar dark parts={conc} /></div>}
          </div>
          <div className="lg:border-s lg:border-white/10 lg:ps-6">
            <div className="mb-2 text-xs text-brand-200">حركة الخزنة — آخر 12 شهراً</div>
            <FlowBars data={months} inLabel="إيداعات" outLabel="سحوبات مصروفة" />
          </div>
        </div>
      </Band>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'requests', label: 'طلبات بانتظار التأكيد', count: pending.length },
        { key: 'balances', label: 'أرصدة الأعضاء' }, { key: 'all', label: 'كل الحركات' },
      ]} />
      <Card pad={false}>
        {tab === 'requests' && (pending.length === 0 ? <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted"><Inbox className="size-8 text-gold-500" />لا توجد طلبات إيداع بانتظار التأكيد</div> :
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {pending.map((r: any) => (
              <div key={r.id} className="flex flex-col gap-3 rounded-xl border border-line bg-canvas/40 p-4 transition hover:border-gold-500">
                <div className="flex items-center gap-3"><Avatar name={r.member_name} />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.member_name}</div><div className="text-xs text-muted">{dateTime(r.requested_at)}</div></div>
                  <Tag tone="amber">بانتظار التأكيد</Tag></div>
                <div className="flex items-baseline justify-between"><span className="font-display text-2xl font-semibold text-brand-700 num-cell">{sar(r.amount)}</span><span className="text-xs text-muted">{r.method ?? '—'}</span></div>
                {r.request_note && <p className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-2">«{r.request_note}»</p>}
                <Button className="mt-auto w-full" onClick={() => setReview(r)}>مراجعة وتأكيد الاستلام</Button>
              </div>))}
          </div>)}
        {tab === 'balances' && <DataTable rows={bals} rowKey={r => r.member_id} searchable={r => r.full_name}
          onRowClick={r => (go(`/admin/members/view/?id=${r.member_id}`))} columns={[
          { key: 'full_name', header: 'العضو', render: r => <span className="flex items-center gap-2.5"><Avatar name={r.full_name} size={28} /><span className="min-w-0">
            <span className="block font-medium">{r.full_name}</span>
            <span className="mt-1 block h-1.5 w-28 overflow-hidden rounded-full bg-canvas"><span className="block h-full rounded-full bg-gold-500" style={{ width: `${(Number(r.deposit_balance) / maxBal) * 100}%` }} /></span></span></span> },
          { key: 'deposits_total', header: 'إجمالي الإيداعات', align: 'end', render: r => sar(r.deposits_total) },
          { key: 'withdrawals_paid', header: 'السحوبات المصروفة', align: 'end', render: r => sar(r.withdrawals_paid) },
          { key: 'deposit_balance', header: 'الرصيد', align: 'end', render: r => <span className="font-semibold">{sar(r.deposit_balance)}</span> },
          { key: 'withdrawals_pending', header: 'قيد السحب', align: 'end', render: r => Number(r.withdrawals_pending) ? sar(r.withdrawals_pending) : '—' },
          { key: 'available_to_withdraw', header: 'المتاح', align: 'end', render: r => sar(r.available_to_withdraw) },
        ]} />}
        {tab === 'all' && <DataTable rows={deps} searchable={r => `${r.member_name} ${r.reference ?? ''}`} columns={[
          { key: 'date', header: 'التاريخ', render: r => date(r.deposited_on ?? r.requested_at) },
          { key: 'member_name', header: 'العضو' },
          { key: 'amount', header: 'المبلغ', align: 'end', render: r => sar(r.amount) },
          { key: 'status', header: 'الحالة', render: r => <span className="flex gap-1"><Badge status={r.status} />{r.reversed && <Tag tone="red">معكوس</Tag>}</span> },
          { key: 'method', header: 'الطريقة' },
          { key: 'reference', header: 'المرجع', render: r => r.reference ? <span className="num text-xs">{r.reference}</span> : '—' },
          { key: 'decision_note', header: 'ملاحظة', className: 'max-w-[200px] truncate' },
        ]} />}
      </Card>
      <DepositModal open={rec} onClose={() => setRec(false)} onDone={d.reload} />
      <ConfirmDepositModal deposit={review} onClose={() => setReview(null)} onDone={d.reload} />
    </>
  );
}
