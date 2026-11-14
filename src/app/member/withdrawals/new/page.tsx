'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { useAuth } from '@/lib/auth';
import { sar } from '@/lib/format';
import { Button, Card, ErrorBox, Field, isMoney, MoneyInput, Notice, PageHeader, Textarea } from '@/components/ui';

export default function WithdrawalRequest() {
  const { memberId } = useAuth();
  const a = useAction();
  const bal = useData<any>(() => q(supabase().from('v_member_balances').select('*').eq('member_id', memberId!).single()), [memberId]);
  const [f, setF] = useState({ amount: '', reason: '' });
  const avail = Number(bal.data?.available_to_withdraw ?? 0);
  const submit = async () => {
    const r = await a.run(() => rpc('request_withdrawal', { p_amount: f.amount, p_reason: f.reason || null }), 'تم إرسال طلب السحب');
    if (r) go('/member/deposits/');
  };
  return (
    <>
      <PageHeader title="طلب سحب من الودائع" back={{ href: '/member/deposits/', label: 'ودائعي' }} />
      <Card className="max-w-xl">
        <div className="space-y-4">
          <Notice>المتاح للسحب: <span className="num font-semibold">{sar(avail)}</span>. يبقى رصيدك كما هو حتى يعتمد مدير الصندوق الطلب ويصرف المبلغ فعلياً. الاشتراكات الشهرية لا تُسحب من هنا.</Notice>
          <Field label="المبلغ"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
          <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setF({ ...f, amount: String(avail) })} disabled={avail <= 0}>كامل المتاح</Button></div>
          <Field label="سبب السحب (اختياري)"><Textarea value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
          <ErrorBox>{a.error}</ErrorBox>
          <Button onClick={submit} loading={a.busy} disabled={!isMoney(f.amount) || Number(f.amount) > avail}>إرسال الطلب</Button>
        </div>
      </Card>
    </>
  );
}
