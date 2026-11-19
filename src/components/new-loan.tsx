'use client';
import { useEffect, useState } from 'react';
import { rpc, newKey, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { sar, today } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { ErrorBox, Field, Input, Modal, MoneyInput, Notice, Select, Button, isMoney } from './ui';

/** Manager records a loan for a member directly: approval terms + (optionally) disbursement now. */
export function NewLoanModal({ open, onClose, onDone, memberId }: { open: boolean; onClose: () => void; onDone: (id: string) => void; memberId?: string }) {
  const a = useAction();
  const { data: s } = useSettings();
  const members = useData<any[]>(() => q(supabase().from('members').select('id, member_no, full_name').eq('status', 'active').order('member_no')));
  const blank = () => ({ member: memberId ?? '', amount: '', n: '12', freq: 'monthly', fee: '', feeTouched: false, purpose: '', first: '', disburse: true, date: today(), ref: '' });
  const [f, setF] = useState(blank());
  const [key, setKey] = useState(newKey);
  useEffect(() => { if (open) { setF(blank()); setKey(newKey()); } }, [open]); // eslint-disable-line

  const feeAuto = s && isMoney(f.amount) ? (Math.round(Number(f.amount) * Number(s.loan_default_fee_pct)) / 100).toFixed(2) : '';
  const fee = f.feeTouched ? f.fee : feeAuto;
  const total = Number(f.amount || 0) + Number(fee || 0);
  const per = Number(f.n) > 0 ? Math.floor((total / Number(f.n)) * 100) / 100 : 0;

  const submit = async () => {
    const id = await a.run(() => rpc<string>('admin_create_loan', {
      p_member: f.member, p_amount: f.amount, p_installments: Number(f.n), p_frequency: f.freq, p_purpose: f.purpose || null,
      p_fee: fee || '0', p_first_due: f.first || null, p_disburse: f.disburse, p_disburse_date: f.disburse ? f.date : null,
      p_reference: f.ref || null, p_key: f.disburse ? key : null,
    }), f.disburse ? 'تم تسجيل القرض وصرفه وإنشاء جدول السداد' : 'تم تسجيل القرض واعتماده — بانتظار الصرف');
    if (id) { onDone(String(id)); onClose(); }
  };

  return (
    <Modal open={open} onClose={onClose} title="قرض جديد لعضو"
      footer={<><Button onClick={submit} loading={a.busy} disabled={!f.member || !isMoney(f.amount) || !(Number(f.n) > 0)}>{f.disburse ? 'تسجيل وصرف' : 'تسجيل واعتماد'}</Button>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="العضو" className="col-span-2">
          <Select value={f.member} onChange={e => setF({ ...f, member: e.target.value })}
            options={[{ value: '', label: 'اختر العضو…' }, ...(members.data ?? []).map(m => ({ value: m.id, label: `${m.full_name} (${m.member_no})` }))]} />
        </Field>
        <Field label="مبلغ القرض"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="رسوم إدارية" hint={s ? `حسب السياسة: ${s.loan_default_fee_pct}٪` : undefined}><MoneyInput value={fee} onChange={v => setF({ ...f, fee: v, feeTouched: true })} /></Field>
        <Field label="عدد الأقساط"><Input type="number" min={1} max={120} dir="ltr" value={f.n} onChange={e => setF({ ...f, n: e.target.value })} /></Field>
        <Field label="دورية السداد"><Select value={f.freq} onChange={e => setF({ ...f, freq: e.target.value })} options={[{ value: 'monthly', label: 'شهري' }, { value: 'quarterly', label: 'ربع سنوي' }]} /></Field>
        <Field label="الغرض (اختياري)" className="col-span-2"><Input value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })} placeholder="مثال: سيارة، زواج، دراسة…" /></Field>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={f.disburse} onChange={e => setF({ ...f, disburse: e.target.checked })} />
          صرف القرض الآن (يُخصم من النقد ويُنشأ جدول السداد)
        </label>
        {f.disburse && <>
          <Field label="تاريخ الصرف"><Input type="date" max={today()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="مرجع التحويل (اختياري)"><Input dir="ltr" value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
        </>}
        <Field label="تاريخ أول قسط (اختياري)" hint="افتراضياً: بعد فترة واحدة من الصرف" className="col-span-2"><Input type="date" min={today()} value={f.first} onChange={e => setF({ ...f, first: e.target.value })} /></Field>
      </div>
      <Notice>إجمالي المستحق <span className="num font-semibold">{sar(total)}</span> — القسط التقريبي <span className="num font-semibold">{sar(per)}</span> × {Number(f.n) || 0}</Notice>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
