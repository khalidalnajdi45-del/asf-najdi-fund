'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';

/** Family phrases shown under the greeting — edit freely. */
export const FAMILY_PHRASES = [
  'ما يجمعنا أكبر من أي رصيد',
  'من الحريق إلى الأحساء… والأصل واحد',
  'صندوقنا أمان العائلة اليوم وبكرة',
  'يد الله مع الجماعة',
  'كل ريال ندخره اليوم سند لأهلنا بكرة',
  'التكافل عادة أهلنا… ونكملها',
  'قليلٌ دائم خيرٌ من كثيرٍ منقطع',
  'بيت النجدي عامر بأهله',
];

function riyadhHour() {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Riyadh' }).format(new Date()));
}
export function greeting() {
  return riyadhHour() < 12 ? 'صباح الخير' : 'مساء الخير';
}
export function firstName(full?: string | null) {
  const n = (full ?? '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
  return n || '';
}

/** Cycles through the phrases; returns the current one and a key that changes with it (for re-animation). */
export function usePhrase(intervalMs: number, start = 0) {
  const [i, setI] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setI(x => (x + 1) % FAMILY_PHRASES.length), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return { phrase: FAMILY_PHRASES[i], key: i };
}

const SEEN_KEY = 'asf-welcome-seen';

/** Full-screen intro shown once per browser session after signing in. Tap anywhere to skip. */
export function WelcomeSplash() {
  const { profile } = useAuth();
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { phrase, key } = usePhrase(2200, Math.floor(Math.random() * FAMILY_PHRASES.length));

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; sessionStorage.setItem(SEEN_KEY, '1'); } catch {}
    if (!seen) setShow(true);
  }, []);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setLeaving(true), 5600);
    return () => clearTimeout(t);
  }, [show]);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setShow(false), 700);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!show || !profile) return null;
  return (
    <div role="dialog" aria-label="ترحيب" onClick={() => setLeaving(true)}
      className={`asf-splash shurfa fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-brand-900 px-6 text-center text-white ${leaving ? 'asf-splash-out' : ''}`}>
      <div className="asf-glow pointer-events-none absolute left-1/2 top-1/2 size-[640px] rounded-full" />
      <img src="/brand/mark-gold.svg" alt="" className="asf-mark relative h-24 w-28 sm:h-28 sm:w-32" />
      <div className="asf-greet relative mt-8 font-display text-xl text-gold-300 sm:text-2xl">{greeting()}</div>
      <div className="asf-name relative mt-1 font-display text-5xl font-semibold leading-tight sm:text-6xl">{firstName(profile.full_name)}</div>
      <div className="asf-rule relative mt-6 h-[3px] rounded bg-gold-500" />
      <div className="relative mt-6 h-8 sm:h-9">
        <div key={key} className="asf-phrase text-lg text-white/90 sm:text-xl">{phrase}</div>
      </div>
      <div className="asf-hint absolute bottom-8 text-xs text-brand-200">اضغط للمتابعة</div>
    </div>
  );
}

/** Greeting band at the top of each dashboard, with phrases that rotate every few seconds. */
export function GreetingBand({ subtitle }: { subtitle?: React.ReactNode }) {
  const { profile } = useAuth();
  const { phrase, key } = usePhrase(6000);
  return (
    <section className="shurfa relative mb-6 overflow-hidden rounded-2xl bg-brand-900 px-6 py-6 text-white sm:px-8">
      <img src="/brand/mark-plum.svg" alt="" aria-hidden className="pointer-events-none absolute -bottom-10 -left-8 w-56 opacity-60" />
      <div className="relative">
        <div className="font-display text-sm text-gold-300">{greeting()}</div>
        <h1 className="font-display text-[28px] font-semibold leading-tight sm:text-[32px]">{firstName(profile?.full_name)}</h1>
        <div className="mt-2 h-7 overflow-hidden">
          <p key={key} className="asf-phrase text-[15px] text-brand-100">{phrase}</p>
        </div>
        {subtitle && <div className="mt-3 text-xs text-brand-200">{subtitle}</div>}
      </div>
    </section>
  );
}
