'use client';
import { useEffect, useState } from 'react';
import { rpc, newKey, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, dateTime, sar, today } from '@/lib/format';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Modal, Notice, PageHeader, Tabs } from '@/components/ui';
import { ReasonModal } from '@/components/ops';

export default function WithdrawalsPage() {
  const [tab, setTab] = useState('open');
  const [approve, setApprove] = useState<any>(null);
  const [reject, setReject] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const sb = supabase();
  const d = useData<any[]>(async () => {
    const [ws, bals] = await Promise.all([
      q(sb.from('deposit_withdrawals').select('*, members(full_name, member_no)').order('requested_at', { ascending: false })),
      q(sb.from('v_member_balances').select('member_id, deposit_balance, available_to_withdraw')),
    ]);
    const bm = new Map((bals as any[]).map(b => [b.member_id, b]));
    return (ws as any[]).map(w => ({ ...w, member_name: w.members?.full_name, balance: bm.get(w.member_id)?.deposit_balance }));
  });
  const rows = d.data ?? [];
  const open = rows.filter(r => r.status === 'pending' || r.status === 'approved');

  return (
    <>
      <PageHeader title="طلبات سحب الودائع" subtitle="لا ينخفض رصيد العضو إلا بعد الاعتماد ثم الصرف الفعلي" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'open', label: 'قيد المعالجة', count: open.length }, { key: 'all', label: 'كل الطلبات' }]} />
      <Card pad={false}>
        <DataTable rows={tab === 'open' ? open : rows} loading={d.loading} searchable={r => r.member_name} empty="لا توجد طلبات" columns={[
          { key: 'requested_at', header: 'تاريخ الطلب', render: r => dateTime(r.requested_at) },
          { key: 'member_name', header: 'العضو', render: r => <a className="hover:text-brand-600" href={`/admin/members/view/?id=${r.member_id}`}>{r.member_name}</a> },
          { key: 'amount', header: 'المبلغ', align: 'end', render: r => <span className="font-semibold">{sar(r.amount)}</span> },
          { key: 'balance', header: 'رصيد الودائع الحالي', align: 'end', render: r => sar(r.balance) },
          { key: 'reason', header: 'السبب', className: 'max-w-[200px] truncate' },
          { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
          { key: 'paid_on', header: 'تاريخ الصرف', render: r => date(r.paid_on) },
          { key: 'act', header: '', render: r => (
            <div className="flex gap-1.5">
              {r.status === 'pending' && <Button size="sm" onClick={() => setApprove(r)}>اعتماد</Button>}
              {r.status === 'approved' && <Button size="sm" onClick={() => setPay(r)}>صرف</Button>}
              {(r.status === 'pending' || r.status === 'approved') && <Button size="sm" variant="danger" onClick={() => setReject(r)}>رفض</Button>}
            </div>) },
        ]} />
      </Card>

      <ReasonModal open={!!approve} title="اعتماد طلب السحب" label="ملاحظة (اختياري)" confirmText="اعتماد" required={false}
        onClose={() => setApprove(null)} onSubmit={async note => { await rpc('approve_withdrawal', { p_id: approve.id, p_note: note || null }); d.reload(); }}>
        {approve && <Notice>{approve.member_name} — <span className="num font-semibold">{sar(approve.amount)}</span>. الاعتماد لا يخصم من الرصيد؛ الخصم يتم عند الصرف.</Notice>}
      </ReasonModal>
      <ReasonModal open={!!reject} title="رفض طلب السحب" label="سبب الرفض" confirmText="رفض الطلب" danger
        onClose={() => setReject(null)} onSubmit={async note => { await rpc('reject_withdrawal', { p_id: reject.id, p_note: note }); d.reload(); }} />
      <PayModal w={pay} onClose={() => setPay(null)} onDone={d.reload} />
    </>
  );
}

function PayModal({ w, onClose, onDone }: { w: any; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const [key, setKey] = useState(newKey);
  const [f, setF] = useState({ date: today(), ref: '' });
  useEffect(() => { if (w) { setKey(newKey()); setF({ date: today(), ref: '' }); a.setError(null); } }, [w]); // eslint-disable-line
  const submit = async () => {
    const r = await a.run(() => rpc('pay_withdrawal', { p_id: w.id, p_paid_on: f.date, p_reference: f.ref || null, p_key: key }), 'تم صرف المبلغ وخصمه من رصيد الودائع');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={!!w} onClose={onClose} title="صرف طلب السحب"
      footer={<><Button onClick={submit} loading={a.busy}>تأكيد الصرف</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      {w && <Notice>{w.member_name} — <span className="num font-semibold">{sar(w.amount)}</span></Notice>}
      <p className="text-sm text-muted">أكّد بعد تحويل المبلغ فعلياً للعضو. سيُسجل قيد: مدين ودائع الأعضاء / دائن النقد.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاريخ الصرف"><Input type="date" max={today()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="مرجع التحويل"><Input value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
      </div>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
