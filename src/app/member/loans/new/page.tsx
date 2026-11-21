'use client';
import { go } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { CircleCheck, Clock } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useAction } from '@/lib/action';
import { sar } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { Button, Card, ErrorBox, Field, Input, isMoney, MoneyInput, Notice, PageHeader, Textarea } from '@/components/ui';
import { PlanPicker, blankPlan, planArgs, planReady, type Plan } from '@/components/loan-schedule';

export default function LoanApplication() {
  const a = useAction();
  const { data: s } = useSettings();
  const [f, setF] = useState({ amount: '', purpose: '', notes: '' });
  const [plan, setPlan] = useState<Plan>(blankPlan(12));
  const submit = async () => {
    const id = await a.run(() => rpc<string>('request_loan', { p_amount: f.amount, p_purpose: f.purpose, p_months: plan.mode === 'lump' ? 1 : Number(plan.count), p_notes: f.notes || null, p_mode: plan.mode, p_start: planArgs(plan).p_start }), 'تم إرسال طلب القرض');
    if (id) go(`/member/loans/view/?id=${id}`);
  };
  const [chk, setChk] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => rpc<any>('loan_auto_check', { p_amount: isMoney(f.amount) ? f.amount : '0' }).then(r => alive && setChk(r)).catch(() => alive && setChk(null)), 250);
    return () => { alive = false; clearTimeout(t); };
  }, [f.amount]);
  return (
    <>
      <PageHeader title="طلب قرض" back={{ href: '/member/loans/', label: 'قروضي' }} />
      <Card className="max-w-xl">
        <div className="space-y-4">
          {s && <Notice>{Number(s.loan_default_fee_pct) > 0 ? `رسوم إدارية ${s.loan_default_fee_pct}٪. ` : 'بدون رسوم. '}إذا كان صافي رصيدك يغطي القرض يُعتمد تلقائياً، وإلا يراجعه مدير الصندوق.</Notice>}
          <Field label="المبلغ المطلوب"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
          {chk && <div className="grid grid-cols-2 gap-3 rounded-xl bg-canvas p-3 text-sm">
            <div><div className="text-[11px] text-muted">صافي رصيدك الحالي</div><div className={`font-semibold num-cell ${Number(chk.net_before) < 0 ? 'text-neg' : 'text-brand-700'}`}>{sar(chk.net_before)}</div></div>
            <div><div className="text-[11px] text-muted">أقصى مبلغ بقبول تلقائي</div><div className="font-semibold num-cell text-gold-700">{sar(chk.max_auto)}</div></div>
          </div>}
          {chk?.blocked ? <div className="rounded-xl border border-clay/40 bg-clay/10 px-3 py-2 text-sm text-neg">{chk.blocked}</div>
          : chk && isMoney(f.amount) && (chk.auto
            ? <div className="flex items-center gap-2 rounded-xl border border-pos/30 bg-pos/10 px-3 py-2 text-sm text-pos"><CircleCheck className="size-4" /> طلبك يُعتمد تلقائياً فور الإرسال، ويبقى الصرف من مدير الصندوق</div>
            : <div className="rounded-xl border border-gold-300 bg-gold-100/60 px-3 py-2 text-sm text-gold-700"><div className="flex items-center gap-2 font-medium"><Clock className="size-4" /> طلبك يحتاج موافقة مدير الصندوق</div>
                <ul className="mt-1 list-inside list-disc text-xs text-ink-2">{(chk.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul></div>)}
          <div><div className="mb-2 text-sm font-medium text-ink-2">طريقة السداد</div>
            <PlanPicker value={plan} onChange={setPlan} amount={isMoney(f.amount) ? f.amount : undefined} maxMonths={s?.loan_max_months ?? 24} /></div>
          <Field label="الغرض من القرض"><Input value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })} /></Field>
          <Field label="ملاحظات إضافية"><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
          <ErrorBox>{a.error}</ErrorBox>
          <Button onClick={submit} loading={a.busy} disabled={!isMoney(f.amount) || f.purpose.trim().length < 3 || !!chk?.blocked || !planReady(plan)}>إرسال الطلب</Button>
        </div>
      </Card>
    </>
  );
}
