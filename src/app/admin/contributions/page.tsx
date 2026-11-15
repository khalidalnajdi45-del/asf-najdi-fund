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
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="المستحق" value={sar(due)} hint={`${plain(rows.length)} عضو`} />
            <Stat label="المحصّل" value={sar(paid)} tone="brand" />
            <Stat label="المتبقي" value={sar(due - paid)} tone={due - paid > 0 ? 'neg' : 'neutral'} />
            <Stat label="نسبة التحصيل" value={pct(due ? paid / due : 0)} hint={`${rows.filter(r => r.status === 'paid').length} مسدد بالكامل`} />
          </div>
          <Card pad={false} title={monthLabel(`${month}-01`)}>
            <DataTable rows={list.data} loading={list.loading} searchable={r => `${r.member_name} ${r.member_no}`} empty="لا توجد مستحقات لهذا الشهر — استخدم «توليد المستحقات»"
              columns={[
                { key: 'member_no', header: 'رقم العضو', render: r => <span className="num text-xs text-muted">{r.member_no}</span> },
                { key: 'member_name', header: 'العضو', render: r => <a className="font-medium hover:text-brand-600" href={`/admin/members/view/?id=${r.member_id}`}>{r.member_name}</a> },
                { key: 'due_date', header: 'الاستحقاق', render: r => date(r.due_date) },
                { key: 'amount_due', header: 'المستحق', align: 'end', render: r => sar(r.amount_due) },
                { key: 'amount_paid', header: 'المسدد', align: 'end', render: r => sar(r.amount_paid) },
                { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
                { key: 'last_paid_on', header: 'تاريخ الدفع', render: r => date(r.last_paid_on) },
                { key: 'act', header: '', render: r => r.status === 'waived'
                    ? <Button size="sm" variant="ghost" disabled={wv.busy} onClick={() => waive(r, true)}>إلغاء الإعفاء</Button>
                    : r.status !== 'paid' && <span className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setPay(r)}>تسجيل</Button>
                        {r.status !== 'partial' && <Button size="sm" variant="ghost" disabled={wv.busy} onClick={() => waive(r, false)} title="لا يُطالب العضو بهذا الشهر ولا يظهر متأخراً">إعفاء</Button>}
                      </span> },
              ]} />
          </Card>
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
