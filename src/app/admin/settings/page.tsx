'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useAction } from '@/lib/action';
import { useSettings, type Settings } from '@/lib/settings';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Button, Card, ErrorBox, Field, Input, Loading, MoneyInput, Notice, PageHeader, Select, Textarea } from '@/components/ui';

const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export default function SettingsPage() {
  const s = useSettings();
  const { refresh } = useAuth();
  const a = useAction();
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => { if (s.data) setF(structuredClone(s.data)); }, [s.data]);
  if (!f) return <Loading />;
  const set = (patch: Partial<Settings>) => setF({ ...f, ...patch });
  const np = f.notification_prefs ?? {};

  const save = async () => {
    const payload = {
      fund_name: f.fund_name, logo_url: f.logo_url ?? '', monthly_contribution: f.monthly_contribution, contribution_due_day: Number(f.contribution_due_day),
      contribution_start_period: f.contribution_start_period, contribution_treatment: f.contribution_treatment,
      loan_max_amount: f.loan_max_amount, loan_max_months: Number(f.loan_max_months), loan_default_fee_pct: f.loan_default_fee_pct,
      loan_one_active_per_member: f.loan_one_active_per_member, loan_block_if_overdue: f.loan_block_if_overdue, loan_grace_days: Number(f.loan_grace_days),
      withdrawal_notice_days: Number(f.withdrawal_notice_days), withdrawal_min_amount: f.withdrawal_min_amount || '0', allow_negative_cash: f.allow_negative_cash,
      approval_requirements: f.approval_requirements, investment_categories: f.investment_categories.filter(c => c.key && c.label),
      expense_categories: f.expense_categories.filter(Boolean), fiscal_year_start_month: Number(f.fiscal_year_start_month),
      notification_prefs: f.notification_prefs, profit_allocation_policy: f.profit_allocation_policy, demo_mode: f.demo_mode,
    };
    const r = await a.run(() => rpc('update_fund_settings', { p: payload }).then(() => true), 'تم حفظ الإعدادات وتسجيل التغيير في سجل التدقيق');
    if (r) { s.reload(); refresh(); }
  };

  return (
    <>
      <PageHeader title="إعدادات الصندوق" subtitle={`آخر تحديث ${dateTime(f.updated_at)} — كل تغيير في السياسات يُسجل في سجل التدقيق`}
        actions={<Button onClick={save} loading={a.busy}>حفظ الإعدادات</Button>} />
      <ErrorBox>{a.error}</ErrorBox>
      <div className="mt-2 grid gap-4 lg:grid-cols-2">
        <Card title="عام">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="اسم الصندوق" className="sm:col-span-2"><Input value={f.fund_name} onChange={e => set({ fund_name: e.target.value })} /></Field>
            <Field label="رابط الشعار (صورة)" className="sm:col-span-2"><Input dir="ltr" value={f.logo_url ?? ''} onChange={e => set({ logo_url: e.target.value })} placeholder="https://…" /></Field>
            <Field label="العملة"><Input value="ريال سعودي (SAR)" disabled /></Field>
            <Field label="بداية السنة المالية"><Select value={String(f.fiscal_year_start_month)} onChange={e => set({ fiscal_year_start_month: Number(e.target.value) })} options={months.map((m, i) => ({ value: String(i + 1), label: m }))} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-brand-600" checked={f.demo_mode} onChange={e => set({ demo_mode: e.target.checked })} />وضع البيانات التجريبية (يُظهر شريط تنبيه للجميع)</label>
          </div>
        </Card>

        <Card title="الاشتراك الشهري">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="مبلغ الاشتراك الشهري" hint="يُطبق على المستحقات الجديدة فقط — المستحقات السابقة محفوظة بمبالغها"><MoneyInput value={String(f.monthly_contribution)} onChange={v => set({ monthly_contribution: v })} /></Field>
            <Field label="يوم الاستحقاق من كل شهر"><Input type="number" min={1} max={28} dir="ltr" value={f.contribution_due_day} onChange={e => set({ contribution_due_day: Number(e.target.value) })} /></Field>
            <Field label="بداية احتساب الاشتراكات"><Input type="month" value={f.contribution_start_period.slice(0, 7)} onChange={e => set({ contribution_start_period: `${e.target.value}-01` })} /></Field>
            <Field label="المعالجة حسب النظام الأساسي" hint="تُقفل بعد تسجيل أول دفعة">
              <Select value={f.contribution_treatment} onChange={e => set({ contribution_treatment: e.target.value })} options={[
                { value: 'equity_non_refundable', label: 'رأس مال للصندوق (غير قابلة للاسترداد)' },
                { value: 'liability_refundable', label: 'التزام قابل للاسترداد للعضو' }]} /></Field>
          </div>
        </Card>

        <Card title="سياسة القروض">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الحد الأعلى للقرض"><MoneyInput value={String(f.loan_max_amount)} onChange={v => set({ loan_max_amount: v })} /></Field>
            <Field label="أقصى مدة سداد (شهر)"><Input type="number" dir="ltr" value={f.loan_max_months} onChange={e => set({ loan_max_months: Number(e.target.value) })} /></Field>
            <Field label="رسوم إدارية افتراضية (%)" hint="0 = قرض حسن بدون رسوم"><Input dir="ltr" value={f.loan_default_fee_pct} onChange={e => set({ loan_default_fee_pct: e.target.value })} /></Field>
            <Field label="مهلة قبل اعتبار القسط متأخراً (أيام)"><Input type="number" dir="ltr" value={f.loan_grace_days} onChange={e => set({ loan_grace_days: Number(e.target.value) })} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-brand-600" checked={f.loan_one_active_per_member} onChange={e => set({ loan_one_active_per_member: e.target.checked })} />قرض واحد قائم فقط لكل عضو</label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-brand-600" checked={f.loan_block_if_overdue} onChange={e => set({ loan_block_if_overdue: e.target.checked })} />منع طلب القرض عند وجود اشتراكات متأخرة</label>
          </div>
        </Card>

        <Card title="سحب الودائع والسيولة">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="مدة الإشعار قبل الصرف (أيام)"><Input type="number" dir="ltr" value={f.withdrawal_notice_days} onChange={e => set({ withdrawal_notice_days: Number(e.target.value) })} /></Field>
            <Field label="الحد الأدنى لمبلغ السحب"><MoneyInput value={String(f.withdrawal_min_amount)} onChange={v => set({ withdrawal_min_amount: v })} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-brand-600" checked={f.allow_negative_cash} onChange={e => set({ allow_negative_cash: e.target.checked })} />السماح بعمليات تتجاوز النقد المتاح (غير مستحسن)</label>
          </div>
        </Card>

        <Card title="فئات الاستثمار">
          <div className="space-y-2">
            {f.investment_categories.map((c, i) => (
              <div key={i} className="grid grid-cols-[130px_1fr_32px] gap-2">
                <Input dir="ltr" placeholder="key" value={c.key} onChange={e => set({ investment_categories: f.investment_categories.map((x, j) => j === i ? { ...x, key: e.target.value.replace(/[^a-z_]/g, '') } : x) })} />
                <Input value={c.label} onChange={e => set({ investment_categories: f.investment_categories.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                <button className="text-muted hover:text-neg" onClick={() => set({ investment_categories: f.investment_categories.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => set({ investment_categories: [...f.investment_categories, { key: '', label: '' }] })}>فئة</Button>
          </div>
          <div className="mt-4">
            <Field label="فئات المصروفات (سطر لكل فئة)"><Textarea rows={4} value={f.expense_categories.join('\n')} onChange={e => set({ expense_categories: e.target.value.split('\n') })} /></Field>
          </div>
        </Card>

        <Card title="الإشعارات">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="تذكير الاشتراك قبل (يوم)"><Input type="number" dir="ltr" value={np.contribution_reminder_days_before ?? 3} onChange={e => set({ notification_prefs: { ...np, contribution_reminder_days_before: Number(e.target.value) } })} /></Field>
            <Field label="تذكير القسط قبل (يوم)"><Input type="number" dir="ltr" value={np.repayment_reminder_days_before ?? 3} onChange={e => set({ notification_prefs: { ...np, repayment_reminder_days_before: Number(e.target.value) } })} /></Field>
            <Field label="تنبيه استحقاق الاستثمار قبل (يوم)"><Input type="number" dir="ltr" value={np.maturity_notice_days_before ?? 30} onChange={e => set({ notification_prefs: { ...np, maturity_notice_days_before: Number(e.target.value) } })} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {[['email', 'البريد'], ['sms', 'SMS'], ['whatsapp', 'واتساب']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand-600" checked={!!np.channels?.[k]}
                onChange={e => set({ notification_prefs: { ...np, channels: { ...(np.channels ?? {}), in_app: true, [k]: e.target.checked } } })} />{l}</label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">القنوات الخارجية تضيف الرسائل لطابور الإرسال؛ تحتاج ربط مزود (انظر README).</p>
        </Card>

        <Card title="الاعتمادات وتوزيع الأرباح" className="lg:col-span-2">
          <Notice tone="gold">لا يفترض النظام أي توزيع أرباح. سجّل هنا السياسة المعتمدة من الجمعية العمومية عند إقرارها؛ تُحفظ مع سجل تدقيق ويمكن بناء التوزيع عليها لاحقاً.</Notice>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="طريقة توزيع الأرباح">
              <Select value={f.profit_allocation_policy?.method ?? 'none'} onChange={e => set({ profit_allocation_policy: { ...f.profit_allocation_policy, method: e.target.value } })} options={[
                { value: 'none', label: 'لا يوجد توزيع (تُضاف للاحتياطي)' }, { value: 'pro_rata_contributions', label: 'بنسبة الاشتراكات' },
                { value: 'pro_rata_deposits', label: 'بنسبة الودائع' }, { value: 'custom', label: 'حسب قرار الجمعية' }]} /></Field>
            <Field label="ملاحظة / رقم القرار"><Input value={f.profit_allocation_policy?.note ?? ''} onChange={e => set({ profit_allocation_policy: { ...f.profit_allocation_policy, note: e.target.value } })} /></Field>
            <Field label="اعتماد القروض"><Select value={f.approval_requirements?.loan ?? 'manager'} onChange={e => set({ approval_requirements: { ...f.approval_requirements, loan: e.target.value } })} options={[{ value: 'manager', label: 'مدير الصندوق' }]} /></Field>
            <Field label="اعتماد السحوبات"><Select value={f.approval_requirements?.withdrawal ?? 'manager'} onChange={e => set({ approval_requirements: { ...f.approval_requirements, withdrawal: e.target.value } })} options={[{ value: 'manager', label: 'مدير الصندوق' }]} /></Field>
          </div>
        </Card>
      </div>
    </>
  );
}
