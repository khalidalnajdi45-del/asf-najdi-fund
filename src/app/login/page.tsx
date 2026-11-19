'use client';
import { go } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { supabase, cleanError, IS_DEMO } from '@/lib/supabase';
import { resetDemo } from '@/lib/demo/client';
import { useAuth } from '@/lib/auth';
import { Button, ErrorBox, Field, Input } from '@/components/ui';
import { BootScreen } from '@/components/welcome';

export default function LoginPage() {
  const { ready, session, profile, mfaRequired, refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && session && profile && !mfaRequired) go(profile.role === 'manager' ? '/admin/' : '/member/', true);
  }, [ready, session, profile, mfaRequired]);

  const restoring = !ready || (!!session && !!profile && !mfaRequired);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const id = email.trim().toLowerCase();
    const login = id.includes('@') ? id : `${id}@members.najdi-fund.app`;
    const { error } = await supabase().auth.signInWithPassword({ email: login, password });
    setBusy(false);
    if (error) setError(/invalid/i.test(error.message) ? 'اسم المستخدم أو كلمة المرور غير صحيحة' : cleanError(error.message));
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const sb = supabase();
      const { data: factors } = await sb.auth.mfa.listFactors();
      const f = factors?.totp?.find(x => x.status === 'verified');
      if (!f) throw new Error('لا يوجد عامل تحقق مفعل');
      const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId: f.id });
      if (e1) throw e1;
      const { error: e2 } = await sb.auth.mfa.verify({ factorId: f.id, challengeId: ch.id, code: code.trim() });
      if (e2) throw new Error('رمز التحقق غير صحيح');
      await refresh();
    } catch (err: any) {
      setError(cleanError(err.message));
    } finally { setBusy(false); }
  }

  if (restoring && !busy) return <BootScreen />;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_480px]">
      <div className="shurfa relative hidden overflow-hidden bg-brand-900 lg:block">
        <img src="/brand/mark-plum.svg" alt="" aria-hidden className="pointer-events-none absolute -bottom-24 -left-40 w-[640px] max-w-none opacity-90" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <img src="/brand/mark-gold.svg" alt="" className="h-11 w-13" />
            <div>
              <div className="font-display text-xl font-semibold leading-tight">صندوق النجدي الادخاري</div>
              <div dir="ltr" className="text-right text-[10px] tracking-[0.3em] text-gold-300">AL-NAJDI SAVINGS FUND · ASF</div>
            </div>
          </div>
          <div className="max-w-lg">
            <div className="mb-4 text-sm text-gold-300">صندوق عائلي · ادخار · تكافل · استثمار</div>
            <h1 className="text-[44px] font-semibold leading-[1.35]">نبني معاً إرثاً<br />يمتد عبر الأجيال</h1>
            <p className="mt-5 leading-relaxed text-brand-100">متابعة الاشتراكات والودائع والقروض والاستثمارات بشفافية كاملة — بسجل محاسبي مزدوج القيد لا يقبل التعديل الصامت.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-brand-200"><ShieldCheck className="size-4 text-gold-300" /> كل عملية مالية موثقة بقيد محاسبي متوازن وسجل تدقيق</div>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden flex items-center gap-3">
            <img src="/brand/mark-plum.svg" alt="" className="h-10 w-12" />
            <span className="font-semibold">صندوق النجدي الادخاري</span>
          </div>
          {!mfaRequired ? (
            <form onSubmit={signIn} className="space-y-4">
              <div>
                <div className="brand-rule mb-4" />
                <h2 className="text-2xl font-semibold">تسجيل الدخول</h2>
                <p className="mt-1 text-sm text-muted">ادخل بياناتك للوصول إلى حسابك في الصندوق</p>
              </div>
              <Field label="اسم المستخدم">
                <Input type="text" dir="ltr" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={email} onChange={e => setEmail(e.target.value)} placeholder="khalid" />
              </Field>
              <Field label="كلمة المرور">
                <Input type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
              </Field>
              <ErrorBox>{error}</ErrorBox>
              <Button type="submit" variant="gold" loading={busy} className="w-full" icon={<LockKeyhole className="size-4" />}>دخول الأعضاء</Button>
              <p className="text-center text-xs text-muted">نسيت كلمة المرور؟ تواصل مع مدير الصندوق لإعادة تعيينها.</p>
              {IS_DEMO && (
                <div className="rounded-xl border border-gold-300 bg-gold-100/60 p-4 text-sm">
                  <div className="mb-2 font-semibold text-gold-700">نسخة تجريبية — ادخل بأحد الحسابات:</div>
                  <div className="grid gap-2">
                    <Button type="button" variant="secondary" onClick={() => { setEmail('manager@najdi-fund.demo'); setPassword('Demo@2026!'); }}>مدير الصندوق</Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="secondary" onClick={() => { setEmail('member02@najdi-fund.demo'); setPassword('Member@2026!'); }}>عضو (قرض نشط)</Button>
                      <Button type="button" variant="secondary" onClick={() => { setEmail('member07@najdi-fund.demo'); setPassword('Member@2026!'); }}>عضو (متأخرات)</Button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gold-700">البيانات تعمل بالكامل داخل متصفحك فقط ولا تُرسل لأي خادم.</p>
                  <button type="button" onClick={() => resetDemo()} className="mt-1 text-xs text-gold-700 underline">إعادة ضبط البيانات التجريبية</button>
                </div>
              )}
            </form>
          ) : (
            <form onSubmit={verifyMfa} className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">التحقق بخطوتين</h2>
                <p className="mt-1 text-sm text-muted">أدخل الرمز المكون من 6 أرقام من تطبيق المصادقة</p>
              </div>
              <Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.5em]" />
              <ErrorBox>{error}</ErrorBox>
              <Button type="submit" loading={busy} className="w-full" disabled={code.length !== 6}>تحقق</Button>
              <button type="button" onClick={() => supabase().auth.signOut()} className="w-full text-center text-xs text-muted hover:text-ink">العودة</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
