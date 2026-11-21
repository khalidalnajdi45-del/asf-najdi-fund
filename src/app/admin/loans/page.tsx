'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { NewLoanModal } from '@/components/new-loan';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { date, sar } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { statusLabels, loanStatus } from '@/lib/labels';
import { Badge, Button, Card, DataTable, PageHeader, Tabs } from '@/components/ui';
import { RepaymentModal } from '@/components/ops';
import clsx from 'clsx';
import { CalendarClock } from 'lucide-react';
import { today } from '@/lib/format';
import { Avatar, Band, BandStat, Ring, SegBar } from '@/components/admin-viz';

export default function LoansManagement() {
  const [tab, setTab] = useState('active');
  const [repay, setRepay] = useState<any>(null);
  const [add, setAdd] = useState(false);
  const d = useData<any[]>(() => q(supabase().from('v_loan_summary').select('*').in('status', ['disbursed', 'active', 'overdue', 'fully_repaid']).order('disbursed_on', { ascending: false })));
  const t0 = today(), m0 = t0.slice(0, 8) + '01', m1 = new Date(Date.UTC(+t0.slice(0, 4), +t0.slice(5, 7), 0)).toISOString().slice(0, 10);
  const inst = useData<any[]>(async () => {
    const cols = 'id, loan_id, due_date, amount_due, amount_paid, amount_remaining, status';
    const [a, b] = await Promise.all([q(supabase().from('v_installment_status').select(cols).eq('status', 'overdue')),
      q(supabase().from('v_installment_status').select(cols).gte('due_date', m0).lte('due_date', m1))]);
    const seen = new Set<string>(); return [...(a as any[]), ...(b as any[])].filter(x => !seen.has(x.id) && !!seen.add(x.id));
  });
  const rows = d.data ?? [];
  const live = rows.filter(r => ['disbursed', 'active', 'overdue'].includes(r.status));
  const list = tab === 'active' ? live : tab === 'overdue' ? rows.filter(r => r.status === 'overdue') : rows.filter(r => r.status === 'fully_repaid');
  const sum = (xs: any[], k: string) => xs.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const ins = inst.data ?? [];
  const days = (dd: string) => Math.round((Date.parse(t0) - Date.parse(dd)) / 86400000);
  const od = ins.filter(i => i.status === 'overdue');
  const aging = [
    { label: '1–30 يوم', value: od.filter(i => days(i.due_date) <= 30).reduce((a, i) => a + Number(i.amount_remaining), 0), color: '#e8c48a' },
    { label: '31–60 يوم', value: od.filter(i => days(i.due_date) > 30 && days(i.due_date) <= 60).reduce((a, i) => a + Number(i.amount_remaining), 0), color: '#f0a87c' },
    { label: '61–90 يوم', value: od.filter(i => days(i.due_date) > 60 && days(i.due_date) <= 90).reduce((a, i) => a + Number(i.amount_remaining), 0), color: '#e07f62' },
    { label: '+90 يوم', value: od.filter(i => days(i.due_date) > 90).reduce((a, i) => a + Number(i.amount_remaining), 0), color: '#c0504d' },
  ];
  const month = ins.filter(i => i.due_date >= m0 && i.due_date <= m1);
  const mDue = sum(month, 'amount_due'), mPaid = sum(month, 'amount_paid');
  const totRep = sum(live, 'total_repayable'), repaid = sum(live, 'amount_repaid'), overdue = sum(live, 'overdue_amount');

  const exportList = () => exportXlsx('محفظة-القروض', [{
    name: 'القروض', header: ['رقم القرض', 'العضو', 'تاريخ الصرف', 'المبلغ', 'الرسوم', 'المسدد', 'المتبقي', 'متأخرات', 'القسط القادم', 'الحالة'],
    rows: rows.map(r => [r.loan_no, r.member_name, r.disbursed_on, n2(r.approved_amount), n2(r.fee_amount), n2(r.amount_repaid), n2(r.outstanding), n2(r.overdue_amount), r.next_due_date, statusLabels[r.status]?.[0]]),
  }]);

  return (
    <>
      <PageHeader title="إدارة القروض" subtitle="القروض المصروفة وجداول السداد"
        actions={<>
          <Button icon={<Plus className="size-4" />} onClick={() => setAdd(true)}>قرض جديد</Button>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportList}>Excel</Button></>} />
      <NewLoanModal open={add} onClose={() => setAdd(false)} onDone={id => go(`/admin/loans/view/?id=${id}`)} />
      <Band>
        <div className="grid gap-6 lg:grid-cols-[auto_1fr_1fr] lg:items-center">
          <Ring pct={totRep ? (repaid / totRep) * 100 : 0} size={132} stroke={12} color="#D6BC8C" track="rgba(255,255,255,0.12)">
            <span className="flex flex-col items-center text-center leading-tight"><span className="block text-2xl font-semibold num">{totRep ? Math.round((repaid / totRep) * 100) : 0}%</span><span className="text-[10px] text-brand-200">محصّل من المحفظة</span></span>
          </Ring>
          <div className="grid grid-cols-2 gap-4">
            <BandStat big label="الرصيد القائم" value={sar(sum(live, 'outstanding'))} tone="gold" sub={`${live.length} قرض قائم`} />
            <BandStat label="متأخرات" value={sar(overdue)} tone={overdue > 0 ? 'neg' : 'pos'} sub={`${rows.filter(r => r.status === 'overdue').length} قرض متأخر`} />
            <BandStat label="المسدد من القائمة" value={sar(repaid)} />
            <BandStat label="مسددة بالكامل" value={rows.filter(r => r.status === 'fully_repaid').length} sub="قرض" />
          </div>
          <div className="space-y-5 lg:border-s lg:border-white/10 lg:ps-6">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs text-brand-200"><span className="flex items-center gap-1.5"><CalendarClock className="size-3.5" />تحصيل أقساط هذا الشهر</span>
                <span className="num-cell text-white">{sar(mPaid)} / {sar(mDue)}</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gold-300" style={{ width: `${mDue ? Math.min(100, (mPaid / mDue) * 100) : 0}%` }} /></div>
            </div>
            <div><div className="mb-1.5 text-xs text-brand-200">أعمار المتأخرات</div>
              {od.length ? <SegBar dark parts={aging} /> : <div className="text-sm text-[#9fd3b4]">لا توجد أقساط متأخرة ✓</div>}</div>
          </div>
        </div>
      </Band>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'active', label: 'القائمة', count: live.length },
        { key: 'overdue', label: 'المتأخرة', count: rows.filter(r => r.status === 'overdue').length },
        { key: 'repaid', label: 'المسددة' },
      ]} />
      {tab !== 'repaid' ? (list.length === 0 ? <Card><p className="py-8 text-center text-sm text-muted">{d.loading ? 'جاري التحميل…' : 'لا توجد قروض'}</p></Card> :
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...list].sort((a, b) => Number(b.overdue_amount) - Number(a.overdue_amount)).map(r => {
            const pct = Number(r.total_repayable) ? (Number(r.amount_repaid) / Number(r.total_repayable)) * 100 : 0, late = r.status === 'overdue';
            return (
              <div key={r.id} onClick={() => go(`/admin/loans/view/?id=${r.id}`)}
                className={clsx('group relative cursor-pointer overflow-hidden rounded-2xl border bg-surface p-4 transition hover:shadow-md', late ? 'border-clay/50' : 'border-line hover:border-gold-500')}>
                <span className={clsx('absolute inset-y-0 start-0 w-1', late ? 'bg-clay' : 'bg-gold-500')} />
                <div className="flex items-center gap-3"><Avatar name={r.member_name} />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.member_name}</div><div className="text-xs text-muted"><span className="num">{r.loan_no}</span> · {r.purpose ?? 'قرض حسن'}</div></div>
                  <Badge status={loanStatus(r.status)} /></div>
                <div className="mt-4 flex items-center gap-4">
                  <Ring pct={pct} size={64} stroke={7} color={late ? 'var(--color-clay)' : 'var(--color-gold-500)'}><span className="text-xs font-semibold num">{Math.round(pct)}%</span></Ring>
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted">المتبقي</span><span className="text-end font-semibold num-cell">{sar(r.outstanding)}</span>
                    <span className="text-muted">الأقساط</span><span className="text-end num-cell">{r.paid_count}/{r.installments_count}</span>
                    <span className="text-muted">القسط القادم</span><span className="text-end num-cell">{r.next_due_date ? date(r.next_due_date) : '—'}</span>
                    {late && <><span className="text-neg">متأخر</span><span className="text-end font-semibold text-neg num-cell">{sar(r.overdue_amount)}</span></>}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <span className="text-[11px] text-muted">صُرف {date(r.disbursed_on)}</span>
                  <Button size="sm" variant={late ? 'primary' : 'secondary'} onClick={e => { e.stopPropagation(); setRepay(r); }}>تسجيل سداد</Button>
                </div>
              </div>);
          })}
        </div>) : <Card pad={false}>
        <DataTable rows={list} loading={d.loading} searchable={r => `${r.member_name} ${r.loan_no}`}
          onRowClick={r => (go(`/admin/loans/view/?id=${r.id}`))} empty="لا توجد قروض"
          columns={[
            { key: 'loan_no', header: 'الرقم', render: r => <span className="num text-xs text-muted">{r.loan_no}</span> },
            { key: 'member_name', header: 'العضو', render: r => <span className="font-medium">{r.member_name}</span> },
            { key: 'disbursed_on', header: 'الصرف', render: r => date(r.disbursed_on) },
            { key: 'total_repayable', header: 'إجمالي المستحق', align: 'end', render: r => sar(r.total_repayable) },
            { key: 'amount_repaid', header: 'المسدد', align: 'end', render: r => sar(r.amount_repaid) },
            { key: 'outstanding', header: 'المتبقي', align: 'end', render: r => <span className="font-semibold">{sar(r.outstanding)}</span> },
            { key: 'progress', header: 'الأقساط', render: r => <span className="num text-xs">{r.paid_count}/{r.installments_count}</span> },
            { key: 'next_due_date', header: 'القسط القادم', render: r => r.status === 'fully_repaid' ? '—' : date(r.next_due_date) },
            { key: 'status', header: 'الحالة', render: r => <Badge status={loanStatus(r.status)} /> },
            { key: 'act', header: '', render: r => r.status !== 'fully_repaid' && <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); setRepay(r); }}>سداد</Button> },
          ]} />
      </Card>}
      <RepaymentModal loan={repay} onClose={() => setRepay(null)} onDone={d.reload} />
    </>
  );
}
