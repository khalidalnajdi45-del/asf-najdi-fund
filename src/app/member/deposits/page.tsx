'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { ArrowUpFromLine, Plus } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { dateTime, sar } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, DataTable, ErrorBox, PageHeader, Stat } from '@/components/ui';
import { DepositLedger } from '@/components/member-views';

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
  const requests = x ? [
    ...x.deps.filter((r: any) => r.status === 'requested').map((r: any) => ({ ...r, kind: 'deposit' })),
    ...x.wds.filter((r: any) => r.status === 'pending' || r.status === 'approved').map((r: any) => ({ ...r, kind: 'withdrawal' })),
  ] : [];
  const cancel = async (r: any) => {
    setErr(null);
    try { await rpc('cancel_my_request', { p_kind: r.kind, p_id: r.id }); d.reload(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      <PageHeader title="ودائعي الاختيارية" subtitle="مبالغ إضافية تودعها في الصندوق ويحق لك طلب سحبها"
        actions={<>
          <Button variant="secondary" icon={<ArrowUpFromLine className="size-4" />} onClick={() => (go('/member/withdrawals/new/'))}>طلب سحب</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => (go('/member/deposits/new/'))}>طلب إيداع</Button>
        </>} />
      {x && <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat emphasize label="رصيد الودائع" value={sar(x.bal.deposit_balance)} />
        <Stat label="المتاح للسحب" value={sar(x.bal.available_to_withdraw)} tone="brand" />
        <Stat label="إجمالي الإيداعات" value={sar(x.bal.deposits_total)} />
        <Stat label="إجمالي السحوبات" value={sar(x.bal.withdrawals_paid)} />
      </div>}
      <ErrorBox>{err}</ErrorBox>
      {requests.length > 0 && <Card className="mb-4" title="طلبات قيد المعالجة" pad={false}>
        <DataTable rows={requests} rowKey={r => r.kind + r.id} columns={[
          { key: 'kind', header: 'الطلب', render: r => r.kind === 'deposit' ? 'إيداع' : 'سحب' },
          { key: 'requested_at', header: 'التاريخ', render: r => dateTime(r.requested_at) },
          { key: 'amount', header: 'المبلغ', align: 'end', render: r => sar(r.amount) },
          { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
          { key: 'act', header: '', render: r => (r.status === 'requested' || r.status === 'pending') && <button className="text-xs text-neg hover:underline" onClick={() => cancel(r)}>إلغاء</button> },
        ]} />
      </Card>}
      <Card title="سجل الودائع" pad={false}>
        <DepositLedger deposits={x?.deps ?? null} withdrawals={x?.wds ?? null} txReversed={x?.reversed} />
      </Card>
    </>
  );
}
