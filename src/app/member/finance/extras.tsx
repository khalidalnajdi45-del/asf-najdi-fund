'use client';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarClock, Check, Copy, KeyRound, Landmark, Pause, Play, Scale, Smartphone, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { IS_DEMO, rpc } from '@/lib/supabase';
import { num, sar, today } from '@/lib/format';
import { Button, Card, Field, Input, Modal, MoneyInput, Select, isMoney, useToast } from '@/components/ui';

export type Ov2 = {
  cycle: { start: string; end: string; today: string };
  settings: { payday: number; notify: boolean; zakat: Record<string, any>; zakat_date: string | null; capture: boolean; capture_created_at: string | null };
  variable: string; prev_variable: string; prev_days: number;
  upcoming: { title: string; kind: 'income' | 'expense'; amount: string; date: string; commitment: boolean }[];
  commitments: { id: string; title: string; provider: string | null; amount: string; day: number; active: boolean; end_month: string | null; total_amount: string | null; category: string | null; paid_count: number; remaining: number | null }[];
  fund_balance: string | null;
};
type O = Ov2 & { income: string; expense: string; categories: { id: string; kind: string; name: string }[]; recurring: { kind: string; amount: string; active: boolean }[];
  fund_due: { contribution: string; installments: string } | null; goals: any[] };
type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const hijri = (d: string) => { try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T12:00:00Z`)).replace(/[‎‏؜]/g, ''); } catch { return ''; } };
const r0 = (n: number) => Math.round(n).toLocaleString('en-US');

// ------------------------------------------------------------------ 3) end-of-cycle forecast
export function Forecast({ o }: { o: O }) {
  const t = o.cycle.today, left = Math.max(0, days(t, o.cycle.end)), elapsed = Math.max(1, days(o.cycle.start, t) + 1);
  const inc = num(o.income), exp = num(o.expense);
  const upIn = o.upcoming.filter(u => u.kind === 'income').reduce((a, u) => a + num(u.amount), 0);
  const upOut = o.upcoming.filter(u => u.kind === 'expense').reduce((a, u) => a + num(u.amount), 0);
  const fundUnpaid = o.fund_due ? num(o.fund_due.contribution) + num(o.fund_due.installments) : 0;
  // daily variable spend: this cycle once it has a week of history, otherwise last cycle's pace
  const prevDaily = o.prev_days ? num(o.prev_variable) / o.prev_days : 0;
  const curDaily = num(o.variable) / elapsed;
  const daily = elapsed >= 7 || !prevDaily ? curDaily : (curDaily * elapsed + prevDaily * (7 - elapsed)) / 7;
  const projVar = daily * left;
  const end = inc + upIn - exp - upOut - fundUnpaid - projVar;
  const noIncome = inc + upIn === 0;
  const rows = [
    { label: 'الدخل (المسجل + المتوقع)', v: inc + upIn, tone: 'pos' },
    { label: 'صُرف حتى الآن', v: -exp },
    { label: 'التزامات ومتكرر قادم', v: -upOut, hide: !upOut },
    { label: 'مستحقات الصندوق غير المسددة', v: -fundUnpaid, hide: !fundUnpaid },
    { label: `صرف يومي متوقع (${r0(daily)} × ${left} يوم)`, v: -projVar, hide: !left },
  ].filter(r => !r.hide);
  return (
    <Card className="mb-5" pad={false}>
      <div className="grid gap-0 md:grid-cols-[1fr_1.2fr]">
        <div className={clsx('flex flex-col justify-center gap-1 p-5', end >= 0 ? 'bg-[#eef6f0]' : 'bg-clay/10')}>
          <div className="flex items-center gap-2 text-sm font-medium text-muted">{end >= 0 ? <TrendingUp className="size-4 text-pos" /> : <TrendingDown className="size-4 text-neg" />}توقع نهاية الشهر · <span className="num-cell">{dm(o.cycle.end)}</span></div>
          <div className={clsx('font-display text-3xl font-semibold num-cell', end >= 0 ? 'text-pos' : 'text-neg')}>{end >= 0 ? 'فائض' : 'عجز'} {sar(Math.abs(end))}</div>
          <div className="text-xs text-muted">{noIncome ? 'سجّل راتبك أو أضفه كدخل متكرر ليصير التوقع أدق.' : `بقي ${left} يوم على الراتب — بمعدل صرفك الحالي ${r0(daily)} ريال يومياً.`}</div>
        </div>
        <div className="space-y-1.5 p-5 text-sm">
          {rows.map(r => <div key={r.label} className="flex justify-between gap-3"><span className="text-muted">{r.label}</span><span className={clsx('num-cell', r.v > 0 ? 'text-pos' : r.v < 0 ? 'text-ink' : '')}>{r.v > 0 ? '+' : r.v < 0 ? '−' : ''}{sar(Math.abs(r.v))}</span></div>)}
          {o.upcoming.length > 0 && <div className="mt-2 border-t border-line pt-2 text-xs text-muted">
            <span className="flex items-center gap-1"><CalendarClock className="size-3.5" />القادم:</span>
            <div className="mt-1 flex flex-wrap gap-1.5">{o.upcoming.slice(0, 5).map((u, i) => <span key={i} className="rounded-full bg-canvas px-2 py-0.5">{u.title} · <span className="num-cell">{dm(u.date)}</span> · <span className="num-cell">{u.kind === 'income' ? '+' : '−'}{r0(num(u.amount))}</span></span>)}</div>
          </div>}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ monthly commitments
export function Commitments({ o, run }: { o: O; run: Run }) {
  const live = o.commitments.filter(c => c.active && (c.remaining === null || c.remaining > 0));
  const total = live.reduce((a, c) => a + num(c.amount), 0);
  const salary = o.recurring.filter(r => r.kind === 'income' && r.active).reduce((a, r) => a + num(r.amount), 0) || num(o.income);
  const ratio = salary > 0 ? (total / salary) * 100 : null;
  if (!o.commitments.length) return <p className="text-sm text-muted">تمويل السيارة، القرض الشخصي، الإيجار، أقساط تابي وتمارا… أضفها مرة وتشوف كم باقي عليها، وتنحسب تلقائياً كل شهر.</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 rounded-xl bg-canvas p-3">
        <div><div className="text-xs text-muted">مجموع الالتزامات الشهرية</div><div className="font-display text-xl font-semibold num-cell">{sar(total)}</div></div>
        {ratio !== null && <div className="text-end"><div className="text-xs text-muted">من دخلك</div>
          <div className={clsx('text-lg font-semibold num-cell', ratio <= 33 ? 'text-pos' : ratio <= 45 ? 'text-gold-700' : 'text-neg')}>{Math.round(ratio)}%</div></div>}
      </div>
      {ratio !== null && <div className="h-1.5 overflow-hidden rounded-full bg-canvas"><div className={clsx('h-full rounded-full', ratio <= 33 ? 'bg-pos' : ratio <= 45 ? 'bg-gold-500' : 'bg-neg')} style={{ width: `${Math.min(100, ratio)}%` }} /></div>}
      <ul className="space-y-2.5">
        {o.commitments.map(c => {
          const done = c.remaining === 0, paid = c.paid_count * num(c.amount), tot = c.total_amount ? num(c.total_amount) : null;
          return <li key={c.id} className={clsx('group rounded-xl border border-line p-3', (!c.active || done) && 'opacity-60')}>
            <div className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Landmark className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{c.title}</span>
                <span className="block text-[11px] text-muted">{[c.provider, `يوم ${c.day}`].filter(Boolean).join(' · ')}</span></span>
              <span className="text-end"><span className="block text-sm font-semibold num-cell">{sar(c.amount)}</span><span className="text-[10px] text-muted">شهرياً</span></span>
              <button onClick={() => run(() => rpc('pf_set_recurring_active', { p_id: c.id, p_active: !c.active }))} className="text-muted hover:text-brand-600" aria-label={c.active ? 'إيقاف' : 'تشغيل'}>{c.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button>
              <button onClick={() => run(() => rpc('pf_delete_recurring', { p_id: c.id }), 'حُذف الالتزام')} className="text-muted hover:text-neg" aria-label="حذف"><Trash2 className="size-3.5" /></button>
            </div>
            {(c.remaining !== null || tot) && <div className="mt-2">
              {tot && <div className="h-1.5 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-gold-500" style={{ width: `${Math.min(100, (paid / tot) * 100)}%` }} /></div>}
              <div className="mt-1 flex justify-between text-[11px] text-muted">
                <span>{done ? 'انتهى ✓' : c.remaining !== null ? `باقي ${c.remaining} دفعة` : ''}{c.end_month && !done ? ` · ينتهي ${MONTHS[Number(c.end_month.slice(5, 7)) - 1]} ${c.end_month.slice(0, 4)}` : ''}</span>
                {tot && <span className="num-cell">متبقي {sar(Math.max(0, tot - paid))}</span>}
              </div>
            </div>}
          </li>;
        })}
      </ul>
    </div>
  );
}

export function CommitmentModal({ open, cats, onClose, onSaved }: { open: boolean; cats: O['categories']; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const blank = { title: '', provider: '', amount: '', day: '27', end: '', total: '', cat: '' };
  const [f, setF] = useState(blank);
  const save = async () => {
    try {
      await rpc('pf_add_commitment', { p_title: f.title, p_amount: f.amount, p_day: Number(f.day), p_category: f.cat || null,
        p_end: f.end ? `${f.end}-01` : null, p_total: f.total || null, p_provider: f.provider || null });
      setF(blank); toast.ok('أُضيف الالتزام'); onSaved();
    } catch (e: any) { toast.err(e.message); }
  };
  return <Modal open={open} onClose={onClose} title="التزام شهري جديد" footer={<Button disabled={f.title.trim().length < 2 || !isMoney(f.amount)} onClick={save}>إضافة</Button>}>
    <div className="grid grid-cols-2 gap-3">
      <Field label="الالتزام" className="col-span-2"><Input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={60} placeholder="تمويل السيارة، إيجار الشقة…" autoFocus /></Field>
      <Field label="الجهة" hint="اختياري"><Input value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })} maxLength={60} placeholder="الراجحي، تمارا…" /></Field>
      <Field label="القسط الشهري"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
      <Field label="يوم الخصم" hint="من 1 إلى 28"><Input type="number" min={1} max={28} value={f.day} onChange={e => setF({ ...f, day: e.target.value })} /></Field>
      <Field label="آخر شهر" hint="اختياري — لحساب الدفعات الباقية"><Input type="month" value={f.end} onChange={e => setF({ ...f, end: e.target.value })} /></Field>
      <Field label="إجمالي المبلغ" hint="اختياري"><MoneyInput value={f.total} onChange={v => setF({ ...f, total: v })} /></Field>
      <Field label="التصنيف"><Select value={f.cat} onChange={e => setF({ ...f, cat: e.target.value })} placeholder="بدون" options={cats.filter(c => c.kind === 'expense').map(c => ({ value: c.id, label: c.name }))} /></Field>
    </div>
    <p className="text-xs text-muted">يُسجَّل القسط كمصروف تلقائياً في يومه كل شهر، ويتوقف بعد آخر شهر.</p>
  </Modal>;
}

// ------------------------------------------------------------------ zakat (the member enters the amount; 2.5%)
type Z = { amount: string; due?: number; at?: string };

export function ZakatCard({ o, onOpen }: { o: O; onOpen: () => void }) {
  const z = o.settings?.zakat as Partial<Z> | undefined, when = o.settings?.zakat_date;
  return (
    <button onClick={onOpen} className="block w-full rounded-2xl border border-gold-300 bg-gradient-to-l from-gold-100/60 to-surface p-4 text-start transition hover:shadow-md">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-gold-500 text-white"><Scale className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block font-semibold">حاسبة الزكاة</span>
          <span className="block text-xs text-muted">{when ? `موعد زكاتك ${hijri(when)} (${dm(when)})` : 'أدخل المبلغ واعرف زكاته'}</span></span>
        {z?.due !== undefined && <span className="text-end"><span className="block text-[10px] text-muted">آخر حساب</span><span className="font-semibold text-gold-700 num-cell">{sar(z.due)}</span></span>}
      </div>
    </button>
  );
}

export function ZakatModal({ open, o, onClose, onSaved }: { open: boolean; o: O; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState('');
  useEffect(() => { if (open) { setAmount(String(o.settings?.zakat?.amount ?? '')); setWhen(o.settings?.zakat_date ?? ''); } }, [open]); // eslint-disable-line
  const due = num(amount || 0) * 0.025;
  const save = async () => {
    try { await rpc('pf_save_zakat', { p: { amount, due, at: today() }, p_date: when || null }); toast.ok('حُفظت حسبة الزكاة'); onSaved(); onClose(); }
    catch (e: any) { toast.err(e.message); }
  };
  return <Modal open={open} onClose={onClose} title="حاسبة الزكاة" footer={<Button onClick={save}>حفظ</Button>}>
    <Field label="المبلغ الذي تريد حساب زكاته" hint="مجموع ما حال عليه الحول من مالك"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
    <div className="rounded-2xl bg-brand-900 p-5 text-center text-white">
      <div className="text-xs text-brand-200">الزكاة (2.5%)</div>
      <div className="mt-1 font-display text-4xl font-semibold text-gold-300 num-cell">{sar(due)}</div>
    </div>
    <Field label="موعد الحول (اختياري)" hint={when ? `يوافق ${hijri(when)} — يذكّرك كل سنة هجرية إذا فعّلت تنبيهات ماليتي` : 'لتذكيرك بموعد زكاتك كل سنة'}>
      <Input type="date" value={when} onChange={e => setWhen(e.target.value)} /></Field>
  </Modal>;
}

// ------------------------------------------------------------------ settings (payday + opt-in alerts)
export function SettingsModal({ open, o, onClose, onSaved, onShortcut }: { open: boolean; o: O; onClose: () => void; onSaved: () => void; onShortcut: () => void }) {
  const toast = useToast();
  const [payday, setPayday] = useState(String(o.settings?.payday ?? 27));
  const [notify, setNotify] = useState(!!o.settings?.notify);
  useEffect(() => { if (open) { setPayday(String(o.settings?.payday ?? 27)); setNotify(!!o.settings?.notify); } }, [open]); // eslint-disable-line
  const save = async () => {
    try { await rpc('pf_set_settings', { p_payday: Number(payday), p_notify: notify }); toast.ok('حُفظت الإعدادات'); onSaved(); onClose(); }
    catch (e: any) { toast.err(e.message); }
  };
  return <Modal open={open} onClose={onClose} title="إعدادات ماليتي" footer={<Button onClick={save}>حفظ</Button>}>
    <Field label="يبدأ شهري من يوم الراتب" hint="الميزانيات والملخص والتوقع تُحسب من يوم الراتب إلى اليوم الذي قبله">
      <Select value={payday} onChange={e => setPayday(e.target.value)} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? 'من أول الشهر (شهر ميلادي)' : `يوم ${i + 1}${i + 1 === 27 ? ' — راتب حكومي' : ''}` }))} />
    </Field>
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
      <input type="checkbox" className="mt-1 size-4 accent-brand-600" checked={notify} onChange={e => setNotify(e.target.checked)} />
      <span><span className="flex items-center gap-1.5 font-medium"><BellRing className="size-4 text-gold-700" />تنبيهات ماليتي (اختياري)</span>
        <span className="mt-0.5 block text-xs text-muted">عند الوصول لـ 80% و100% من ميزانية أي فئة، عند تسجيل عملية من رسائل البنك تلقائياً، وبموعد الزكاة. تصلك على الجوال إذا كانت إشعارات الجوال مفعّلة من «الملف الشخصي».</span></span>
    </label>
    <button onClick={onShortcut} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-brand-200 bg-brand-50/50 p-3 text-start hover:bg-brand-50">
      <Smartphone className="size-5 text-brand-600" /><span className="flex-1"><span className="block text-sm font-medium">تتبع رسائل البنك تلقائياً</span>
        <span className="block text-xs text-muted">{o.settings?.capture ? 'مفعّل — اضغط للإدارة' : 'اختصار آيفون يسجل عملياتك بدون نسخ ولصق'}</span></span>
      {o.settings?.capture && <Check className="size-4 text-pos" />}
    </button>
  </Modal>;
}

// ------------------------------------------------------------------ iPhone Shortcut for automatic SMS capture
const ENDPOINT = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://<project>.supabase.co'}/functions/v1/pf-capture`;
function CopyRow({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [ok, setOk] = useState(false);
  return <div className="rounded-lg border border-line bg-canvas p-2.5">
    <div className="mb-1 text-[11px] text-muted">{label}</div>
    <div className="flex items-center gap-2"><code dir="ltr" className={clsx('min-w-0 flex-1 break-all text-xs', mono && 'font-mono')}>{value}</code>
      <button onClick={() => navigator.clipboard?.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })} className="shrink-0 rounded-md p-1.5 text-brand-600 hover:bg-surface" aria-label="نسخ">{ok ? <Check className="size-4" /> : <Copy className="size-4" />}</button></div>
  </div>;
}

export function ShortcutModal({ open, o, onClose, onSaved }: { open: boolean; o: O; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  useEffect(() => { if (!open) { setKey(null); setTest(null); } }, [open]);
  const gen = async () => {
    if (IS_DEMO) { toast.err('التتبع التلقائي يعمل في المنصة الفعلية فقط'); return; }
    setBusy(true);
    try { setKey(await rpc<string>('pf_capture_token')); onSaved(); } catch (e: any) { toast.err(e.message); } finally { setBusy(false); }
  };
  const revoke = async () => { try { await rpc('pf_capture_revoke'); setKey(null); toast.ok('تم إيقاف التتبع — الاختصار القديم لن يعمل'); onSaved(); } catch (e: any) { toast.err(e.message); } };
  const tryIt = async () => {
    if (!key) return;
    setTest('…');
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-capture-key': key },
        body: JSON.stringify({ text: `شراء عبر نقاط البيع\nمبلغ: SAR 1.00\nلدى: اختبار ماليتي\nفي: ${today()}` }) });
      const j = await r.json();
      setTest(j.ok ? (j.duplicate ? 'وصلت — والرسالة مسجلة سابقاً' : 'وصلت ✓ سُجلت عملية تجريبية بـ 1 ريال (احذفها من القائمة)') : `لم تنجح: ${j.error ?? r.status}`);
      onSaved();
    } catch { setTest('تعذر الاتصال'); }
  };
  const E = ({ children }: { children: string }) => <bdi dir="ltr" className="rounded bg-canvas px-1 font-mono text-[12px]">{children}</bdi>;
  const steps = [
    <>افتح تطبيق «الاختصارات» <E>Shortcuts</E> ← تبويب «الأتمتة» <E>Automation</E> ← زر +.</>,
    <>اختر «رسالة» <E>Message</E>، واترك «المرسل» <E>Sender</E> فاضي (يعرض جهات الاتصال فقط، والبنوك ليست منها)، وفي «الرسالة تحتوي على» <E>Message Contains</E> اكتب: <b>مبلغ</b></>,
    <>اختر «تشغيل فوري» <E>Run Immediately</E> ثم «التالي» ← «أتمتة جديدة فارغة».</>,
    <>أضف إجراء «الحصول على محتويات عنوان URL» <E>Get Contents of URL</E> والصق الرابط أعلاه.</>,
    <>اضغط السهم بجانبه: الطريقة <E>POST</E>، وفي «الترويسات» <E>Headers</E> أضف المفتاح <E>x-capture-key</E> وقيمته مفتاحك.</>,
    <>في «نص الطلب» <E>Request Body</E> اختر <E>JSON</E> وأضف حقلاً اسمه <E>text</E>، وقيمته «مُدخل الاختصار» <E>Shortcut Input</E> ← «المحتوى» <E>Content</E>.</>,
    <>احفظ. إذا بعض رسائل بنكك بالإنجليزي، كرر نفس الأتمتة بكلمة <E>SAR</E>. الرسائل غير المالية ورموز التحقق تُتجاهل تلقائياً، والمكررة لا تُسجل مرتين.</>,
  ];
  return <Modal open={open} onClose={onClose} wide title="تتبع رسائل البنك تلقائياً">
    <div className="space-y-4">
      <p className="text-sm text-muted">اختصار في الآيفون يرسل رسائل البنك لماليتي لحظة وصولها: نقرأ منها المبلغ والتاجر والتاريخ ونصنّفها، ولا نحفظ نص الرسالة نفسه. رسائل رمز التحقق وغيرها تُتجاهل.</p>
      {!key ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-canvas p-3">
          <KeyRound className="size-5 text-gold-700" />
          <span className="flex-1 text-sm">{o.settings?.capture ? 'التتبع مفعّل. إنشاء مفتاح جديد يوقف المفتاح القديم.' : 'ابدأ بإنشاء مفتاحك الخاص — يظهر مرة واحدة.'}</span>
          <Button loading={busy} onClick={gen}>{o.settings?.capture ? 'مفتاح جديد' : 'إنشاء المفتاح'}</Button>
          {o.settings?.capture && <Button variant="secondary" onClick={revoke}>إيقاف التتبع</Button>}
        </div>
      ) : (
        <div className="space-y-2">
          <CopyRow label="الرابط (URL)" value={ENDPOINT} />
          <CopyRow label="الترويسة: x-capture-key — مفتاحك (لا تشاركه، يظهر هذه المرة فقط)" value={key} />
          <div className="flex flex-wrap items-center gap-2"><Button variant="secondary" size="sm" onClick={tryIt}>جرّب الاتصال</Button>{test && <span className="text-xs text-muted">{test}</span>}</div>
        </div>
      )}
      <ol className="space-y-2.5">
        {steps.map((s, i) => <li key={i} className="flex gap-3 text-sm"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white num-cell">{i + 1}</span><span className="pt-0.5 leading-7">{s}</span></li>)}
      </ol>
      <p className="text-[11px] text-muted">يحتاج iOS 17 أو أحدث لخيار «تشغيل فوري». إذا غيّرت جوالك أو شككت أن المفتاح تسرب، أنشئ مفتاحاً جديداً من هنا.</p>
    </div>
  </Modal>;
}
