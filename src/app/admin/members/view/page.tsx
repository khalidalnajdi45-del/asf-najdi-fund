'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { CalendarPlus, FileText, KeyRound, Pencil, PiggyBank } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData, useParam } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, sar } from '@/lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, KV, Loading, Modal, PageHeader, Select, Stat, Tabs, Textarea } from '@/components/ui';
import { ContributionModal, DepositModal, ReverseModal } from '@/components/ops';
import { ContributionsTable, DepositLedger, LoansTable, TransactionsTable } from '@/components/member-views';
import { MemberLoginModal } from '@/components/member-login';

export default function MemberDetails() {
  const id = useParam('id');
  const [tab, setTab] = useState('contributions');
  const [pay, setPay] = useState<any>(null);
  const [dep, setDep] = useState(false);
  const [edit, setEdit] = useState(false);
  const [pwd, setPwd] = useState(false);
  const [rev, setRev] = useState<any>(null);
  const sb = supabase();
  const d = useData<any>(async () => {
    if (!id) return null;
    const [member, bal, contrib, deps, wds, loans, txs] = await Promise.all([
      q(sb.from('members').select('*').eq('id', id).single()),
      q(sb.from('v_member_balances').select('*').eq('member_id', id).single()),
      q(sb.from('v_contribution_status').select('*').eq('member_id', id).order('period', { ascending: false })),
      q(sb.from('member_deposits').select('*').eq('member_id', id)),
      q(sb.from('deposit_withdrawals').select('*').eq('member_id', id)),
      q(sb.from('v_loan_summary').select('*').eq('member_id', id).order('created_at', { ascending: false })),
      q(sb.from('v_transactions').select('*').eq('member_id', id).order('tx_date', { ascending: false }).order('created_at', { ascending: false })),
    ]);
    return { member, bal, contrib, deps, wds, loans, txs };
  }, [id]);

  if (d.error) return <ErrorBox>{d.error}</ErrorBox>;
  if (!id || !d.data) return <Loading />;
  const { member: m, bal: b, contrib, deps, wds, loans, txs } = d.data!;
  const reversed = new Set<string>((txs as any[]).filter(t => t.is_reversed).map(t => t.id));

  return (
    <>
      <PageHeader back={{ href: '/admin/members/', label: 'الأعضاء' }}
        title={<span className="flex items-center gap-3">{m.full_name} <Badge status={m.status} /></span>}
        subtitle={<span className="num">{m.member_no}{m.username ? <> · <span dir="ltr">@{m.username}</span></> : ''}</span>}
        actions={<>
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>تعديل</Button>
          <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setPwd(true)}>{m.user_id ? 'كلمة المرور' : 'إنشاء دخول'}</Button>
          <Button variant="secondary" icon={<FileText className="size-4" />} onClick={() => (go(`/admin/statement/?member=${id}`))}>كشف حساب</Button>
          <Button variant="secondary" icon={<PiggyBank className="size-4" />} onClick={() => setDep(true)} disabled={m.status !== 'active'}>إيداع</Button>
          <Button icon={<CalendarPlus className="size-4" />} onClick={() => setPay({})}>تسجيل اشتراك</Button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="إجمالي الاشتراكات" value={sar(b.contributions_total)} hint={`هذا العام ${sar(b.contributions_ytd)}`} tone="brand" />
        <Stat label="اشتراكات متأخرة" value={sar(b.contributions_overdue)} hint={`${b.contributions_overdue_months} شهر`} tone={Number(b.contributions_overdue) > 0 ? 'neg' : 'neutral'} />
        <Stat label="رصيد الودائع" value={sar(b.deposit_balance)} hint={`المتاح للسحب ${sar(b.available_to_withdraw)}`} />
        <Stat label="سحوبات قيد التنفيذ" value={sar(b.withdrawals_pending)} />
        <Stat label="القروض القائمة" value={sar(b.loan_outstanding)} />
      </div>

      <Card className="mt-4" title="بيانات العضو">
        <KV items={[
          ['اسم المستخدم', m.username ? <span dir="ltr" className="num font-medium">{m.username}</span> : <button className="text-brand-600 underline" onClick={() => setPwd(true)}>لا يوجد — إنشاء دخول</button>],
          ['البريد الشخصي', <span className="num">{m.email && !/@members\.najdi-fund\.app$/.test(m.email) ? m.email : '—'}</span>],
          ['الجوال', <span className="num">{m.phone ?? '—'}</span>], ['تاريخ الانضمام', date(m.join_date)], ['ملاحظات', m.notes]]} />
      </Card>

      <div className="mt-6">
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: 'contributions', label: 'الاشتراكات الشهرية' }, { key: 'deposits', label: 'الودائع' },
          { key: 'loans', label: 'القروض', count: loans.length }, { key: 'tx', label: 'كل العمليات' },
        ]} />
        <Card pad={false}>
          {tab === 'contributions' && <ContributionsTable rows={contrib} onPay={r => setPay(r)} />}
          {tab === 'deposits' && <DepositLedger deposits={deps} withdrawals={wds} txReversed={reversed} />}
          {tab === 'loans' && <LoansTable rows={loans} hrefBase="/admin/loans/view/" />}
          {tab === 'tx' && <TransactionsTable rows={txs} onReverse={setRev} />}
        </Card>
      </div>

      <ContributionModal open={!!pay} onClose={() => setPay(null)} onDone={d.reload} memberId={id}
        period={pay?.period} amount={pay?.amount_outstanding ? String(pay.amount_outstanding) : undefined} />
      <DepositModal open={dep} onClose={() => setDep(false)} onDone={d.reload} memberId={id} />
      <ReverseModal tx={rev} onClose={() => setRev(null)} onDone={d.reload} />
      <EditMember open={edit} member={m} onClose={() => setEdit(false)} onDone={d.reload} />
      <MemberLoginModal open={pwd} member={m} onClose={() => setPwd(false)} onDone={d.reload} />
    </>
  );
}

function EditMember({ open, member, onClose, onDone }: { open: boolean; member: any; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const personal = member.email && !/@members\.najdi-fund\.app$/.test(member.email) ? member.email : '';
  const [f, setF] = useState({ name: member.full_name, phone: member.phone ?? '', notes: member.notes ?? '', status: member.status, email: personal });
  const save = async () => {
    const r = await a.run(async () => {
      await rpc('admin_update_member', { p_member: member.id, p_full_name: f.name, p_phone: f.phone, p_notes: f.notes, p_status: f.status });
      if (f.email.trim() !== personal) await rpc('admin_set_member_email', { p_member: member.id, p_email: f.email.trim() || null });
      return true;
    }, 'تم حفظ التعديلات');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="تعديل بيانات العضو"
      footer={<><Button onClick={save} loading={a.busy}>حفظ</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <Field label="الاسم الكامل"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الجوال"><Input dir="ltr" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="البريد الشخصي" hint="تُرسل عليه التقارير الشهرية والرسائل"><Input type="email" dir="ltr" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="الحالة" hint="التعطيل يوقف الدخول وتوليد الاشتراكات الجديدة">
          <Select value={f.status} onChange={e => setF({ ...f, status: e.target.value })} options={[{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'غير نشط' }]} /></Field>
      </div>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
