'use client';
import { useState } from 'react';
import { CalendarPlus, Download, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, firstOfMonth, monthLabel, pct, plain, sar, today } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { statusLabels } from '@/lib/labels';
import { Badge, Button, Card, DataTable, ErrorBox, Input, PageHeader, Stat, Tabs } from '@/components/ui';
import { ContributionModal } from '@/components/ops';
import { Avatar, Band, BandStat, Ring } from '@/components/admin-viz';

export default function ContributionsPage() {
  const [tab, setTab] = useState('month');
  const [month, setMonth] = useState(firstOfMonth().slice(0, 7));
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const [pay, setPay] = useState<any>(null);
  const gen = useAction();
  const wv = useAction();
  const waive = (r: any, undo: boolean) => wv.run(() => rpc('waive_contribution', { p_id: r.id, p_note: null, p_undo: undo }).then(() => true), undo ? 'تم إلغاء الإعفاء' : 'تم إعفاء الشهر').then(ok => { if (ok) list.reload(); });
  const list = useData<any[]>(() => q(supabase().from('v_contribution_status').select('*').eq('period', `${month}-01`).order('member_no')), [month]);
  const matrix = useData<any[]>(() => (tab === 'year' ? rpc('report_contribution_matrix', { p_year: year }) : Promise.resolve([])), [tab, year]);
  const rows = list.data ?? [];
  const due = rows.reduce((s, r) => s + Number(r.amount_due), 0);
  const paid = rows.reduce((s, r) => s + Number(r.amount_paid), 0);

  const generate = async () => {
    const n = await gen.run(() => rpc<number>('generate_contribution_obligations', {}));
    if (n !== undefined) { list.reload(); }
  };

  const exportMonth = () => exportXlsx(`اشتراكات-${month}`, [{
    name: month, header: ['رقم العضو', 'العضو', 'المستحق', 'المسدد', 'المتبقي', 'الحالة', 'تاريخ الدفع'],
    rows: rows.map(r => [r.member_no, r.member_name, n2(r.amount_due), n2(r.amount_paid), n2(r.amount_outstanding), statusLabels[r.status]?.[0] ?? r.status, r.last_paid_on]),
  }]);
  const exportYear = () => exportXlsx(`مصفوفة-الاشتراكات-${year}`, [{
    name: String(year), header: ['رقم العضو', 'العضو', ...Array.from({ length: 12 }, (_, i) => String(i + 1)), 'المسدد', 'المستحق حتى اليوم'],
    rows: (matrix.data ?? []).map(m => [m.member_no, m.name, ...Array.from({ length: 12 }, (_, i) => m.months[i + 1] ? n2(m.months[i + 1].paid) : null), n2(m.total_paid), n2(m.total_due)]),
  }]);

  return (
    <>
      <PageHeader title="الاشتراكات الشهرية" subtitle="الاشتراك الإلزامي الشهري — يُتتبع منفصلاً تماماً عن الودائع الاختيارية"
        actions={<>
          <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={gen.busy} onClick={generate}>توليد المستحقات</Button>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={tab === 'month' ? exportMonth : exportYear}>Excel</Button>
          <Button icon={<CalendarPlus className="size-4" />} onClick={() => setPay({})}>تسجيل دفعة</Button>
        </>} />
      <ErrorBox>{gen.error}</ErrorBox>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'month', label: 'تحصيل شهري' }, { key: 'year', label: 'المصفوفة السنوية' }]} />

      {tab === 'month' && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="text-sm"><span className="mb-1 block text-[13px] text-muted">الشهر</span>
              <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-44" /></label>
          </div>
          <Band>
            <div className="grid items-center gap-6 lg:grid-cols-[auto_1fr_1fr]">
              <Ring pct={due ? (paid / due) * 100 : 0} size={128} stroke={11} color="#D6BC8C" track="rgba(255,255,255,0.12)">
                <span className="flex flex-col items-center leading-tight"><span className="text-2xl font-semibold num-cell">{due ? Math.round((paid / due) * 100) : 0}%</span><span className="text-[10px] text-brand-200">تحصيل {monthLabel(`${month}-01`)}</span></span>
              </Ring>
              <div className="grid grid-cols-2 gap-4">
                <BandStat big label="المحصّل" value={sar(paid)} tone="gold" sub={`من ${sar(due)}`} />
                <BandStat label="المتبقي" value={sar(due - paid)} tone={due - paid > 0 ? 'neg' : 'pos'} />
                <BandStat label="مسدد بالكامل" value={`${rows.filter(r => r.status === 'paid').length} / ${rows.length}`} />
                <BandStat label="معفى" value={rows.filter(r => r.status === 'waived').length} />
              </div>
              <div className="lg:border-s lg:border-white/10 lg:ps-6">
                <div className="mb-2 text-xs text-brand-200">لم يسددوا بعد</div>
                {rows.filter(r => !['paid', 'waived'].includes(r.status)).length === 0 ? <div className="text-sm text-[#9fd3b4]">الجميع سدد هذا الشهر ✓</div> :
                  <div className="flex flex-wrap gap-2">{rows.filter(r => !['paid', 'waived'].includes(r.status)).map(r => (
                    <button key={r.id} onClick={() => setPay(r)} title={`تسجيل دفعة — ${r.member_name}`} className="flex items-center gap-1.5 rounded-full bg-white/10 py-1 pe-3 ps-1 text-xs hover:bg-white/20">
                      <Avatar name={r.member_name} size={22} />{r.member_name.split(' ')[0]}</button>))}</div>}
              </div>
            </div>
          </Band>
          {list.loading && !list.data ? null : rows.length === 0 ? <Card><p className="py-8 text-center text-sm text-muted">لا توجد مستحقات لهذا الشهر — استخدم «توليد المستحقات»</p></Card> :
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...rows].sort((a, b) => ({ overdue: 0, unpaid: 1, partial: 2, paid: 3, waived: 4 } as any)[a.status] - ({ overdue: 0, unpaid: 1, partial: 2, paid: 3, waived: 4 } as any)[b.status]).map(r => {
              const p = Number(r.amount_due) ? (Number(r.amount_paid) / Number(r.amount_due)) * 100 : 0;
              const tone = r.status === 'paid' ? 'border-t-brand-500' : r.status === 'partial' ? 'border-t-gold-500' : r.status === 'overdue' ? 'border-t-clay' : r.status === 'waived' ? 'border-t-line-strong' : 'border-t-line-strong';
              return (
                <div key={r.id} className={clsx('flex flex-col gap-2.5 rounded-xl border border-t-4 border-line bg-surface p-3.5', tone)}>
                  <div className="flex items-center gap-2.5"><Avatar name={r.member_name} size={32} />
                    <a href={`/admin/members/view/?id=${r.member_id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600">{r.member_name}</a>
                    <Badge status={r.status} /></div>
                  <div className="flex items-baseline justify-between text-sm"><span className="font-semibold num-cell">{sar(r.amount_paid)}</span><span className="text-xs text-muted num-cell">من {sar(r.amount_due)}</span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-canvas"><div className={clsx('h-full rounded-full', r.status === 'paid' ? 'bg-brand-500' : 'bg-gold-500')} style={{ width: `${p}%` }} /></div>
                  <div className="flex items-center justify-between text-[11px] text-muted"><span>{r.last_paid_on ? `دُفع ${date(r.last_paid_on)}` : `يستحق ${date(r.due_date)}`}</span>
                    {r.status === 'waived' ? <button className="text-brand-600 hover:underline" disabled={wv.busy} onClick={() => waive(r, true)}>إلغاء الإعفاء</button>
                      : r.status !== 'paid' && <span className="flex gap-2">
                        {r.status !== 'partial' && <button className="hover:text-ink" disabled={wv.busy} onClick={() => waive(r, false)}>إعفاء</button>}
                        <button className="font-medium text-brand-600 hover:underline" onClick={() => setPay(r)}>تسجيل دفعة</button></span>}
                  </div>
                </div>);
            })}
          </div>}
        </>
      )}

      {tab === 'year' && (
        <>
          <div className="mb-4 flex items-end gap-3">
            <label className="text-sm"><span className="mb-1 block text-[13px] text-muted">السنة</span>
              <Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="w-32" dir="ltr" /></label>
          </div>
          <Card pad={false}>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line bg-canvas/60 text-xs text-muted">
                  <th className="px-3 py-2.5 text-right font-medium">العضو</th>
                  {Array.from({ length: 12 }, (_, i) => <th key={i} className="px-2 py-2.5 text-center font-medium num">{i + 1}</th>)}
                  <th className="px-3 py-2.5 text-left font-medium">المسدد</th>
                </tr></thead>
                <tbody>
                  {(matrix.data ?? []).map(m => (
                    <tr key={m.member_id} className="border-b border-line last:border-0">
                      <td className="whitespace-nowrap px-3 py-2">{m.name}</td>
                      {Array.from({ length: 12 }, (_, i) => {
                        const c = m.months[i + 1];
                        return <td key={i} className="px-1 py-2 text-center">
                          {c ? <span title={`${sar(c.paid)} / ${sar(c.due)}`} className={clsx('inline-block size-5 rounded',
                            c.status === 'paid' && 'bg-brand-500', c.status === 'partial' && 'bg-gold-300', c.status === 'overdue' && 'bg-clay/70', c.status === 'unpaid' && 'bg-line-strong', c.status === 'waived' && 'bg-line')} /> : <span className="text-line-strong">·</span>}
                        </td>;
                      })}
                      <td className="px-3 py-2 text-left num-cell">{sar(m.total_paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-4 border-t border-line px-4 py-3 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-brand-600" />مسدد</span>
              <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-gold-300" />جزئي</span>
              <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-clay/70" />متأخر</span>
              <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-line-strong" />لم يحن موعده</span>
            </div>
          </Card>
        </>
      )}

      <ContributionModal open={!!pay} onClose={() => setPay(null)} onDone={list.reload} memberId={pay?.member_id}
        period={pay?.period ?? `${month}-01`} amount={pay?.amount_outstanding ? String(pay.amount_outstanding) : undefined} />
    </>
  );
}
