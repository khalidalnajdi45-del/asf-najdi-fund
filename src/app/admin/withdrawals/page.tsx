'use client';
import { useEffect, useState } from 'react';
import { rpc, newKey, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, dateTime, sar, today } from '@/lib/format';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Modal, Notice, PageHeader, Tabs } from '@/components/ui';
import { ReasonModal } from '@/components/ops';
import clsx from 'clsx';
import { Banknote, CheckCircle2, Clock3, ShieldAlert } from 'lucide-react';
import { Avatar, Band, BandStat, Ring } from '@/components/admin-viz';

export default function WithdrawalsPage() {
  const [tab, setTab] = useState('open');
  const [approve, setApprove] = useState<any>(null);
  const [reject, setReject] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);
  const sb = supabase();
  const liq = useData<any>(() => rpc('liquidity_report'));
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
  const pend = rows.filter(r => r.status === 'pending'), appr = rows.filter(r => r.status === 'approved');
  const recent = rows.filter(r => r.status === 'paid').slice(0, 6);
  const tot = (xs: any[]) => xs.reduce((a, r) => a + Number(r.amount), 0);
  const cash = Number(liq.data?.cash ?? 0), pipeline = tot(open);
  const cover = pipeline > 0 ? Math.min(100, (cash / pipeline) * 100) : 100;

  const Lane = ({ title, icon, tone, items, children }: { title: string; icon: React.ReactNode; tone: string; items: any[]; children: (r: any) => React.ReactNode }) => (
    <div className="flex min-w-0 flex-col rounded-2xl border border-line bg-canvas/50">
      <div className={clsx('flex items-center gap-2 rounded-t-2xl border-b border-line px-4 py-3 text-sm font-semibold', tone)}>
        {icon}{title}<span className="ms-auto rounded-full bg-surface px-2 text-xs num">{items.length}</span>
        <span className="text-xs font-normal text-muted num-cell">{sar(tot(items))}</span></div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        {items.length === 0 ? <div className="py-8 text-center text-xs text-muted">لا شيء هنا</div> : items.map(r => {
          const bal = Number(r.balance ?? 0), share = bal > 0 ? Math.min(100, (Number(r.amount) / bal) * 100) : 100;
          return (
            <div key={r.id} className="rounded-xl border border-line bg-surface p-3.5 shadow-xs">
              <div className="flex items-center gap-2.5"><Avatar name={r.member_name} size={32} />
                <a href={`/admin/members/view/?id=${r.member_id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600">{r.member_name}</a>
                <span className="text-[11px] text-muted">{date(r.paid_on ?? r.requested_at)}</span></div>
              <div className="mt-3 flex items-center gap-3">
                <Ring pct={share} size={46} stroke={5} color={share > 90 ? 'var(--color-clay)' : 'var(--color-gold-500)'}><span className="text-[10px] font-semibold num">{Math.round(share)}%</span></Ring>
                <div className="min-w-0"><div className="font-display text-xl font-semibold num-cell">{sar(r.amount)}</div>
                  <div className="text-[11px] text-muted">من رصيد ودائعه <span className="num-cell">{sar(bal)}</span></div></div>
              </div>
              {r.reason && <p className="mt-2 truncate text-xs text-ink-2">«{r.reason}»</p>}
              {children(r)}
            </div>);
        })}
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title="طلبات سحب الودائع" subtitle="مسار الطلب: اعتماد ← صرف فعلي — لا ينخفض رصيد العضو إلا عند الصرف" />
      <Band>
        <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
          <Ring pct={cover} size={120} stroke={11} color={cover >= 100 ? '#9fd3b4' : '#f0b59c'} track="rgba(255,255,255,0.12)">
            <span className="flex flex-col items-center text-center leading-tight"><span className="block text-xl font-semibold num">{Math.round(cover)}%</span><span className="text-[10px] text-brand-200">تغطية النقد</span></span>
          </Ring>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <BandStat big label="في المسار" value={sar(pipeline)} tone="gold" sub={`${open.length} طلب`} />
            <BandStat label="بانتظار الاعتماد" value={sar(tot(pend))} sub={`${pend.length} طلب`} />
            <BandStat label="معتمد بانتظار الصرف" value={sar(tot(appr))} sub={`${appr.length} طلب`} />
            <BandStat label="النقد المتاح" value={sar(cash)} tone={cash < pipeline ? 'neg' : 'pos'} sub={cash < pipeline ? 'لا يغطي كل الطلبات' : 'يغطي الطلبات'} />
          </div>
        </div>
      </Band>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'open', label: 'لوحة المسار', count: open.length }, { key: 'all', label: 'كل الطلبات' }]} />
      {tab === 'open' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Lane title="بانتظار الاعتماد" icon={<Clock3 className="size-4" />} tone="text-gold-700" items={pend}>
            {r => <div className="mt-3 flex gap-2"><Button size="sm" className="flex-1" onClick={() => setApprove(r)}>اعتماد</Button><Button size="sm" variant="danger" onClick={() => setReject(r)}>رفض</Button></div>}
          </Lane>
          <Lane title="معتمد — بانتظار الصرف" icon={<ShieldAlert className="size-4" />} tone="text-brand-700" items={appr}>
            {r => <div className="mt-3 flex gap-2"><Button size="sm" className="flex-1" icon={<Banknote className="size-4" />} onClick={() => setPay(r)}>صرف</Button><Button size="sm" variant="danger" onClick={() => setReject(r)}>رفض</Button></div>}
          </Lane>
          <Lane title="صُرفت مؤخراً" icon={<CheckCircle2 className="size-4" />} tone="text-pos" items={recent}>{() => null}</Lane>
        </div>
      ) : <Card pad={false}>
        <DataTable rows={rows} loading={d.loading} searchable={r => r.member_name} empty="لا توجد طلبات" columns={[
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
      </Card>}

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
