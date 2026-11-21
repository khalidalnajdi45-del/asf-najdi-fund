'use client';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Eraser, Sparkles, X } from 'lucide-react';
import { IS_DEMO, rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { Card, PageHeader } from './ui';

type Msg = { role: 'user' | 'assistant'; content: string; pending?: boolean; error?: boolean };

const SUGGEST = {
  manager: ['كيف وضع السيولة؟ وهل نقدر نصرف قرض 15 ألف؟', 'مين عليه متأخرات وكم؟ واكتب لي رسالة تذكير لطيفة', 'وش أكبر تركّز في محفظة الأسهم ونسبته؟', 'لخّص لي أداء الصندوق من بداية السنة'],
  member: ['كم صافي رصيدي؟ وكم أقدر آخذ قرض بقبول تلقائي؟', 'لو أخذت قرض 6,000 على 12 شهر كم القسط؟', 'وين أكثر شي صرفت فيه هالشهر؟', 'أبي أجمع 10 آلاف خلال سنة، كم أودع شهرياً؟'],
};

/** Minimal, safe markdown: paragraphs, **bold**, bullet lists, simple pipe tables. */
function Md({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p);
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      out.push(<div key={i} className="my-2 overflow-x-auto"><table className="w-full text-xs"><tbody>{rows.map((r, ri) => (
        <tr key={ri} className={ri === 0 ? 'bg-brand-50 font-semibold text-brand-700' : 'border-t border-line'}>{r.map((c, ci) => <td key={ci} className="px-2 py-1.5">{bold(c)}</td>)}</tr>))}</tbody></table></div>);
    } else if (/^([-•*]|\d+[.)])\s/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^([-•*]|\d+[.)])\s/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^([-•*]|\d+[.)])\s/, '')); i++; }
      i--;
      out.push(<ul key={i} className="my-1.5 list-inside list-disc space-y-1">{items.map((x, k) => <li key={k}>{bold(x)}</li>)}</ul>);
    } else if (/^#{1,4}\s/.test(l)) out.push(<div key={i} className="mt-2 font-semibold text-brand-700">{bold(l.replace(/^#+\s/, ''))}</div>);
    else out.push(<p key={i} className="my-1">{bold(l)}</p>);
  }
  return <div className="leading-7">{out}</div>;
}

/** The chat itself — used by the NAJD page and by the floating NAJD bubble on every page. */
export function AdvisorChat({ compact = false }: { compact?: boolean }) {
  const { profile, fund } = useAuth();
  const role = profile?.role === 'manager' ? 'manager' : 'member';
  const allowed = role === 'manager' || !!fund?.ai_members_enabled;
  const hist = useData<Msg[]>(() => profile ? q(supabase().from('ai_messages').select('role, content').eq('user_id', profile.id).order('created_at').limit(60)) : Promise.resolve([]), [profile?.id]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (hist.data) setMsgs(hist.data); }, [hist.data]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  const ask = async (question: string) => {
    const qn = question.trim();
    if (!qn || busy) return;
    setText(''); setBusy(true);
    setMsgs(m => [...m, { role: 'user', content: qn }, { role: 'assistant', content: '', pending: true }]);
    let answer = '', error = false;
    try {
      if (IS_DEMO) {
        await new Promise(r => setTimeout(r, 900));
        answer = 'هذي نسخة تجريبية — نَجْد ما يتصل بالذكاء الاصطناعي هنا.\n\nفي المنصة الفعلية يقرأ أرقامك الحقيقية من الصندوق ويجاوبك عليها مباشرة، مثل:\n- **صافي رصيدك** وكم تقدر تطلب قرض بقبول تلقائي\n- **حساب القسط** لأي مبلغ ومدة\n- **مواعيدك القادمة** من التقويم';
      } else {
        const { data, error: e } = await (supabase() as any).functions.invoke('ai-advisor', { body: { message: qn } });
        if (e) { let m = e.message; try { const j = await e.context?.json?.(); if (j?.error) m = j.error; } catch { /* keep */ } throw new Error(m); }
        answer = data.answer;
      }
    } catch (e: any) { answer = e.message ?? 'تعذر الاتصال بنَجْد'; error = true; }
    setMsgs(m => [...m.slice(0, -1), { role: 'assistant', content: answer, error }]);
    setBusy(false);
  };
  const clear = async () => { await rpc('clear_my_ai_chat').catch(() => null); setMsgs([]); };

  if (!allowed) return <Card><p className="py-6 text-center text-sm text-muted">نَجْد | NAJD AI غير متاح للأعضاء حالياً.</p></Card>;
  return (
    <div className={clsx('flex flex-col overflow-hidden', compact ? 'h-full' : 'min-h-[60vh] rounded-xl border border-line bg-surface shadow-xs')}>
      {msgs.length > 0 && <div className="flex justify-end border-b border-line px-3 py-1.5">
        <button onClick={clear} className="flex items-center gap-1.5 text-xs text-muted hover:text-neg"><Eraser className="size-3.5" /> مسح المحادثة</button></div>}
      <div className={clsx('flex-1 space-y-4 overflow-y-auto', compact ? 'p-3' : 'p-4 sm:p-5')}>
        {!msgs.length && <div className={clsx('flex flex-col items-center text-center', compact ? 'py-4' : 'py-8')}>
          {!compact && <span className="shurfa mb-4 flex size-16 items-center justify-center rounded-2xl bg-brand-900 text-gold-300"><Sparkles className="size-7" /></span>}
          {!compact && <div className="text-[11px] font-semibold tracking-[0.25em] text-gold-600">NAJD AI</div>}
          <div className="mt-1 font-display text-lg font-semibold">أهلاً {profile?.full_name?.split(' ')[0]}، أنا نَجْد — مستشارك المالي</div>
          <p className="mt-1 max-w-md text-sm text-muted">وش ودك تعرف؟ أقرأ البيانات فقط ولا أنفذ أي عملية، والأرقام من سجلاتك مباشرة.</p>
          <div className={clsx('mt-5 grid w-full max-w-2xl gap-2', !compact && 'sm:grid-cols-2')}>
            {SUGGEST[role].map(sg => <button key={sg} onClick={() => ask(sg)} className="rounded-xl border border-line bg-canvas px-3 py-2.5 text-start text-sm hover:border-brand-200 hover:bg-brand-50">{sg}</button>)}
          </div>
        </div>}
        {msgs.map((m, i) => (
          <div key={i} className={clsx('flex gap-2.5', m.role === 'user' ? 'flex-row-reverse' : '')}>
            {m.role === 'assistant' && <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-900 text-gold-300"><Sparkles className="size-4" /></span>}
            <div className={clsx('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm', m.role === 'user' ? 'rounded-tl-md bg-brand-600 text-white' : m.error ? 'rounded-tr-md bg-clay/10 text-neg' : 'rounded-tr-md bg-canvas text-ink')}>
              {m.pending ? <span className="flex gap-1 py-1.5">{[0, 1, 2].map(k => <span key={k} className="size-1.5 animate-bounce rounded-full bg-brand-400" style={{ animationDelay: `${k * 120}ms` }} />)}</span>
                : m.role === 'assistant' ? <Md text={m.content} /> : <span className="whitespace-pre-wrap">{m.content}</span>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={e => { e.preventDefault(); ask(text); }} className="flex items-end gap-2 border-t border-line bg-surface p-3">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={1} maxLength={2000}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }}
          placeholder="اكتب سؤالك…" className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2.5 text-base outline-none focus:border-brand-400 sm:text-sm" />
        <button type="submit" disabled={busy || !text.trim()} className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white disabled:opacity-40" aria-label="إرسال"><ArrowUp className="size-5" /></button>
      </form>
    </div>
  );
}

export function AdvisorPage() {
  const { profile } = useAuth();
  const role = profile?.role === 'manager' ? 'manager' : 'member';
  return (
    <>
      <PageHeader title={<span className="flex items-baseline gap-2">نَجْد <span className="font-sans text-base font-semibold tracking-[0.18em] text-gold-600">NAJD AI</span></span>}
        subtitle={<><span className="font-medium text-ink">مستشارك المالي</span> — {role === 'manager' ? 'اسأل عن السيولة، القروض، المتأخرات، المحفظة والقوائم من أرقام الصندوق الفعلية' : 'اسأل عن حسابك وقروضك وميزانيتك ومواعيدك — يقرأ أرقامك أنت فقط'}</>} />
      <AdvisorChat />
      <p className="mt-3 text-[11px] text-muted">إجابات نَجْد للمساعدة والتوضيح وليست استشارة استثمارية مرخصة. القرارات النهائية لإدارة الصندوق.</p>
    </>
  );
}

/** Floating NAJD bubble — on every page, opens the chat in a sheet. */
export function NajdFab({ hidden }: { hidden?: boolean }) {
  const { profile, fund } = useAuth();
  const [open, setOpen] = useState(false);
  const allowed = profile?.role === 'manager' || !!fund?.ai_members_enabled;
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [open]);
  if (!allowed || hidden) return null;
  return (
    <>
      <button onClick={() => setOpen(o => !o)} aria-label="نَجْد — مستشارك المالي"
        className={clsx('najd-fab no-print fixed z-40 flex size-14 items-center justify-center rounded-full bg-brand-900 text-gold-300 shadow-lg ring-2 ring-gold-500/60 transition hover:scale-105 active:scale-95',
          open && 'scale-90 opacity-0 pointer-events-none')}>
        <Sparkles className="size-6" />
        <span className="absolute -bottom-1 rounded-full bg-gold-500 px-1.5 text-[8.5px] font-bold tracking-wider text-brand-900">NAJD</span>
      </button>
      {open && (
        <div className="no-print fixed inset-0 z-50 flex items-end justify-end sm:items-end sm:p-5">
          <div className="absolute inset-0 bg-ink/30 sm:bg-transparent" onClick={() => setOpen(false)} />
          <div className="relative flex h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:h-[600px] sm:max-h-[85dvh] sm:w-[400px] sm:rounded-2xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <div className="shurfa flex items-center gap-3 bg-brand-900 px-4 py-3 text-white">
              <span className="flex size-9 items-center justify-center rounded-xl bg-white/10 text-gold-300"><Sparkles className="size-5" /></span>
              <span className="flex-1 leading-tight"><span className="block font-semibold">نَجْد <span className="ms-1 text-[10px] font-semibold tracking-[0.2em] text-gold-300">NAJD AI</span></span>
                <span className="block text-[11px] text-brand-200">مستشارك المالي</span></span>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-brand-100 hover:bg-white/10" aria-label="إغلاق"><X className="size-5" /></button>
            </div>
            <div className="min-h-0 flex-1"><AdvisorChat compact /></div>
          </div>
        </div>
      )}
    </>
  );
}
