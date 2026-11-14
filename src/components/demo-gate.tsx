'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { IS_DEMO } from '@/lib/supabase';
import { db, onDemoStatus } from '@/lib/demo/client';

/** Demo build: boots the in-browser Postgres (first visit builds + seeds it) before rendering the app. */
export function DemoGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!IS_DEMO);
  const [msg, setMsg] = useState('تشغيل محرك قاعدة البيانات…');
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => {
    if (!IS_DEMO) return;
    onDemoStatus(s => s && setMsg(s));
    db().then(() => setReady(true)).catch(e => setFail(String(e?.message ?? e)));
  }, []);
  if (ready) return <>{children}</>;
  return (
    <div className="shurfa flex min-h-screen flex-col items-center justify-center gap-5 bg-brand-900 px-6 text-center text-white">
      <img src="/brand/mark-gold.svg" alt="" className="h-16 w-20 animate-pulse" />
      <div className="font-display text-xl">صندوق النجدي الادخاري — نسخة تجريبية</div>
      <div className="text-sm text-brand-100">{fail ? `تعذر التشغيل: ${fail}` : msg}</div>
      {!fail && <div className="text-xs text-brand-200">أول زيارة تستغرق بضع ثوانٍ لبناء قاعدة البيانات داخل المتصفح</div>}
    </div>
  );
}
