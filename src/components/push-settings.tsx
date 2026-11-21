'use client';
import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { BellRing, Share, SquarePlus, X } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { disablePush, enablePush, pushState, testPush, type PushState } from '@/lib/push';
import { Button, Card, useToast } from './ui';

const CATS: { key: string; label: string; hint: string; manager?: boolean }[] = [
  { key: 'dues', label: 'مواعيد السداد', hint: 'تذكير قبل الاشتراك والقسط، ويوم الاستحقاق، والمتأخرات' },
  { key: 'requests', label: 'قرارات طلباتي', hint: 'قبول أو رفض القرض والسحب والإيداع، وصرف القرض' },
  { key: 'payments', label: 'الدفعات على حسابي', hint: 'تسجيل اشتراك أو قسط أو إيداع' },
  { key: 'events', label: 'مناسبات الصندوق', hint: 'مناسبة جديدة أو إلغاؤها' },
  { key: 'tasks', label: 'مهامي في التقويم', hint: 'قبل موعد المهمة، ومهام اليوم صباحاً' },
  { key: 'fund', label: 'أخبار الصندوق', hint: 'الإعلانات، توزيع الأرباح، التقارير والرسائل' },
  { key: 'admin', label: 'طلبات الأعضاء وملخص الصباح', hint: 'طلب قرض/إيداع/سحب جديد، والمتأخرات كل صباح', manager: true },
];

function usePush() {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = useCallback(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);
  useEffect(refresh, [refresh]);
  return { state, refresh };
}

function InstallHint() {
  return (
    <ol className="space-y-1.5 text-sm text-muted">
      <li className="flex items-center gap-2">١. افتح المنصة من <b className="text-ink">سفاري</b> واضغط زر المشاركة <Share className="size-4 text-brand-600" /></li>
      <li className="flex items-center gap-2">٢. اختر <b className="text-ink">«إضافة إلى الشاشة الرئيسية»</b> <SquarePlus className="size-4 text-brand-600" /></li>
      <li>٣. افتح المنصة من الأيقونة الجديدة وفعّل الإشعارات من هنا.</li>
    </ol>
  );
}

/** Profile page: enable/disable on this device + per-category choices. */
export function PushCard() {
  const { profile } = useAuth();
  const toast = useToast();
  const { state, refresh } = usePush();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { rpc<any>('my_push_settings').then(d => setPrefs(d?.prefs ?? {})).catch(() => {}); }, []);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.ok(ok); } catch (e: any) { toast.err(e.message); } finally { setBusy(false); refresh(); }
  };
  const toggle = async (k: string, on: boolean) => {
    setPrefs(p => ({ ...p, [k]: on }));
    try { await rpc('set_push_pref', { p_category: k, p_on: on }); } catch (e: any) { toast.err(e.message); setPrefs(p => ({ ...p, [k]: !on })); }
  };
  const cats = CATS.filter(c => !c.manager || profile?.role === 'manager');

  return (
    <Card title="إشعارات الجوال" subtitle="تنبيهات على شاشة القفل مثل أي تطبيق">
      <div className="space-y-4">
        {state === 'demo' && <p className="text-sm text-muted">الإشعارات تعمل في المنصة الفعلية فقط (غير متاحة في النسخة التجريبية).</p>}
        {state === 'ios-install' && <><p className="text-sm">على الآيفون تشتغل الإشعارات بعد إضافة المنصة للشاشة الرئيسية:</p><InstallHint /></>}
        {state === 'unsupported' && <p className="text-sm text-muted">هذا المتصفح لا يدعم الإشعارات. على الآيفون يلزم iOS ‏16.4 أو أحدث.</p>}
        {state === 'denied' && <p className="text-sm text-neg">الإشعارات مرفوضة لهذا الجهاز — فعّلها من الإعدادات ← الإشعارات ← صندوق النجدي الادخاري، ثم ارجع هنا.</p>}
        {(state === 'off' || state === 'on') && (
          <div className="flex flex-wrap items-center gap-3">
            <span className={clsx('flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium', state === 'on' ? 'bg-brand-50 text-brand-700' : 'bg-canvas text-muted')}>
              <span className={clsx('size-2 rounded-full', state === 'on' ? 'bg-pos' : 'bg-line-strong')} />{state === 'on' ? 'مفعّلة على هذا الجهاز' : 'غير مفعّلة على هذا الجهاز'}</span>
            {state === 'off'
              ? <Button icon={<BellRing className="size-4" />} loading={busy} onClick={() => run(enablePush, 'تم تفعيل الإشعارات')}>فعّل الإشعارات</Button>
              : <>
                <Button variant="secondary" loading={busy} onClick={() => run(async () => { const r = await testPush(); if (!r.sent) throw new Error('ما وصل الإشعار — جرّب تعطيل وتفعيل الإشعارات'); }, 'أرسلنا إشعار تجريبي')}>إشعار تجريبي</Button>
                <button className="text-xs text-muted hover:text-neg" disabled={busy} onClick={() => run(disablePush, 'تم إيقاف الإشعارات على هذا الجهاز')}>إيقاف على هذا الجهاز</button>
              </>}
          </div>
        )}
        {state !== 'demo' && <div className="border-t border-line pt-3">
          <div className="mb-2 text-xs font-medium text-muted">وش يوصلك؟ (لكل أجهزتك)</div>
          <ul className="space-y-2.5">
            {cats.map(c => <li key={c.key}>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={prefs[c.key] !== false} onChange={e => toggle(c.key, e.target.checked)} />
                <span><span className="block font-medium">{c.label}</span><span className="block text-xs text-muted">{c.hint}</span></span>
              </label>
            </li>)}
          </ul>
        </div>}
      </div>
    </Card>
  );
}

const DISMISS = 'push-prompt-dismissed';
/** Home banner: nudges once per device until push is on (or dismissed). */
export function PushPrompt() {
  const toast = useToast();
  const { state, refresh } = usePush();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS) === '1'; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  if (hidden || !state || !['off', 'ios-install'].includes(state)) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS, '1'); } catch { /* ignore */ } setHidden(true); };
  return (
    <div className="relative mb-4 flex flex-wrap items-center gap-3 overflow-hidden rounded-2xl border border-gold-300 bg-gradient-to-l from-gold-100/70 to-surface p-4 pe-10">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-gold-300"><BellRing className="size-5" /></span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">خلّ التنبيهات توصلك على الجوال</div>
        <div className="text-xs text-muted">{state === 'ios-install' ? 'أضف المنصة للشاشة الرئيسية من سفاري (مشاركة ← إضافة إلى الشاشة الرئيسية)، ثم افتحها من الأيقونة.' : 'مواعيد السداد، قرارات طلباتك، ومناسبات الصندوق — على شاشة القفل.'}</div>
      </div>
      {state === 'off' && <Button loading={busy} onClick={async () => {
        setBusy(true);
        try { await enablePush(); toast.ok('تم تفعيل الإشعارات'); } catch (e: any) { toast.err(e.message); } finally { setBusy(false); refresh(); }
      }}>فعّل الإشعارات</Button>}
      <button onClick={dismiss} className="absolute end-3 top-3 text-muted hover:text-ink" aria-label="إغلاق"><X className="size-4" /></button>
    </div>
  );
}
