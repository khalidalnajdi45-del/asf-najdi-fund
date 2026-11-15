'use client';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { FAMILY_PHRASES, firstName, greeting } from '@/components/welcome';
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

        <PhrasesCard initial={f.welcome_phrases} onSaved={() => { s.reload(); refresh(); }} />
        <InvestmentsViewCard mode={f.member_investments_view} onSaved={s.reload} />

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

function PhrasesCard({ initial, onSaved }: { initial: string[] | undefined; onSaved: () => void }) {
  const a = useAction();
  const { profile } = useAuth();
  const [list, setList] = useState<string[]>(() => (initial?.length ? [...initial] : [...FAMILY_PHRASES]));
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState(0);
  const clean = list.map(x => x.trim()).filter(Boolean);
  const dirty = JSON.stringify(clean) !== JSON.stringify(initial ?? []);
  useEffect(() => { const t = setInterval(() => setPreview(i => i + 1), 2500); return () => clearInterval(t); }, []);
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; setList(n); };
  const add = () => { if (draft.trim()) { setList([...list, draft.trim()]); setDraft(''); } };
  const save = async () => {
    const r = await a.run(() => rpc('set_welcome_phrases', { p_phrases: clean }).then(() => true), 'تم حفظ عبارات الترحيب');
    if (r) onSaved();
  };
  const shown = clean.length ? clean[preview % clean.length] : '';
  return (
    <Card title="عبارات الترحيب" subtitle="تظهر تحت اسم العضو في شاشة الدخول ولوحة التحكم وتتبدل تلقائياً" className="lg:col-span-2"
      actions={<Button size="sm" onClick={save} loading={a.busy} disabled={!dirty || !clean.length}>حفظ العبارات</Button>}>
      <ErrorBox>{a.error}</ErrorBox>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-2">
          {list.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 text-center text-xs text-muted num">{i + 1}</span>
              <Input value={p} maxLength={120} onChange={e => setList(list.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="لأعلى"><ArrowUp className="size-4" /></button>
              <button className="text-muted hover:text-ink disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="لأسفل"><ArrowDown className="size-4" /></button>
              <button className="text-muted hover:text-neg" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="حذف"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <span className="w-6" />
            <Input value={draft} maxLength={120} placeholder="أضف عبارة جديدة…" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={add}>إضافة</Button>
          </div>
          <div className="flex items-center justify-between pt-2 text-xs text-muted">
            <span className="num">{clean.length} عبارة · الحد الأعلى 40</span>
            <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setList([...FAMILY_PHRASES])}><RotateCcw className="size-3.5" />استرجاع العبارات الافتراضية</button>
          </div>
        </div>
        <div className="shurfa relative flex min-h-48 flex-col items-center justify-center overflow-hidden rounded-xl bg-brand-900 px-4 py-6 text-center text-white">
          <img src="/brand/mark-gold.svg" alt="" className="h-10 w-12" />
          <div className="mt-3 font-display text-sm text-gold-300">{greeting()}</div>
          <div className="font-display text-2xl font-semibold">{firstName(profile?.full_name) || 'خالد'}</div>
          <div className="my-3 h-[3px] w-12 rounded bg-gold-500" />
          <div key={preview} className="asf-phrase min-h-6 text-sm text-white/90">{shown}</div>
          <div className="absolute bottom-2 text-[10px] text-brand-200">معاينة</div>
        </div>
      </div>
    </Card>
  );
}

function InvestmentsViewCard({ mode, onSaved }: { mode: 'hidden' | 'names' | 'full'; onSaved: () => void }) {
  const a = useAction();
  const opts = [
    { v: 'names', t: 'الأسماء والأسعار فقط', d: 'يرى الأعضاء أسماء الاستثمارات والأسهم وأسعارها في السوق، بدون كميات أو مبالغ' },
    { v: 'full', t: 'كامل التفاصيل', d: 'يرى الأعضاء أيضاً الكميات والقيمة السوقية لكل استثمار' },
    { v: 'hidden', t: 'مخفية', d: 'لا تظهر صفحة استثمارات الصندوق للأعضاء' },
  ] as const;
  const pick = async (v: string) => { if (v !== mode && await a.run(() => rpc('set_member_investments_view', { p_mode: v }).then(() => true), 'تم الحفظ')) onSaved(); };
  return (
    <Card title="عرض الاستثمارات للأعضاء" subtitle="ما يظهر للأعضاء في صفحة «استثمارات الصندوق»">
      <ErrorBox>{a.error}</ErrorBox>
      <div className="space-y-2">
        {opts.map(o => (
          <label key={o.v} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition ${mode === o.v ? 'border-brand-600 bg-brand-50' : 'border-line hover:border-line-strong'}`}>
            <input type="radio" name="inv-view" className="mt-0.5 size-4 accent-brand-600" checked={mode === o.v} disabled={a.busy} onChange={() => pick(o.v)} />
            <span><span className="font-medium text-ink">{o.t}</span><span className="mt-0.5 block text-xs text-muted">{o.d}</span></span>
          </label>
        ))}
      </div>
    </Card>
  );
}
