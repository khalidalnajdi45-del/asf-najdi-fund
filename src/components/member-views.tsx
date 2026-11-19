'use client';
import { go } from '@/lib/nav';
import { date, dateTime, monthLabel, sar, stripMemberName } from '@/lib/format';
import { frequencyLabels, txTypeLabels, loanStatus } from '@/lib/labels';
import { Badge, DataTable, Tag, type Column } from './ui';

export function ContributionsTable({ rows, loading, onPay }: { rows: any[] | null; loading?: boolean; onPay?: (r: any) => void }) {
  const cols: Column<any>[] = [
    { key: 'period', header: 'الشهر', render: r => monthLabel(r.period) },
    { key: 'due_date', header: 'تاريخ الاستحقاق', render: r => date(r.due_date) },
    { key: 'amount_due', header: 'المستحق', align: 'end', render: r => sar(r.amount_due) },
    { key: 'amount_paid', header: 'المسدد', align: 'end', render: r => sar(r.amount_paid) },
    { key: 'amount_outstanding', header: 'المتبقي', align: 'end', render: r => Number(r.amount_outstanding) > 0 ? sar(r.amount_outstanding) : '—' },
    { key: 'status', header: 'الحالة', render: r => <span className="flex gap-1"><Badge status={r.status} />{r.is_overdue && r.status === 'partial' && <Badge status="overdue" />}</span> },
    { key: 'last_paid_on', header: 'تاريخ الدفع', render: r => date(r.last_paid_on) },
  ];
  if (onPay) cols.push({ key: 'act', header: '', render: r => r.status !== 'paid' && (
    <button onClick={e => { e.stopPropagation(); onPay(r); }} className="text-xs font-medium text-brand-600 hover:underline">تسجيل دفعة</button>) });
  return <DataTable rows={rows} loading={loading} columns={cols} empty="لا توجد اشتراكات مستحقة" />;
}

/** One ledger for voluntary deposits: confirmed deposits and paid withdrawals with running balance */
export function DepositLedger({ deposits, withdrawals, txReversed }: { deposits: any[] | null; withdrawals: any[] | null; txReversed?: Set<string> }) {
  const items = [
    ...(deposits ?? []).map(d => ({ id: 'd' + d.id, date: d.deposited_on ?? d.requested_at?.slice(0, 10), kind: 'deposit', amount: d.amount, status: d.status, ref: d.reference, note: d.request_note ?? d.decision_note, tx: d.financial_transaction_id })),
    ...(withdrawals ?? []).map(w => ({ id: 'w' + w.id, date: w.paid_on ?? w.requested_at?.slice(0, 10), kind: 'withdrawal', amount: w.amount, status: w.status, ref: w.reference, note: w.reason ?? w.decision_note, tx: w.financial_transaction_id })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let bal = 0;
  const rows = items.map(i => {
    const reversed = !!(i.tx && txReversed?.has(i.tx));
    const effective = !reversed && ((i.kind === 'deposit' && i.status === 'confirmed') || (i.kind === 'withdrawal' && i.status === 'paid'));
    if (effective) bal += (i.kind === 'deposit' ? 1 : -1) * Number(i.amount);
    return { ...i, reversed, balance: effective ? bal : null };
  }).reverse();
  return (
    <DataTable rows={rows} empty="لا توجد حركات ودائع" columns={[
      { key: 'date', header: 'التاريخ', render: r => date(r.date) },
      { key: 'kind', header: 'الحركة', render: r => r.kind === 'deposit' ? 'إيداع' : 'سحب' },
      { key: 'amount', header: 'المبلغ', align: 'end', render: r => <span className={r.kind === 'deposit' ? 'text-pos' : 'text-neg'}>{r.kind === 'deposit' ? '+' : '−'}{sar(r.amount)}</span> },
      { key: 'status', header: 'الحالة', render: r => <span className="flex gap-1"><Badge status={r.status} />{r.reversed && <Tag tone="red">معكوسة</Tag>}</span> },
      { key: 'ref', header: 'المرجع', render: r => r.ref ? <span className="num text-xs">{r.ref}</span> : '—' },
      { key: 'balance', header: 'الرصيد بعد الحركة', align: 'end', render: r => r.balance === null ? '—' : sar(r.balance) },
    ]} />
  );
}

export function LoansTable({ rows, loading, hrefBase }: { rows: any[] | null; loading?: boolean; hrefBase: string }) {
  return (
    <DataTable rows={rows} loading={loading} empty="لا توجد قروض" onRowClick={r => (go(`${hrefBase}?id=${r.id}`))} columns={[
      { key: 'loan_no', header: 'رقم القرض', render: r => <span className="num text-xs text-muted">{r.loan_no}</span> },
      { key: 'purpose', header: 'الغرض', className: 'max-w-[200px] truncate' },
      { key: 'request_date', header: 'تاريخ الطلب', render: r => date(r.request_date) },
      { key: 'amount', header: 'المبلغ', align: 'end', render: r => sar(r.approved_amount ?? r.requested_amount) },
      { key: 'plan', header: 'السداد', render: r => r.installments_count ? `${r.installments_count} قسط ${frequencyLabels[r.frequency] ?? ''}` : `${r.preferred_months} شهر (مقترح)` },
      { key: 'outstanding', header: 'المتبقي', align: 'end', render: r => Number(r.outstanding) > 0 ? sar(r.outstanding) : '—' },
      { key: 'next_due_date', header: 'القسط القادم', render: r => ['disbursed', 'active', 'overdue'].includes(r.status) ? date(r.next_due_date) : '—' },
      { key: 'status', header: 'الحالة', render: r => <div className="space-y-1"><Badge status={loanStatus(r.status)} />
        {['disbursed', 'active', 'overdue'].includes(r.status) && Number(r.total_repayable) > 0 &&
          <div className="whitespace-nowrap text-[11px] text-muted num">مسدد {sar(r.amount_repaid ?? 0)} من {sar(r.total_repayable)}</div>}</div> },
    ]} />
  );
}

export function TransactionsTable({ rows, loading, onReverse, showMember }: { rows: any[] | null; loading?: boolean; onReverse?: (r: any) => void; showMember?: boolean }) {
  const cols: Column<any>[] = [
    { key: 'tx_no', header: 'رقم العملية', render: r => <span className="num text-xs text-muted">{r.tx_no}</span> },
    { key: 'tx_date', header: 'التاريخ', render: r => date(r.tx_date) },
    { key: 'tx_type', header: 'النوع', render: r => <span className="flex items-center gap-1.5 whitespace-nowrap">{txTypeLabels[r.tx_type] ?? r.tx_type}{r.is_reversed && <Tag tone="red">معكوسة</Tag>}</span> },
    ...(showMember ? [{ key: 'member_name', header: 'العضو', render: (r: any) => r.member_name ?? '—' }] : []),
    { key: 'description', header: 'الوصف', className: 'max-w-[280px] truncate', render: (r: any) => showMember ? r.description : stripMemberName(r.description, r.member_name) },
    { key: 'reference', header: 'المرجع', render: r => r.reference ? <span className="num text-xs">{r.reference}</span> : '—' },
    { key: 'amount', header: 'المبلغ', align: 'end', render: r => <span className={r.tx_type === 'reversal' ? 'text-neg' : ''}>{sar(r.amount)}</span> },
  ];
  if (onReverse) cols.push({ key: 'act', header: '', render: r => !r.is_reversed && r.tx_type !== 'reversal' && r.tx_type !== 'withdrawal_payment' && (
    <button onClick={e => { e.stopPropagation(); onReverse(r); }} className="text-xs text-neg hover:underline">عكس</button>) });
  return <DataTable rows={rows} loading={loading} columns={cols} searchable={r => `${r.tx_no} ${r.description} ${r.reference ?? ''} ${r.member_name ?? ''}`} empty="لا توجد عمليات" />;
}

export function NotificationList({ rows, onOpen }: { rows: any[] | null; onOpen: (n: any) => void }) {
  if (!rows?.length) return <div className="p-10 text-center text-sm text-muted">لا توجد إشعارات</div>;
  return (
    <ul className="divide-y divide-line">
      {rows.map(n => (
        <li key={n.id} onClick={() => onOpen(n)} className={`flex cursor-pointer gap-3 px-5 py-3.5 hover:bg-brand-50/40 ${n.is_read ? '' : 'bg-brand-50/50'}`}>
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-gold-500'}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className={`text-sm ${n.is_read ? 'text-ink-2' : 'font-semibold'}`}>{n.title}</span>
              <span className="shrink-0 text-xs text-muted">{dateTime(n.created_at)}</span>
            </div>
            {n.body && <p className="mt-0.5 text-[13px] text-muted">{n.body}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
