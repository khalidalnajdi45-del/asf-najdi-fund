'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useAction } from '@/lib/action';
import { Button, Card, ErrorBox, Field, isMoney, MoneyInput, Notice, PageHeader, Select, Textarea } from '@/components/ui';

export default function DepositRequest() {
  const a = useAction();
  const [f, setF] = useState({ amount: '', method: 'تحويل بنكي', note: '' });
  const submit = async () => {
    const r = await a.run(() => rpc('request_deposit', { p_amount: f.amount, p_method: f.method, p_note: f.note || null }), 'تم إرسال طلب الإيداع');
    if (r) go('/member/deposits/');
  };
  return (
    <>
      <PageHeader title="طلب إيداع اختياري" back={{ href: '/member/deposits/', label: 'ودائعي' }} />
      <Card className="max-w-xl">
        <div className="space-y-4">
          <Notice>حوّل المبلغ لحساب الصندوق ثم أرسل هذا الطلب. لن يُضاف المبلغ لرصيدك إلا بعد تأكيد مدير الصندوق للاستلام. الإيداع منفصل عن اشتراكك الشهري.</Notice>
          <Field label="المبلغ"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
          <Field label="طريقة الإيداع"><Select value={f.method} onChange={e => setF({ ...f, method: e.target.value })} options={['تحويل بنكي', 'نقداً', 'شيك'].map(v => ({ value: v, label: v }))} /></Field>
          <Field label="ملاحظة (مثلاً رقم الحوالة)"><Textarea value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
          <ErrorBox>{a.error}</ErrorBox>
          <Button onClick={submit} loading={a.busy} disabled={!isMoney(f.amount)}>إرسال الطلب</Button>
        </div>
      </Card>
    </>
  );
}
