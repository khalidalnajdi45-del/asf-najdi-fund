'use client';
import { useState } from 'react';
import { Download, Printer , FileDown } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/hooks';
import { date, dateTime, monthLabel, sar, today, stripMemberName } from '@/lib/format';
import { statusLabels, txTypeLabels } from '@/lib/labels';
import { PrintBrand } from './report-doc';
import { exportXlsx, n2, printPdf } from '@/lib/export';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, KV, Loading, Tag } from './ui';

export function Statement({ memberId }: { memberId: string }) {
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const d = useData<any>(() => rpc('member_statement', { p_member: memberId, p_from: from, p_to: to }), [memberId, from, to]);
  const s = d.data;

  const toExcel = () => s && exportXlsx(`كشف-حساب-${s.member.member_no}-${from}-${to}`, [
    { name: 'الملخص', header: ['البند', 'القيمة'], rows: [
      ['العضو', s.member.full_name], ['رقم العضو', s.member.member_no], ['الفترة', `${from} — ${to}`],
      ['إجمالي الاشتراكات (تراكمي)', n2(s.balances.contributions_total)], ['رصيد الودائع', n2(s.balances.deposit_balance)],
      ['القروض القائمة', n2(s.balances.loan_outstanding)], ['اشتراكات متأخرة', n2(s.balances.contributions_overdue)]] },
    { name: 'العمليات', header: ['رقم العملية', 'التاريخ', 'النوع', 'البيان', 'المبلغ', 'المرجع', 'ملاحظة'],
      rows: s.transactions.map((t: any) => [t.tx_no, t.date, txTypeLabels[t.type], stripMemberName(t.description, s.member.full_name), n2(t.amount), t.reference, t.is_reversed ? 'معكوسة' : '']) },
    { name: 'الاشتراكات', header: ['الشهر', 'المستحق', 'المسدد', 'الحالة'],
      rows: s.contributions.map((c: any) => [c.period, n2(c.due), n2(c.paid), statusLabels[c.status]?.[0]]) },
  ]);

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <Field label="من"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="إلى"><Input type="date" value={to} max={today()} onChange={e => setTo(e.target.value)} /></Field>
        <div className="mr-auto flex gap-2">
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={toExcel} disabled={!s}>Excel</Button>
          <Button icon={<FileDown className="size-4" />} onClick={() => printPdf(`كشف حساب ${s?.member.full_name ?? ''}`)} disabled={!s}>تنزيل PDF</Button>
        </div>
      </div>
      <ErrorBox>{d.error}</ErrorBox>
      {d.loading && !s && <Loading />}
      {s && (
        <div data-pdf className="space-y-4">
          <PrintBrand title={`كشف حساب عضو — ${s.member.full_name}`} subtitle={`${from} — ${to}`} />
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs text-muted">{s.fund_name}</div>
                <h2 className="text-lg font-semibold">كشف حساب عضو</h2>
                <div className="text-sm text-muted">{date(from)} — {date(to)} · أُعد في {dateTime(s.generated_at)}</div>
              </div>
              <div className="text-left text-sm">
                <div className="font-semibold">{s.member.full_name}</div>
                <div className="num text-muted">{s.member.member_no}</div>
              </div>
            </div>
            <div className="mt-4">
              <KV items={[
                ['إجمالي الاشتراكات الشهرية (تراكمي)', <span className="num">{sar(s.balances.contributions_total)}</span>],
                ['اشتراكات متأخرة', <span className="num">{sar(s.balances.contributions_overdue)}</span>],
                ['رصيد الودائع الاختيارية', <span className="num">{sar(s.balances.deposit_balance)}</span>],
                ['سحوبات قيد التنفيذ', <span className="num">{sar(s.balances.withdrawals_pending)}</span>],
                ['رصيد القروض القائم', <span className="num">{sar(s.balances.loan_outstanding)}</span>],
                ['رصيد القروض أول الفترة', <span className="num">{sar(s.opening.loans)}</span>],
              ]} />
            </div>
          </Card>
          <Card title="العمليات خلال الفترة" pad={false}>
            <DataTable rows={s.transactions} pageSize={500} rowKey={r => r.tx_no} empty="لا توجد عمليات في هذه الفترة" columns={[
              { key: 'tx_no', header: 'رقم العملية', render: r => <span className="num text-xs text-muted">{r.tx_no}</span> },
              { key: 'date', header: 'التاريخ', render: r => date(r.date) },
              { key: 'type', header: 'النوع', render: r => <span className="flex gap-1.5">{txTypeLabels[r.type]}{r.is_reversed && <Tag tone="red">معكوسة</Tag>}</span> },
              { key: 'description', header: 'البيان', render: (t: any) => stripMemberName(t.description, s.member.full_name) },
              { key: 'amount', header: 'المبلغ', align: 'end', render: r => sar(r.amount) },
            ]} />
          </Card>
          <Card title="الاشتراكات الشهرية خلال الفترة" pad={false}>
            <DataTable rows={s.contributions} pageSize={500} rowKey={r => r.period} columns={[
              { key: 'period', header: 'الشهر', render: r => monthLabel(r.period) },
              { key: 'due', header: 'المستحق', align: 'end', render: r => sar(r.due) },
              { key: 'paid', header: 'المسدد', align: 'end', render: r => sar(r.paid) },
              { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
            ]} />
          </Card>
          {s.loans.length > 0 && <Card title="القروض" pad={false}>
            <DataTable rows={s.loans} rowKey={r => r.loan_no} columns={[
              { key: 'loan_no', header: 'الرقم', render: r => <span className="num">{r.loan_no}</span> },
              { key: 'approved', header: 'المبلغ', align: 'end', render: r => sar(r.approved) },
              { key: 'repaid', header: 'المسدد', align: 'end', render: r => sar(r.repaid) },
              { key: 'outstanding', header: 'المتبقي', align: 'end', render: r => sar(r.outstanding) },
              { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
            ]} />
          </Card>}
          <p className="text-center text-xs text-muted">هذا الكشف صادر آلياً من سجلات الصندوق المحاسبية.</p>
        </div>
      )}
    </div>
  );
}
