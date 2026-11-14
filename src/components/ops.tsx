'use client';
import { useEffect, useState } from 'react';
import { rpc, newKey, supabase } from '@/lib/supabase';
import { useAction } from '@/lib/action';
import { firstOfMonth, sar, today } from '@/lib/format';
import { useActiveMembers } from '@/lib/settings';
import { Button, ErrorBox, Field, Input, isMoney, Modal, MoneyInput, Notice, Select, Textarea } from './ui';

type Done = () => void;

export function MemberSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useActiveMembers();
  return <Select value={value} onChange={e => onChange(e.target.value)} placeholder="اختر العضو…"
    options={(data ?? []).map(m => ({ value: m.id, label: `${m.full_name} (${m.member_no})` }))} />;
}

/** Record a monthly contribution payment */
export function ContributionModal({ open, onClose, onDone, memberId, period, amount }: {
  open: boolean; onClose: () => void; onDone: Done; memberId?: string; period?: string; amount?: string;
}) {
  const a = useAction();
  const [key] = useState(newKey);
  const [f, setF] = useState({ member: memberId ?? '', period: (period ?? firstOfMonth()).slice(0, 7), amount: amount ?? '200', paid_on: today(), ref: '' });
  useEffect(() => { if (open) setF(x => ({ ...x, member: memberId ?? x.member, period: (period ?? x.period).slice(0, 7), amount: amount ?? x.amount })); }, [open, memberId, period, amount]);
  const submit = async () => {
    const r = await a.run(() => rpc('record_contribution_payment', {
      p_member: f.member, p_period: `${f.period}-01`, p_amount: f.amount, p_paid_on: f.paid_on, p_reference: f.ref || null, p_key: key,
    }), 'تم تسجيل الاشتراك');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="تسجيل اشتراك شهري"
      footer={<><Button onClick={submit} loading={a.busy} disabled={!f.member || !isMoney(f.amount)}>تسجيل الدفعة</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      {!memberId && <Field label="العضو"><MemberSelect value={f.member} onChange={v => setF({ ...f, member: v })} /></Field>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="شهر الاشتراك"><Input type="month" value={f.period} onChange={e => setF({ ...f, period: e.target.value })} /></Field>
        <Field label="المبلغ"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="تاريخ الدفع"><Input type="date" value={f.paid_on} max={today()} onChange={e => setF({ ...f, paid_on: e.target.value })} /></Field>
        <Field label="المرجع (رقم الحوالة / سداد)"><Input value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
      </div>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}

/** Record a voluntary deposit received directly */
export function DepositModal({ open, onClose, onDone, memberId }: { open: boolean; onClose: () => void; onDone: Done; memberId?: string }) {
  const a = useAction();
  const [key] = useState(newKey);
  const [f, setF] = useState({ member: memberId ?? '', amount: '', date: today(), method: 'تحويل بنكي', ref: '' });
  const submit = async () => {
    const r = await a.run(() => rpc('record_deposit', {
      p_member: memberId ?? f.member, p_amount: f.amount, p_date: f.date, p_method: f.method, p_reference: f.ref || null, p_key: key,
    }), 'تم تسجيل الإيداع');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="تسجيل إيداع اختياري"
      footer={<><Button onClick={submit} loading={a.busy} disabled={!(memberId ?? f.member) || !isMoney(f.amount)}>تسجيل الإيداع</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <Notice>الإيداع الاختياري منفصل تماماً عن الاشتراك الشهري، ويُسجل كالتزام على الصندوق لصالح العضو.</Notice>
      {!memberId && <Field label="العضو"><MemberSelect value={f.member} onChange={v => setF({ ...f, member: v })} /></Field>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="المبلغ"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="تاريخ الاستلام"><Input type="date" value={f.date} max={today()} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="طريقة الإيداع"><Select value={f.method} onChange={e => setF({ ...f, method: e.target.value })} options={['تحويل بنكي', 'نقداً', 'شيك'].map(v => ({ value: v, label: v }))} /></Field>
        <Field label="المرجع"><Input value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
      </div>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}

/** Confirm (or reject) a member-submitted deposit request */
export function ConfirmDepositModal({ deposit, onClose, onDone }: { deposit: any | null; onClose: () => void; onDone: Done }) {
  const a = useAction();
  const [key, setKey] = useState(newKey);
  const [f, setF] = useState({ date: today(), ref: '', note: '' });
  useEffect(() => { if (deposit) { setKey(newKey()); setF({ date: today(), ref: '', note: '' }); a.setError(null); } }, [deposit]); // eslint-disable-line
  const confirm = async () => {
    const r = await a.run(() => rpc('confirm_deposit', { p_deposit: deposit.id, p_date: f.date, p_reference: f.ref || null, p_key: key }), 'تم تأكيد الإيداع');
    if (r) { onDone(); onClose(); }
  };
  const reject = async () => {
    if (!f.note.trim()) { a.setError('يرجى كتابة سبب الرفض'); return; }
    const r = await a.run(() => rpc('reject_deposit', { p_deposit: deposit.id, p_note: f.note }).then(() => true), 'تم رفض الطلب');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={!!deposit} onClose={onClose} title="مراجعة طلب إيداع"
      footer={<><Button onClick={confirm} loading={a.busy}>تأكيد الاستلام</Button><Button variant="danger" onClick={reject} disabled={a.busy}>رفض</Button></>}>
      {deposit && <Notice>{deposit.member_name} — <span className="num font-semibold">{sar(deposit.amount)}</span>{deposit.method ? ` — ${deposit.method}` : ''}{deposit.request_note ? ` — «${deposit.request_note}»` : ''}</Notice>}
      <p className="text-sm text-muted">أكّد فقط بعد التحقق من وصول المبلغ إلى حساب الصندوق.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاريخ الاستلام"><Input type="date" value={f.date} max={today()} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="المرجع"><Input value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
      </div>
      <Field label="سبب الرفض (عند الرفض فقط)"><Textarea value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}

/** Record a loan repayment */
export function RepaymentModal({ loan, onClose, onDone }: { loan: any | null; onClose: () => void; onDone: Done }) {
  const a = useAction();
  const [key, setKey] = useState(newKey);
  const [f, setF] = useState({ amount: '', date: today(), ref: '' });
  useEffect(() => {
    if (loan) { setKey(newKey()); a.setError(null); setF({ amount: String(loan.next_due_amount ?? loan.outstanding ?? ''), date: today(), ref: '' }); }
  }, [loan]); // eslint-disable-line
  const submit = async () => {
    const r = await a.run(() => rpc('record_loan_repayment', { p_loan: loan.id, p_amount: f.amount, p_paid_on: f.date, p_reference: f.ref || null, p_key: key }), 'تم تسجيل السداد');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={!!loan} onClose={onClose} title={`تسجيل سداد — ${loan?.loan_no ?? ''}`}
      footer={<><Button onClick={submit} loading={a.busy} disabled={!isMoney(f.amount)}>تسجيل السداد</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      {loan && <Notice>{loan.member_name} — الرصيد القائم <span className="num font-semibold">{sar(loan.outstanding)}</span></Notice>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="المبلغ" hint="يمكن السداد المبكر حتى كامل الرصيد"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="تاريخ السداد"><Input type="date" value={f.date} max={today()} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      {loan && <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setF({ ...f, amount: String(loan.next_due_amount ?? '') })}>القسط القادم</Button>
        <Button size="sm" variant="secondary" onClick={() => setF({ ...f, amount: String(loan.outstanding) })}>سداد كامل الرصيد</Button>
      </div>}
      <Field label="المرجع"><Input value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}

/** Reverse a posted transaction (corrections never edit/delete) */
export function ReverseModal({ tx, onClose, onDone }: { tx: any | null; onClose: () => void; onDone: Done }) {
  const a = useAction();
  const [reason, setReason] = useState('');
  const [d, setD] = useState(today());
  useEffect(() => { if (tx) { setReason(''); setD(today()); a.setError(null); } }, [tx]); // eslint-disable-line
  const submit = async () => {
    const r = await a.run(() => rpc('reverse_transaction', { p_tx: tx.id, p_reason: reason, p_date: d }), 'تم إنشاء القيد العكسي');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={!!tx} onClose={onClose} title={`عكس العملية ${tx?.tx_no ?? ''}`}
      footer={<><Button variant="danger" onClick={submit} loading={a.busy} disabled={reason.trim().length < 3}>إنشاء قيد عكسي</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <Notice tone="gold">لا تُحذف العمليات المالية ولا تُعدّل. سيُنشأ قيد عكسي مساوٍ ومعاكس، وتبقى العملية الأصلية ظاهرة في السجل مع علامة «معكوسة».</Notice>
      {tx && <p className="text-sm">{tx.description} — <span className="num font-semibold">{sar(tx.amount)}</span></p>}
      <Field label="سبب العكس"><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <Field label="تاريخ القيد العكسي"><Input type="date" value={d} max={today()} onChange={e => setD(e.target.value)} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}

/** Simple reason prompt used for reject / cancel actions */
export function ReasonModal({ open, title, label = 'السبب', confirmText, danger, onClose, onSubmit, required = true, children }: {
  open: boolean; title: string; label?: string; confirmText: string; danger?: boolean; onClose: () => void;
  onSubmit: (reason: string) => Promise<any>; required?: boolean; children?: React.ReactNode;
}) {
  const a = useAction();
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) { setReason(''); a.setError(null); } }, [open]); // eslint-disable-line
  const submit = async () => {
    const r = await a.run(async () => { await onSubmit(reason); return true; });
    if (r) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant={danger ? 'danger' : 'primary'} onClick={submit} loading={a.busy} disabled={required && reason.trim().length < 3}>{confirmText}</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      {children}
      <Field label={label}><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}

/** Upload a supporting document to private storage and register it */
export function DocumentUpload({ entityType, entityId, memberId, onDone }: { entityType: string; entityId: string; memberId?: string | null; onDone: Done }) {
  const a = useAction();
  const upload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { a.setError('الحد الأقصى لحجم الملف 10 ميجابايت'); return; }
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${entityType}/${entityId}/${newKey()}-${safe}`;
    const r = await a.run(async () => {
      const { error } = await supabase().storage.from('documents').upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message);
      await rpc('register_document', { p_path: path, p_name: file.name, p_mime: file.type || null, p_size: file.size,
        p_entity_type: entityType, p_entity_id: entityId, p_member: memberId ?? null });
      return true;
    }, 'تم رفع المستند');
    if (r) onDone();
  };
  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-[13px] text-ink-2 hover:bg-canvas">
        <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
        {a.busy ? 'جارٍ الرفع…' : 'إرفاق مستند داعم (PDF / صورة / Excel)'}
      </label>
      {a.error && <div className="mt-2"><ErrorBox>{a.error}</ErrorBox></div>}
    </div>
  );
}

export function DocumentList({ docs }: { docs: any[] | null }) {
  const open = async (path: string) => {
    const { data, error } = await supabase().storage.from('documents').createSignedUrl(path, 60);
    if (!error && data) window.open(data.signedUrl, '_blank', 'noopener');
  };
  if (!docs?.length) return <p className="text-sm text-muted">لا توجد مستندات مرفقة</p>;
  return (
    <ul className="divide-y divide-line">
      {docs.map(d => (
        <li key={d.id} className="flex items-center justify-between py-2 text-sm">
          <span className="truncate">{d.file_name}</span>
          <button onClick={() => open(d.storage_path)} className="text-xs text-brand-600 hover:underline">فتح</button>
        </li>
      ))}
    </ul>
  );
}
