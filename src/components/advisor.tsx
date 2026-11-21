'use client';
import clsx from 'clsx';
import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Eraser, Sparkles, X } from 'lucide-react';
import { sar, date as fmtDate, today } from '@/lib/format';
import { IS_DEMO, rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { Card, PageHeader } from './ui';

export type NajdAction = { kind: string; params: Record<string, any>; summary: string; state?: 'busy' | 'done' | 'error' | 'dismissed'; result?: string; href?: string };
type Msg = { role: 'user' | 'assistant'; content: string; pending?: boolean; error?: boolean; actions?: NajdAction[] };

const KIND: Record<string, string> = {
  task: 'مهمة في التقويم', goal: 'هدف ادخاري', goal_save: 'إضافة لهدف ادخاري', pf_tx: 'عملية في ماليتي',
  loan_request: 'طلب قرض', deposit_request: 'طلب إيداع', withdrawal_request: 'طلب سحب', loan_reschedule: 'طلب إعادة جدولة',
};
const LABEL: Record<string, string> = { title: 'العنوان', date: 'التاريخ', time: 'الوقت', note: 'ملاحظة', target: 'المبلغ المستهدف', amount: 'المبلغ',
  goal_title: 'الهدف', kind: 'النوع', category: 'التصنيف', purpose: 'الغرض', months: 'عدد الأقساط', mode: 'طريقة السداد', start: 'البداية',
  method: 'طريقة الإيداع', reason: 'السبب', loan_no: 'رقم القرض', count: 'عدد الأقساط' };
const show = (k: string, v: any) => k === 'amount' || k === 'target' ? sar(v) : k === 'date' || k === 'start' ? fmtDate(v)
  : k === 'kind' ? (v === 'income' ? 'دخل' : 'مصروف') : k === 'mode' ? (v === 'lump' ? 'دفعة كاملة' : 'أقساط شهرية') : String(v);

/** Runs a confirmed NAJD action with the user's own session — RLS and the RPC checks still decide. */
async function runAction(a: NajdAction): Promise<{ msg: string; href?: string }> {
  const p = a.params ?? {};
  const pf = async () => rpc<any>('pf_overview', { p_month: null });
  switch (a.kind) {
    case 'task': await rpc('add_my_task', { p_title: p.title, p_date: p.date ?? today(), p_time: p.time ?? null, p_note: p.note ?? null }); return { msg: 'أُضيفت للتقويم', href: '/member/' };
    case 'goal': await rpc('pf_add_goal', { p_title: p.title, p_target: String(p.target), p_date: p.date ?? null }); return { msg: 'أُضيف الهدف في ماليتي', href: '/member/finance/' };
    case 'goal_save': {
      const g = ((await pf()).goals ?? []).find((x: any) => x.title.includes(p.goal_title) || String(p.goal_title).includes(x.title));
      if (!g) throw new Error('ما لقيت هدف بهذا الاسم في ماليتي');
      await rpc('pf_goal_save', { p_id: g.id, p_amount: String(p.amount) }); return { msg: `أُضيف ${sar(p.amount)} لهدف «${g.title}»`, href: '/member/finance/' };
    }
    case 'pf_tx': {
      const kind = p.kind === 'income' ? 'income' : 'expense';
      const cat = p.category ? ((await pf()).categories ?? []).find((c: any) => c.kind === kind && (c.name === p.category || c.name.includes(p.category) || String(p.category).includes(c.name))) : null;
      await rpc('pf_add_tx', { p_kind: kind, p_amount: String(p.amount), p_category: cat?.id ?? null, p_date: p.date ?? today(), p_note: p.note ?? null });
      return { msg: 'سُجّلت في ماليتي', href: '/member/finance/' };
    }
    case 'loan_request': {
      const id = await rpc<string>('request_loan', { p_amount: String(p.amount), p_purpose: p.purpose ?? 'طلب عبر نَجْد', p_months: p.mode === 'lump' ? 1 : Number(p.months ?? 12),
        p_notes: 'قُدّم عبر نَجْد', p_mode: p.mode ?? 'installments', p_start: p.start ?? null });
      return { msg: 'أُرسل طلب القرض', href: `/member/loans/view/?id=${id}` };
    }
    case 'deposit_request': await rpc('request_deposit', { p_amount: String(p.amount), p_method: p.method ?? null, p_note: p.note ?? 'عبر نَجْد' }); return { msg: 'أُرسل طلب الإيداع', href: '/member/deposits/' };
    case 'withdrawal_request': await rpc('request_withdrawal', { p_amount: String(p.amount), p_reason: p.reason ?? null }); return { msg: 'أُرسل طلب السحب', href: '/member/withdrawals/' };
    case 'loan_reschedule': {
      const l = await q<any>(supabase().from('v_loan_summary').select('id').eq('loan_no', p.loan_no).maybeSingle());
      if (!l) throw new Error('ما لقيت القرض');
      const start = p.mode === 'lump' ? p.start : String(p.start ?? '').slice(0, 7) + '-01';
      await rpc('request_loan_reschedule', { p_loan: l.id, p_mode: p.mode ?? 'installments', p_start: start, p_count: p.mode === 'lump' ? 1 : Number(p.count ?? 12), p_note: p.note ?? null });
      return { msg: 'أُرسل طلب إعادة الجدولة لمدير الصندوق', href: `/member/loans/view/?id=${l.id}` };
    }
  }
  throw new Error('إجراء غير مدعوم');
}

function ActionCard({ a, onChange }: { a: NajdAction; onChange: (x: NajdAction) => void }) {
  const go = async () => {
    onChange({ ...a, state: 'busy' });
    try { const r = await runAction(a); onChange({ ...a, state: 'done', result: r.msg, href: r.href }); }
    catch (e: any) { onChange({ ...a, state: 'error', result: e.message ?? 'تعذر التنفيذ' }); }
  };
  const rows = Object.entries(a.params ?? {}).filter(([k, v]) => LABEL[k] && v !== null && v !== undefined && v !== '');
  return (
    <div className={clsx('mt-2 rounded-xl border bg-surface p-3 text-[13px]', a.state === 'done' ? 'border-pos/40' : a.state === 'dismissed' ? 'border-line opacity-60' : 'border-gold-300')}>
      <div className="text-[11px] font-semibold text-gold-700">{KIND[a.kind] ?? 'إجراء'}</div>
      <div className="mt-0.5 font-medium text-ink">{a.summary}</div>
      {rows.length > 0 && <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{LABEL[k]}</dt><dd className="font-medium">{show(k, v)}</dd></Fragment>)}</dl>}
      {a.state === 'done' ? <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-pos"><Check className="size-3.5" />{a.result}
          {a.href && <a href={a.href} className="ms-auto text-brand-600 hover:underline">فتح ←</a>}</div>
        : a.state === 'dismissed' ? <div className="mt-2 text-xs text-muted">تم التجاهل</div>
        : <>
          {a.state === 'error' && <div className="mt-2 text-xs text-neg">{a.result}</div>}
          <div className="mt-2.5 flex gap-2">
            <button onClick={go} disabled={a.state === 'busy'} className="flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white disabled:opacity-50">
              <Check className="size-3.5" />{a.state === 'busy' ? 'جارٍ التنفيذ…' : a.state === 'error' ? 'إعادة المحاولة' : 'تأكيد'}</button>
            <button onClick={() => onChange({ ...a, state: 'dismissed' })} className="h-8 rounded-lg px-3 text-xs text-muted hover:bg-canvas">تجاهل</button>
          </div></>}
    </div>
  );
}

/** Tracks the part of the screen the keyboard leaves visible (iOS / Android). */
function useVisualViewport(active: boolean) {
  const [vv, setVv] = useState<{ h: number; top: number; kb: boolean } | null>(null);
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const v = window.visualViewport;
    const f = () => v && setVv({ h: v.height, top: v.offsetTop, kb: window.innerHeight - v.height > 120 });
    f();
    v?.addEventListener('resize', f); v?.addEventListener('scroll', f);
    const html = document.documentElement, prev = [document.body.style.overflow, html.style.overflow];
    document.body.style.overflow = 'hidden'; html.style.overflow = 'hidden';
    return () => { v?.removeEventListener('resize', f); v?.removeEventListener('scroll', f); document.body.style.overflow = prev[0]; html.style.overflow = prev[1]; };
  }, [active]);
  return vv;
}

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
  const ta = useRef<HTMLTextAreaElement>(null);
  const grow = () => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px'; };
  useEffect(grow, [text]);
  const setAction = (mi: number, ai: number, x: NajdAction) => setMsgs(m => m.map((mm, i) => i !== mi ? mm : { ...mm, actions: mm.actions?.map((aa, j) => j === ai ? x : aa) }));
  useEffect(() => { if (hist.data) setMsgs(hist.data); }, [hist.data]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  const ask = async (question: string) => {
    const qn = question.trim();
    if (!qn || busy) return;
    setText(''); setBusy(true);
    setMsgs(m => [...m, { role: 'user', content: qn }, { role: 'assistant', content: '', pending: true }]);
    let answer = '', error = false, actions: NajdAction[] | undefined;
    try {
      if (IS_DEMO) {
        await new Promise(r => setTimeout(r, 900));
        answer = 'هذي نسخة تجريبية — نَجْد ما يتصل بالذكاء الاصطناعي هنا.\n\nفي المنصة الفعلية يقرأ أرقامك الحقيقية من الصندوق ويجاوبك عليها مباشرة، مثل:\n- **صافي رصيدك** وكم تقدر تطلب قرض بقبول تلقائي\n- **حساب القسط** لأي مبلغ ومدة\n- **مواعيدك القادمة** من التقويم\n\nويقدر يجهز لك طلبات — مثل هذا — وأنت تأكدها بضغطة:';
        actions = [{ kind: 'goal', summary: 'هدف ادخاري: سيارة جديدة', params: { title: 'سيارة جديدة', target: 20000, date: `${Number(today().slice(0, 4)) + 1}-12-31` } }];
      } else {
        const { data, error: e } = await (supabase() as any).functions.invoke('ai-advisor', { body: { message: qn } });
        if (e) { let m = e.message; try { const j = await e.context?.json?.(); if (j?.error) m = j.error; } catch { /* keep */ } throw new Error(m); }
        answer = data.answer; actions = data.actions?.length ? data.actions : undefined;
      }
    } catch (e: any) { answer = e.message ?? 'تعذر الاتصال بنَجْد'; error = true; }
    setMsgs(m => [...m.slice(0, -1), { role: 'assistant', content: answer, error, actions }]);
    setBusy(false);
  };
  const clear = async () => { await rpc('clear_my_ai_chat').catch(() => null); setMsgs([]); };

  if (!allowed) return <Card><p className="py-6 text-center text-sm text-muted">نَجْد | NAJD AI غير متاح للأعضاء حالياً.</p></Card>;
  return (
    <div className={clsx('flex flex-col overflow-hidden', compact ? 'h-full' : 'min-h-[60vh] rounded-xl border border-line bg-surface shadow-xs')}>
      {msgs.length > 0 && <div className="flex justify-end border-b border-line px-3 py-1.5">
        <button onClick={clear} className="flex items-center gap-1.5 text-xs text-muted hover:text-neg"><Eraser className="size-3.5" /> مسح المحادثة</button></div>}
      <div className={clsx('min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain', compact ? 'p-3' : 'p-4 sm:p-5')}>
        {!msgs.length && <div className={clsx('flex flex-col items-center text-center', compact ? 'py-4' : 'py-8')}>
          {!compact && <span className="shurfa mb-4 flex size-16 items-center justify-center rounded-2xl bg-brand-900 text-gold-300"><Sparkles className="size-7" /></span>}
          {!compact && <div className="text-[11px] font-semibold tracking-[0.25em] text-gold-600">NAJD AI</div>}
          <div className="mt-1 font-display text-lg font-semibold">أهلاً {profile?.full_name?.split(' ')[0]}، أنا نَجْد — مستشارك المالي</div>
          <p className="mt-1 max-w-md text-sm text-muted">اسألني عن أرقامك، أو اطلب مني أجهز لك مهمة أو هدف ادخاري أو طلب قرض أو إيداع — ما يتنفذ شي إلا بعد تأكيدك.</p>
          <div className={clsx('mt-5 grid w-full max-w-2xl gap-2', !compact && 'sm:grid-cols-2')}>
            {SUGGEST[role].map(sg => <button key={sg} onClick={() => ask(sg)} className="rounded-xl border border-line bg-canvas px-3 py-2.5 text-start text-sm hover:border-brand-200 hover:bg-brand-50">{sg}</button>)}
          </div>
        </div>}
        {msgs.map((m, i) => (
          <div key={i} className={clsx('flex gap-2.5', m.role === 'user' ? 'flex-row-reverse' : '')}>
            {m.role === 'assistant' && <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-900 text-gold-300"><Sparkles className="size-4" /></span>}
            <div className={clsx('min-w-0 max-w-[85%] break-words rounded-2xl px-4 py-2.5 text-sm', m.role === 'user' ? 'rounded-tl-md bg-brand-600 text-white' : m.error ? 'rounded-tr-md bg-clay/10 text-neg' : 'rounded-tr-md bg-canvas text-ink')}>
              {m.pending ? <span className="flex gap-1 py-1.5">{[0, 1, 2].map(k => <span key={k} className="size-1.5 animate-bounce rounded-full bg-brand-400" style={{ animationDelay: `${k * 120}ms` }} />)}</span>
                : m.role === 'assistant' ? <Md text={m.content} /> : <span className="whitespace-pre-wrap">{m.content}</span>}
              {m.actions?.map((a, ai) => <ActionCard key={ai} a={a} onChange={x => setAction(i, ai, x)} />)}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={e => { e.preventDefault(); ask(text); }} className="flex items-end gap-2 border-t border-line bg-surface px-3 py-2.5">
        <textarea ref={ta} value={text} onChange={e => setText(e.target.value)} rows={1} maxLength={2000} dir="auto" enterKeyHint="send"
          onFocus={() => setTimeout(() => end.current?.scrollIntoView({ block: 'end' }), 300)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); ask(text); } }}
          placeholder="اكتب لنَجْد…" className="min-h-11 flex-1 resize-none rounded-2xl border border-line bg-canvas px-4 py-2.5 text-base leading-6 outline-none transition focus:border-brand-400 focus:bg-surface sm:text-sm" />
        <button type="submit" disabled={busy || !text.trim()} onMouseDown={e => e.preventDefault()} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition active:scale-95 disabled:opacity-40" aria-label="إرسال"><ArrowUp className="size-5" /></button>
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
  const vv = useVisualViewport(open);
  const phone = typeof window !== 'undefined' && matchMedia('(max-width: 639px)').matches;
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
        <div className="no-print fixed inset-x-0 top-0 z-50 flex h-dvh items-end justify-end sm:items-end sm:p-5"
          style={phone && vv ? { top: vv.top, height: vv.h } : undefined}>
          <div className="absolute inset-0 bg-ink/30 sm:bg-transparent" onClick={() => setOpen(false)} />
          <div className={clsx('relative flex w-full flex-col overflow-hidden bg-surface shadow-2xl transition-[height] duration-150 sm:h-[600px] sm:max-h-[85dvh] sm:w-[400px] sm:rounded-2xl',
              vv?.kb && phone ? 'h-full' : 'h-[88%] rounded-t-2xl')}
            style={{ paddingBottom: vv?.kb ? 0 : 'env(safe-area-inset-bottom, 0px)', paddingTop: vv?.kb && phone ? 'env(safe-area-inset-top, 0px)' : undefined }}>
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
