'use client';
import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { supabase, cleanError } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Button, ErrorBox, Field, Input } from './ui';

/** First login with a temporary password: the member must pick their own before entering. */
export function ForcePasswordChange() {
  const { profile, refresh, signOut } = useAuth();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weak = p1.length < 8 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p1 !== p2) { setError('كلمتا المرور غير متطابقتين'); return; }
    setBusy(true); setError(null);
    const { error } = await supabase().auth.updateUser({ password: p1, data: { must_change_password: false } });
    if (error) { setBusy(false); setError(/same|different/i.test(error.message) ? 'اختر كلمة مرور مختلفة عن المؤقتة' : cleanError(error.message)); return; }
    await refresh();
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <form onSubmit={save} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div>
          <div className="brand-rule mb-4" />
          <h2 className="text-xl font-semibold">أهلاً {profile?.full_name}</h2>
          <p className="mt-1 text-sm text-muted">هذا أول دخول لك — اختر كلمة مرور خاصة بك بدل المؤقتة.</p>
        </div>
        <Field label="كلمة المرور الجديدة" hint="8 خانات على الأقل وتحتوي حروفاً وأرقاماً">
          <Input type="password" dir="ltr" autoComplete="new-password" value={p1} onChange={e => setP1(e.target.value)} />
        </Field>
        <Field label="تأكيد كلمة المرور">
          <Input type="password" dir="ltr" autoComplete="new-password" value={p2} onChange={e => setP2(e.target.value)} />
        </Field>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" variant="gold" className="w-full" loading={busy} disabled={weak || !p2} icon={<LockKeyhole className="size-4" />}>حفظ والدخول</Button>
        <button type="button" onClick={() => signOut()} className="w-full text-center text-xs text-muted hover:text-ink">خروج</button>
      </form>
    </div>
  );
}
