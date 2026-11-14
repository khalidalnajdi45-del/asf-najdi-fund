'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { date, dateTime, sar } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { Badge, Button, Card, DataTable, PageHeader, Stat, Tabs, Tag } from '@/components/ui';
import { ConfirmDepositModal, DepositModal } from '@/components/ops';

export default function DepositsPage() {
  const [tab, setTab] = useState('requests');
  const [rec, setRec] = useState(false);
  const [review, setReview] = useState<any>(null);
  const sb = supabase();
  const d = useData<any>(async () => {
    const [deps, bals, txs] = await Promise.all([
      q(sb.from('member_deposits').select('*, members(full_name, member_no)').order('requested_at', { ascending: false })),
      q(sb.from('v_member_balances').select('*').order('member_no')),
      q(sb.from('v_transactions').select('id, is_reversed').eq('tx_type', 'deposit')),
    ]);
    const reversed = new Set((txs as any[]).filter(t => t.is_reversed).map(t => t.id));
    return { deps: (deps as any[]).map(x => ({ ...x, member_name: x.members?.full_name, member_no: x.members?.member_no, reversed: reversed.has(x.financial_transaction_id) })), bals };
  });
  const deps = d.data?.deps ?? [];
  const pending = deps.filter((x: any) => x.status === 'requested');
  const bals = (d.data?.bals ?? []) as any[];
  const total = bals.reduce((s, b) => s + Number(b.deposit_balance), 0);
  const pendW = bals.reduce((s, b) => s + Number(b.withdrawals_pending), 0);

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
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="إجمالي أرصدة الودائع" value={sar(total)} tone="brand" />
        <Stat label="عدد الأعضاء المودعين" value={bals.filter(b => Number(b.deposit_balance) > 0).length} />
        <Stat label="طلبات إيداع معلقة" value={pending.length} hint={sar(pending.reduce((s: number, x: any) => s + Number(x.amount), 0))} />
        <Stat label="سحوبات قيد التنفيذ" value={sar(pendW)} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'requests', label: 'طلبات بانتظار التأكيد', count: pending.length },
        { key: 'balances', label: 'أرصدة الأعضاء' }, { key: 'all', label: 'كل الحركات' },
      ]} />
      <Card pad={false}>
        {tab === 'requests' && <DataTable rows={pending} loading={d.loading} empty="لا توجد طلبات معلقة" columns={[
          { key: 'requested_at', header: 'تاريخ الطلب', render: r => dateTime(r.requested_at) },
          { key: 'member_name', header: 'العضو' },
          { key: 'amount', header: 'المبلغ', align: 'end', render: r => sar(r.amount) },
          { key: 'method', header: 'الطريقة' },
          { key: 'request_note', header: 'ملاحظة العضو', className: 'max-w-[240px] truncate' },
          { key: 'act', header: '', render: r => <Button size="sm" onClick={() => setReview(r)}>مراجعة</Button> },
        ]} />}
        {tab === 'balances' && <DataTable rows={bals} rowKey={r => r.member_id} searchable={r => r.full_name}
          onRowClick={r => (go(`/admin/members/view/?id=${r.member_id}`))} columns={[
          { key: 'full_name', header: 'العضو' },
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
