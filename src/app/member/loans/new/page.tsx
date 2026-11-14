'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useAction } from '@/lib/action';
import { sar } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { Button, Card, ErrorBox, Field, Input, isMoney, MoneyInput, Notice, PageHeader, Textarea } from '@/components/ui';

export default function LoanApplication() {
  const a = useAction();
  const { data: s } = useSettings();
  const [f, setF] = useState({ amount: '', purpose: '', months: '12', notes: '' });
  const submit = async () => {
    const id = await a.run(() => rpc<string>('request_loan', { p_amount: f.amount, p_purpose: f.purpose, p_months: Number(f.months), p_notes: f.notes || null }), 'تم إرسال طلب القرض');
    if (id) go(`/member/loans/view/?id=${id}`);
  };
  const per = isMoney(f.amount) && Number(f.months) > 0 ? Number(f.amount) / Number(f.months) : 0;
  return (
    <>
      <PageHeader title="طلب قرض" back={{ href: '/member/loans/', label: 'قروضي' }} />
      <Card className="max-w-xl">
        <div className="space-y-4">
          {s && <Notice>الحد الأعلى {sar(s.loan_max_amount)} — أقصى مدة {s.loan_max_months} شهراً{Number(s.loan_default_fee_pct) > 0 ? ` — رسوم إدارية ${s.loan_default_fee_pct}٪` : ' — بدون رسوم'}. يحدد مدير الصندوق الشروط النهائية عند الاعتماد.</Notice>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="المبلغ المطلوب"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
            <Field label="مدة السداد المفضلة (شهر)"><Input type="number" min={1} max={s?.loan_max_months ?? 120} dir="ltr" value={f.months} onChange={e => setF({ ...f, months: e.target.value })} /></Field>
          </div>
          {per > 0 && <p className="text-sm text-muted">القسط الشهري التقريبي: <span className="num font-semibold text-ink">{sar(per)}</span></p>}
          <Field label="الغرض من القرض"><Input value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })} /></Field>
          <Field label="ملاحظات إضافية"><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
          <ErrorBox>{a.error}</ErrorBox>
          <Button onClick={submit} loading={a.busy} disabled={!isMoney(f.amount) || f.purpose.trim().length < 3}>إرسال الطلب</Button>
        </div>
      </Card>
    </>
  );
}
