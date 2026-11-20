'use client';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, PartyPopper, Plus, Trash2, Wallet } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/hooks';
import { num, sar, today } from '@/lib/format';
import { Card } from './ui';

type Cal = {
  tasks: { id: string; date: string; time: string | null; title: string; note: string | null; done: boolean }[];
  events: { id: string; date: string; time: string | null; title: string; kind: string; location: string | null }[];
  dues: { date: string; kind: 'contribution' | 'installment'; title: string; amount: string; overdue: boolean }[];
};
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DOW = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dayName = (d: string) => new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${d}T12:00:00`));
const H = (opts: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', ...opts }); } catch { return null; } };
const hDay = H({ day: 'numeric' }), hFull = H({ day: 'numeric', month: 'long', year: 'numeric' }), hMonth = H({ month: 'long' }), hYear = H({ year: 'numeric' });
const clean = (s: string) => s.replace(/[\u200e\u200f\u061c]/g, '').replace(/\s*هـ$/, '').trim();
const hijri = (f: Intl.DateTimeFormat | null, d: string) => (f ? clean(f.format(new Date(`${d}T12:00:00Z`))) : '');
/** Hijri month span of a Gregorian month, e.g. "جمادى الأولى – جمادى الآخرة 1448". */
const hijriSpan = (a: string, b: string) => {
  const m1 = hijri(hMonth, a), m2 = hijri(hMonth, b), y2 = hijri(hYear, b);
  return m1 === m2 ? `${m1} ${y2}` : `${m1} – ${m2} ${y2}`;
};

/** Member's month: own tasks (private), fund events and their payment due dates. */
export function MemberCalendar() {
  const t = today();
  const [ym, setYm] = useState<[number, number]>([Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1]);
  const [sel, setSel] = useState(t);
  const [y, m] = ym;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const from = iso(y, m, 1), to = iso(y, m, days);
  const d = useData<Cal>(() => rpc<Cal>('my_calendar', { p_from: from, p_to: to }), [from]);
  const byDay = useMemo(() => {
    const map = new Map<string, { t: number; e: number; due: number; overdue: boolean }>();
    const bump = (k: string, f: 't' | 'e' | 'due', od = false) => {
      const v = map.get(k) ?? { t: 0, e: 0, due: 0, overdue: false }; v[f]++; v.overdue ||= od; map.set(k, v);
    };
    d.data?.tasks.forEach(x => !x.done && bump(x.date, 't'));
    d.data?.events.forEach(x => bump(x.date, 'e'));
    d.data?.dues.forEach(x => bump(x.date, 'due', x.overdue));
    return map;
  }, [d.data]);
  const move = (k: number) => { const n = new Date(Date.UTC(y, m + k, 1)); setYm([n.getUTCFullYear(), n.getUTCMonth()]); };

  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try { await rpc('add_my_task', { p_title: title, p_date: sel, p_time: time || null }); setTitle(''); setTime(''); d.reload(); } finally { setBusy(false); }
  };
  const tasks = d.data?.tasks.filter(x => x.date === sel) ?? [];
  const events = d.data?.events.filter(x => x.date === sel) ?? [];
  const dues = d.data?.dues.filter(x => x.date === sel) ?? [];

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 font-semibold"><CalendarDays className="size-5 text-gold-700" /> تقويمي</span>
        <span className="flex items-center gap-1">
          <button onClick={() => move(-1)} className="rounded-lg p-1.5 hover:bg-canvas" aria-label="الشهر السابق"><ChevronRight className="size-4" /></button>
          <button onClick={() => { setYm([Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1]); setSel(t); }} className="min-w-32 text-center leading-tight">
            <span className="block text-sm font-medium">{MONTHS[m]} <span className="num-cell">{y}</span></span>
            <span className="block text-[10px] text-muted">{hijriSpan(from, to)}</span></button>
          <button onClick={() => move(1)} className="rounded-lg p-1.5 hover:bg-canvas" aria-label="الشهر التالي"><ChevronLeft className="size-4" /></button>
        </span>
      </div>
      <div className="grid gap-0 md:grid-cols-[1.15fr_1fr]">
        <div className="p-3">
          <div className="grid grid-cols-7 text-center text-[10.5px] text-muted">{DOW.map(x => <span key={x} className="py-1">{x}</span>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: lead }, (_, i) => <span key={'l' + i} />)}
            {Array.from({ length: days }, (_, i) => {
              const k = iso(y, m, i + 1), info = byDay.get(k), isT = k === t, isS = k === sel;
              return (
                <button key={k} onClick={() => setSel(k)}
                  className={clsx('relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition num-cell',
                    isS ? 'bg-brand-600 text-white shadow-sm' : isT ? 'bg-gold-100 font-semibold text-brand-700' : 'hover:bg-canvas')}>
                  <span className="leading-none">{i + 1}</span>
                  <span className={clsx('mt-0.5 text-[9px] leading-none', isS ? 'text-white/70' : 'text-muted')}>{hijri(hDay, k)}</span>
                  {info && <span className="absolute bottom-0.5 flex gap-0.5">
                    {info.e > 0 && <span className={clsx('size-1.5 rounded-full', isS ? 'bg-gold-300' : 'bg-gold-500')} />}
                    {info.due > 0 && <span className={clsx('size-1.5 rounded-full', info.overdue ? 'bg-neg' : isS ? 'bg-white' : 'bg-clay')} />}
                    {info.t > 0 && <span className={clsx('size-1.5 rounded-full', isS ? 'bg-brand-200' : 'bg-brand-500')} />}
                  </span>}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10.5px] text-muted">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-gold-500" />مناسبات الصندوق</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-clay" />مواعيد السداد</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-brand-500" />مهامي</span>
          </div>
        </div>

        <div className="border-t border-line bg-canvas/50 p-4 md:border-r md:border-t-0">
          <div className="mb-3"><div className="text-sm font-semibold">{dayName(sel)}</div>
            <div className="text-xs text-muted">{hijri(hFull, sel)} هـ</div></div>
          <ul className="space-y-2">
            {events.map(x => <li key={x.id}><a href="/member/events/" className="flex items-start gap-2.5 rounded-lg bg-surface p-2.5 text-sm shadow-xs hover:shadow-sm">
              <PartyPopper className="mt-0.5 size-4 shrink-0 text-gold-700" /><span className="min-w-0"><span className="block font-medium">{x.title}</span>
                <span className="block text-xs text-muted">{[x.time, x.location].filter(Boolean).join(' · ') || 'مناسبة الصندوق'}</span></span></a></li>)}
            {dues.map((x, i) => <li key={'d' + i} className={clsx('flex items-start gap-2.5 rounded-lg bg-surface p-2.5 text-sm', x.overdue && 'ring-1 ring-clay/40')}>
              <Wallet className={clsx('mt-0.5 size-4 shrink-0', x.overdue ? 'text-neg' : 'text-clay')} /><span className="min-w-0 flex-1"><span className="block font-medium">{x.title}</span>
                <span className="block text-xs text-muted">{x.overdue ? 'متأخر' : 'مستحق'}</span></span><span className="font-semibold num-cell">{sar(num(x.amount))}</span></li>)}
            {tasks.map(x => <li key={x.id} className="group flex items-center gap-2.5 rounded-lg bg-surface p-2.5 text-sm">
              <button onClick={async () => { await rpc('set_my_task_done', { p_id: x.id, p_done: !x.done }); d.reload(); }}
                className={clsx('flex size-5 shrink-0 items-center justify-center rounded-md border', x.done ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong')} aria-label="تم">
                {x.done && <Check className="size-3.5" />}</button>
              <span className={clsx('min-w-0 flex-1', x.done && 'text-muted line-through')}>{x.title}{x.time && <span className="ms-1 text-xs text-muted num-cell">{x.time}</span>}</span>
              <button onClick={async () => { await rpc('delete_my_task', { p_id: x.id }); d.reload(); }} className="text-muted opacity-60 hover:text-neg group-hover:opacity-100" aria-label="حذف"><Trash2 className="size-4" /></button>
            </li>)}
            {!events.length && !dues.length && !tasks.length && <li className="py-2 text-xs text-muted">لا شيء في هذا اليوم</li>}
          </ul>
          <div className="mt-3 flex gap-1.5">
            <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} maxLength={120}
              placeholder="أضف مهمة لهذا اليوم…" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-brand-400" />
            <input type="time" value={time} onChange={e => setTime(e.target.value)} className="h-9 w-[5.5rem] rounded-lg border border-line bg-surface px-1.5 text-xs outline-none" aria-label="الوقت" />
            <button onClick={add} disabled={busy || !title.trim()} className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white disabled:opacity-40" aria-label="إضافة"><Plus className="size-4" /></button>
          </div>
          <p className="mt-2 text-[10.5px] text-muted">مهامك خاصة بك — لا يراها أحد غيرك.</p>
        </div>
      </div>
    </Card>
  );
}
