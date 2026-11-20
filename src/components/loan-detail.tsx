'use client';
import { useEffect, useState } from 'react';
import { Banknote, Check, Download, Printer, X , FileDown } from 'lucide-react';
import { rpc, newKey, supabase } from '@/lib/supabase';
import { q, useData, useParam } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, dateTime, sar, today } from '@/lib/format';
import { frequencyLabels, statusLabels, loanStatus } from '@/lib/labels';
import { PrintBrand } from './report-doc';
import { exportXlsx, n2, printPdf } from '@/lib/export';
import { useSettings } from '@/lib/settings';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, KV, Loading, Modal, MoneyInput, Notice, PageHeader, Select, Stat, Tag, Textarea, isMoney } from './ui';
import { ReasonModal, RepaymentModal, ReverseModal } from './ops';

export function LoanDetail({ admin }: { admin: boolean }) {
  const id = useParam('id');
  const sb = supabase();
  const [approve, setApprove] = useState(false);
  const [reject, setReject] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [disburse, setDisburse] = useState(false);
  const [repay, setRepay] = useState<any>(null);
  const [rev, setRev] = useState<any>(null);
  const d = useData<any>(async () => {
    if (!id) return null;
    const [loan, inst, reps, auto] = await Promise.all([
      q(sb.from('v_loan_summary').select('*').eq('id', id).single()),
      q(sb.from('v_installment_status').select('*').eq('loan_id', id).order('seq')),
      q(sb.from('v_transactions').select('*').eq('loan_id', id).order('tx_date').order('created_at')),
      q(sb.from('loans').select('auto_approved, auto_check').eq('id', id).maybeSingle()).catch(() => null),
    ]);
    return { loan, inst, reps, auto: auto as any };
  }, [id]);

  if (d.error) return <ErrorBox>{d.error}</ErrorBox>;
  if (!id || !d.data) return <Loading />;
  const { loan: l, inst, reps } = d.data!;
  const live = ['disbursed', 'active', 'overdue'].includes(l.status);
  const progress = Number(l.total_repayable) > 0 ? Number(l.amount_repaid) / Number(l.total_repayable) : 0;

  const exportStatement = () => exportXlsx(`كشف-${l.loan_no}`, [
    { name: 'القرض', header: ['البند', 'القيمة'], rows: [['رقم القرض', l.loan_no], ['العضو', l.member_name], ['المبلغ المعتمد', n2(l.approved_amount)],
      ['الرسوم', n2(l.fee_amount)], ['إجمالي المستحق', n2(l.total_repayable)], ['المسدد', n2(l.amount_repaid)], ['المتبقي', n2(l.outstanding)],
      ['تاريخ الصرف', l.disbursed_on], ['الحالة', statusLabels[l.status]?.[0] ?? l.status]] },
    { name: 'جدول السداد', header: ['القسط', 'تاريخ الاستحقاق', 'المبلغ', 'المسدد', 'المتبقي', 'الحالة'],
      rows: (inst as any[]).map(i => [i.seq, i.due_date, n2(i.amount_due), n2(i.amount_paid), n2(i.amount_remaining), statusLabels[i.status]?.[0]]) },
    { name: 'الحركات', header: ['رقم العملية', 'التاريخ', 'النوع', 'المبلغ', 'المرجع', 'معكوسة'],
      rows: (reps as any[]).map(t => [t.tx_no, t.tx_date, t.tx_type, n2(t.amount), t.reference, t.is_reversed ? 'نعم' : '']) },
  ]);

  return (
    <>
      <PageHeader back={admin ? { href: '/admin/loans/', label: 'القروض' } : { href: '/member/loans/', label: 'قروضي' }}
        title={<span className="flex items-center gap-3">قرض {l.loan_no} <Badge status={loanStatus(l.status)} /></span>}
        subtitle={admin ? <a className="hover:text-brand-600" href={`/admin/members/view/?id=${l.member_id}`}>{l.member_name}</a> : l.purpose}
        actions={<>
          {l.disbursement_tx_id && <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportStatement}>Excel</Button>}
          {l.disbursement_tx_id && <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => printPdf(`كشف القرض ${l.loan_no}`)}>PDF</Button>}
          {admin && l.status === 'pending' && <>
            <Button icon={<Check className="size-4" />} onClick={() => setApprove(true)}>اعتماد</Button>
            <Button variant="danger" icon={<X className="size-4" />} onClick={() => setReject(true)}>رفض</Button></>}
          {admin && l.status === 'approved' && <>
            <Button icon={<Banknote className="size-4" />} onClick={() => setDisburse(true)}>صرف القرض</Button>
            <Button variant="danger" onClick={() => setCancel(true)}>إلغاء</Button></>}
          {admin && live && <Button onClick={() => setRepay(l)}>تسجيل سداد</Button>}
          {!admin && l.status === 'pending' && <Button variant="danger" onClick={async () => { await rpc('cancel_my_request', { p_kind: 'loan', p_id: l.id }); d.reload(); }}>إلغاء الطلب</Button>}
        </>} />

      <PrintBrand title={`كشف قرض ${l.loan_no}`} subtitle={l.member_name} />

      {l.disbursement_tx_id ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="إجمالي المستحق" value={sar(l.total_repayable)} hint={Number(l.fee_amount) > 0 ? `يشمل رسوم ${sar(l.fee_amount)}` : 'بدون رسوم'} />
          <Stat label="المسدد" value={sar(l.amount_repaid)} tone="pos" hint={`${Math.round(progress * 100)}٪ من القرض`} />
          <Stat emphasize label="الرصيد المتبقي" value={sar(l.outstanding)} />
          <Stat label="القسط القادم" value={live ? sar(l.next_due_amount) : '—'} hint={live ? date(l.next_due_date) : undefined}
            tone={Number(l.overdue_amount) > 0 ? 'neg' : 'neutral'} />
        </div>
      ) : (
        <Notice>{l.status === 'pending' ? 'الطلب قيد المراجعة من مدير الصندوق.' : l.status === 'approved' ? 'تم اعتماد القرض وهو بانتظار الصرف — لم يُصرف أي مبلغ بعد.' : `حالة الطلب: ${statusLabels[l.status]?.[0]}`}</Notice>
      )}
      {d.data.auto?.auto_approved && <div className="mt-3"><Notice>✓ اعتُمد تلقائياً — صافي رصيد العضو كان يغطي القرض ({sar(d.data.auto.auto_check?.net_before)}) وسيولة الصندوق كافية.</Notice></div>}
      {l.status === 'pending' && d.data.auto?.auto_check?.reasons?.length > 0 && <div className="mt-3 rounded-xl border border-gold-300 bg-gold-100/60 p-3 text-sm">
        <div className="mb-1 font-medium text-gold-700">{admin ? 'لماذا لم يُعتمد تلقائياً؟' : 'طلبك يحتاج موافقة مدير الصندوق لأن:'}</div>
        <ul className="list-inside list-disc space-y-0.5 text-ink-2">{d.data.auto.auto_check.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
        {admin && <div className="mt-1 text-xs text-muted num-cell">صافي رصيد العضو قبل القرض {sar(d.data.auto.auto_check.net_before)} · بعده {sar(d.data.auto.auto_check.net_after)} · السيولة بعد الصرف {sar(d.data.auto.auto_check.liquid_after)} مقابل احتياطي {sar(d.data.auto.auto_check.reserve)}</div>}
      </div>}
      {Number(l.overdue_amount) > 0 && <div className="mt-3"><ErrorBox>يوجد {l.overdue_count} قسط متأخر بإجمالي {sar(l.overdue_amount)}</ErrorBox></div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="تفاصيل القرض" className="lg:col-span-2">
          <KV items={[
            ['المبلغ المطلوب', sar(l.requested_amount)], ['المبلغ المعتمد', l.approved_amount ? sar(l.approved_amount) : '—'],
            ['الغرض', l.purpose], ['المدة المفضلة', `${l.preferred_months} شهر`],
            ['عدد الأقساط', l.installments_count ?? '—'], ['دورية السداد', frequencyLabels[l.frequency] ?? '—'],
            ['تاريخ الطلب', date(l.request_date)], ['تاريخ الصرف', date(l.disbursed_on)],
            ['أول قسط', date(l.first_due_date)], ['تاريخ الإغلاق', date(l.closed_on)],
            ['ملاحظات العضو', l.notes], ['ملاحظة القرار', l.decision_note],
          ]} />
        </Card>
        {l.disbursement_tx_id && <Card title="تقدم السداد">
          <div className="mb-2 flex justify-between text-sm"><span className="text-muted">مسدد</span><span className="num font-semibold">{Math.round(progress * 100)}٪</span></div>
          <div className="h-2.5 rounded-full bg-line"><div className="h-2.5 rounded-full bg-brand-600" style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>
          <div className="mt-4 text-sm text-muted">{l.paid_count} من {l.installments_count} أقساط مسددة</div>
        </Card>}
      </div>

      {inst.length > 0 && <Card className="mt-4" title="جدول السداد" pad={false}>
        <DataTable rows={inst} pageSize={60} columns={[
          { key: 'seq', header: 'القسط', render: r => <span className="num">{r.seq}</span> },
          { key: 'due_date', header: 'تاريخ الاستحقاق', render: r => date(r.due_date) },
          { key: 'amount_due', header: 'المبلغ', align: 'end', render: r => sar(r.amount_due) },
          { key: 'amount_paid', header: 'المسدد', align: 'end', render: r => sar(r.amount_paid) },
          { key: 'amount_remaining', header: 'المتبقي', align: 'end', render: r => Number(r.amount_remaining) > 0 ? sar(r.amount_remaining) : '—' },
          { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
        ]} />
      </Card>}

      {reps.length > 0 && <Card className="mt-4" title="حركات القرض" pad={false}>
        <DataTable rows={reps} columns={[
          { key: 'tx_no', header: 'رقم العملية', render: r => <span className="num text-xs text-muted">{r.tx_no}</span> },
          { key: 'tx_date', header: 'التاريخ', render: r => date(r.tx_date) },
          { key: 'description', header: 'البيان', render: r => <span className="flex items-center gap-1.5">{r.description}{r.is_reversed && <Tag tone="red">معكوسة</Tag>}</span> },
          { key: 'reference', header: 'المرجع', render: r => r.reference ? <span className="num text-xs">{r.reference}</span> : '—' },
          { key: 'amount', header: 'المبلغ', align: 'end', render: r => sar(r.amount) },
          ...(admin ? [{ key: 'act', header: '', render: (r: any) => !r.is_reversed && r.tx_type !== 'reversal' && (
            <button className="no-print text-xs text-neg hover:underline" onClick={() => setRev(r)}>عكس</button>) }] : []),
        ]} />
      </Card>}

      {admin && <>
        <ApproveModal open={approve} loan={l} onClose={() => setApprove(false)} onDone={d.reload} />
        <DisburseModal open={disburse} loan={l} onClose={() => setDisburse(false)} onDone={d.reload} />
        <ReasonModal open={reject} title="رفض طلب القرض" confirmText="رفض" danger onClose={() => setReject(false)}
          onSubmit={async r => { await rpc('reject_loan', { p_loan: l.id, p_note: r }); d.reload(); }} />
        <ReasonModal open={cancel} title="إلغاء القرض المعتمد" confirmText="إلغاء القرض" danger onClose={() => setCancel(false)}
          onSubmit={async r => { await rpc('cancel_loan', { p_loan: l.id, p_note: r }); d.reload(); }} />
        <RepaymentModal loan={repay} onClose={() => setRepay(null)} onDone={d.reload} />
        <ReverseModal tx={rev} onClose={() => setRev(null)} onDone={d.reload} />
      </>}
    </>
  );
}

function ApproveModal({ open, loan, onClose, onDone }: { open: boolean; loan: any; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const { data: s } = useSettings();
  const [f, setF] = useState({ amount: String(loan.requested_amount), n: String(loan.preferred_months), freq: 'monthly', fee: '', first: '', note: '' });
  useEffect(() => {
    if (s && open) setF(x => ({ ...x, fee: x.fee || (Math.round(Number(loan.requested_amount) * Number(s.loan_default_fee_pct)) / 100).toFixed(2) }));
  }, [s, open]); // eslint-disable-line
  const total = Number(f.amount || 0) + Number(f.fee || 0);
  const per = Number(f.n) > 0 ? Math.floor((total / Number(f.n)) * 100) / 100 : 0;
  const submit = async () => {
    const r = await a.run(() => rpc('approve_loan', {
      p_loan: loan.id, p_amount: f.amount, p_installments: Number(f.n), p_frequency: f.freq, p_fee: f.fee || '0', p_first_due: f.first || null, p_note: f.note || null,
    }).then(() => true), 'تم اعتماد القرض');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="اعتماد القرض وتحديد الشروط"
      footer={<><Button onClick={submit} loading={a.busy} disabled={!isMoney(f.amount) || !(Number(f.n) > 0)}>اعتماد</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="المبلغ المعتمد"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="رسوم إدارية" hint={s ? `حسب السياسة: ${s.loan_default_fee_pct}٪` : undefined}><MoneyInput value={f.fee} onChange={v => setF({ ...f, fee: v })} /></Field>
        <Field label="عدد الأقساط"><Input type="number" min={1} max={120} dir="ltr" value={f.n} onChange={e => setF({ ...f, n: e.target.value })} /></Field>
        <Field label="دورية السداد"><Select value={f.freq} onChange={e => setF({ ...f, freq: e.target.value })} options={[{ value: 'monthly', label: 'شهري' }, { value: 'quarterly', label: 'ربع سنوي' }]} /></Field>
        <Field label="تاريخ أول قسط (اختياري)" hint="افتراضياً: بعد فترة واحدة من الصرف" className="col-span-2"><Input type="date" min={today()} value={f.first} onChange={e => setF({ ...f, first: e.target.value })} /></Field>
      </div>
      <Notice>إجمالي المستحق <span className="num font-semibold">{sar(total)}</span> — القسط التقريبي <span className="num font-semibold">{sar(per)}</span></Notice>
      <Field label="ملاحظة"><Textarea value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}

function DisburseModal({ open, loan, onClose, onDone }: { open: boolean; loan: any; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const [key] = useState(newKey);
  const [f, setF] = useState({ date: today(), ref: '' });
  const submit = async () => {
    const r = await a.run(() => rpc('disburse_loan', { p_loan: loan.id, p_date: f.date, p_reference: f.ref || null, p_key: key }), 'تم صرف القرض وإنشاء جدول السداد');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="صرف القرض"
      footer={<><Button onClick={submit} loading={a.busy}>تأكيد الصرف</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <Notice>سيتم صرف <span className="num font-semibold">{sar(loan.approved_amount)}</span> لـ{loan.member_name}، وإنشاء جدول {loan.installments_count} قسط، وقيد: مدين قروض الأعضاء / دائن النقد — في عملية واحدة.</Notice>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاريخ الصرف"><Input type="date" max={today()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="مرجع التحويل"><Input value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
      </div>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
