'use client';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, ClipboardPaste, Flag, Landmark, Lock, MessageSquareText, Pause, Play, Plus, Repeat, Settings2, Smartphone, Sparkles, Target, Trash2, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { CommitmentModal, Commitments, Forecast, SettingsModal, ShortcutModal, ZakatCard, ZakatModal, type Ov2 } from './extras';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date, num, sar, today } from '@/lib/format';
import { parseMany, type ParsedSms } from '@/lib/bank-sms';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, MoneyInput, PageHeader, Select, isMoney, useToast } from '@/components/ui';

type Cat = { id: string; kind: 'income' | 'expense'; name: string; color: string };
type Tx = { id: string; kind: 'income' | 'expense'; amount: string; category_id: string | null; category: string | null; color: string | null; note: string | null; date: string; source: string };
type Ov = {
  month: string; categories: Cat[]; income: string; expense: string;
  by_category: { category_id: string | null; name: string; color: string; spent: string; budget: string | null }[];
  transactions: Tx[]; trend: { month: string; income: string; expense: string }[];
  recurring: { id: string; kind: string; amount: string; category_id: string | null; category: string | null; note: string | null; day: number; active: boolean }[];
  goals: { id: string; title: string; target: string; saved: string; target_date: string | null }[];
  fund_due: { contribution: string; installments: string } | null;
} & Ov2;

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const mLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m: string, k: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, Number(m.slice(8, 10)))); return d.toISOString().slice(0, 10); };
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
/** Label a salary cycle by the month it mostly covers. */
const cycleMonth = (start: string) => { const d = new Date(Date.parse(start) + 15 * 86400000).toISOString(); return mLabel(d); };

export default function MyFinance() {
  const { profile, fund } = useAuth();
  const toast = useToast();
  const [month, setMonth] = useState(today());
  const d = useData<Ov>(() => rpc<Ov>('pf_overview', { p_month: month }), [month]);
  const [modal, setModal] = useState<null | 'tx' | 'sms' | 'budget' | 'goal' | 'rec' | 'settings' | 'commit' | 'zakat' | 'shortcut'>(null);
  const [txKind, setTxKind] = useState<'income' | 'expense'>('expense');
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast.ok(ok); d.reload(); } catch (e: any) { toast.err(e.message); }
  };

  if (d.error) return <ErrorBox>{d.error}</ErrorBox>;
  if (!d.data) return <Loading />;
  const o = d.data;
  const inc = num(o.income), exp = num(o.expense), saved = inc - exp;
  const rate = inc > 0 ? Math.round((saved / inc) * 100) : null;
  const cy = o.cycle, isCur = cy.start <= today() && today() <= cy.end;
  const calendar = Number(o.settings?.payday ?? 27) === 1;
  const cycleTitle = calendar ? mLabel(cy.start) : `${cycleMonth(cy.start)} · ${dm(cy.start)} – ${dm(cy.end)}`;
  const fundDue = o.fund_due ? num(o.fund_due.contribution) + num(o.fund_due.installments) : 0;
  const fundCat = o.categories.find(c => c.kind === 'expense' && c.name === 'التزامات الصندوق');

  return (
    <>
      <PageHeader title="ماليتي" subtitle={<span className="flex items-center gap-1.5"><Lock className="size-3.5" /> دخلك ومصاريفك وميزانيتك وأهدافك — خاصة بك وحدك، لا يراها مدير الصندوق</span>}
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Settings2 className="size-4" />} onClick={() => setModal('settings')}>الإعدادات</Button>
          <Button variant="secondary" icon={<ClipboardPaste className="size-4" />} onClick={() => setModal('sms')}>الصق رسالة البنك</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => { setTxKind('expense'); setModal('tx'); }}>إضافة عملية</Button>
        </div>} />

      {/* hero */}
      <div className="shurfa relative mb-5 overflow-hidden rounded-2xl bg-brand-900 p-5 text-white sm:p-6">
        <div className="pointer-events-none absolute -left-20 -top-20 size-56 rounded-full bg-gold-500/15 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <button onClick={() => setMonth(shiftMonth(cy.start, -1))} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="الشهر السابق"><ChevronRight className="size-5" /></button>
          <button onClick={() => setMonth(today())} className="text-center leading-tight"><span className="block text-sm font-medium text-brand-100">{cycleTitle}</span>
            {!calendar && <span className="block text-[10px] text-brand-300">دورة الراتب — يوم {o.settings?.payday}</span>}
            {!isCur && <span className="block text-[11px] text-gold-300">العودة للشهر الحالي</span>}</button>
          <button onClick={() => setMonth(shiftMonth(cy.start, 1))} className="rounded-lg p-1.5 hover:bg-white/10" aria-label="الشهر التالي"><ChevronLeft className="size-5" /></button>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-[1fr_1fr_1fr_1.3fr] sm:gap-5">
          <div><div className="text-xs text-brand-200">الدخل</div><div className="mt-1 text-base font-semibold num-cell sm:text-2xl">{sar(inc)}</div></div>
          <div className="border-s border-white/10 ps-3 sm:ps-5"><div className="text-xs text-brand-200">المصروف</div><div className="mt-1 text-base font-semibold num-cell text-[#f0b59c] sm:text-2xl">{sar(exp)}</div></div>
          <div className="border-s border-white/10 ps-3 sm:ps-5">
            <div className="text-xs text-brand-200">الادخار</div>
            <div className={clsx('mt-1 text-base font-semibold num-cell sm:text-2xl', saved >= 0 ? 'text-gold-300' : 'text-[#f0b59c]')}>{sar(saved)}</div>
            <div className="mt-1 text-[11px] text-brand-200 sm:text-xs">{rate === null ? 'سجّل دخلك لحساب النسبة' : <>نسبة الادخار <b className="num-cell text-white">{rate}%</b></>}</div>
          </div>
          <Trend data={o.trend} cur={cy.start} />
        </div>
      </div>

      {isCur && <Forecast o={o} />}

      {o.fund_due && fundDue > 0 && isCur && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold-300 bg-gold-100/50 px-4 py-3 text-sm">
        <span className="flex items-center gap-2"><Wallet className="size-4 text-gold-700" />التزاماتك للصندوق هذا الشهر
          <b className="num-cell">{sar(fundDue)}</b>
          <span className="text-xs text-muted">(اشتراك {sar(o.fund_due.contribution)} · أقساط {sar(o.fund_due.installments)})</span></span>
        <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => run(() => rpc('pf_add_tx', { p_kind: 'expense', p_amount: String(fundDue), p_category: fundCat?.id ?? null, p_date: today(), p_note: 'اشتراك وأقساط الصندوق' }), 'سُجلت كمصروف')}>سجّلها كمصروف</button>
      </div>}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="المصاريف حسب التصنيف" actions={<button onClick={() => setModal('budget')} className="text-xs text-brand-600 hover:underline">الميزانيات</button>}>
          <Spending rows={o.by_category} total={exp} onBudget={() => setModal('budget')} />
        </Card>
        <Card className="lg:col-span-2" title="أهدافي" actions={<button onClick={() => setModal('goal')} className="flex items-center gap-1 text-xs text-brand-600 hover:underline"><Plus className="size-3.5" />هدف</button>}>
          <Goals goals={o.goals} run={run} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" pad={false} title={`عمليات ${calendar ? mLabel(cy.start) : cycleMonth(cy.start)}`} actions={<span className="flex gap-3 text-xs">
          <button onClick={() => { setTxKind('income'); setModal('tx'); }} className="text-brand-600 hover:underline">+ دخل</button>
          <button onClick={() => { setTxKind('expense'); setModal('tx'); }} className="text-brand-600 hover:underline">+ مصروف</button></span>}>
          <TxList rows={o.transactions} onDelete={id => run(() => rpc('pf_delete_tx', { p_id: id }), 'حُذفت')} />
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title="التزاماتي الشهرية" actions={<button onClick={() => setModal('commit')} className="flex items-center gap-1 text-xs text-brand-600 hover:underline"><Plus className="size-3.5" />التزام</button>}>
            <Commitments o={o} run={run} />
          </Card>
          <ZakatCard o={o} onOpen={() => setModal('zakat')} />
          <Card title="المتكرر شهرياً" actions={<button onClick={() => setModal('rec')} className="flex items-center gap-1 text-xs text-brand-600 hover:underline"><Plus className="size-3.5" />إضافة</button>}>
            <Recurring rows={o.recurring} run={run} />
          </Card>
          {(fund?.ai_members_enabled || profile?.role === 'manager') && <a href="/member/advisor/" className="shurfa relative block overflow-hidden rounded-2xl bg-brand-900 p-4 text-white">
            <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-gold-300"><Sparkles className="size-5" /></span>
              <span><span className="block text-[10px] font-semibold tracking-[0.2em] text-gold-300">NAJD AI</span><span className="block font-semibold">اسأل نَجْد عن مصاريفك</span></span></div>
            <p className="mt-2 text-xs text-brand-200">«وين أكثر شي صرفت هالشهر؟» · «كم أقدر أوفر شهرياً لهدفي؟»</p>
          </a>}
        </div>
      </div>

      <TxModal open={modal === 'tx'} kind={txKind} setKind={setTxKind} cats={o.categories} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />
      <SmsModal open={modal === 'sms'} cats={o.categories} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />
      <BudgetModal open={modal === 'budget'} ov={o} onClose={() => setModal(null)} onSaved={() => d.reload()} />
      <GoalModal open={modal === 'goal'} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />
      <SettingsModal open={modal === 'settings'} o={o} onClose={() => setModal(null)} onSaved={() => d.reload()} onShortcut={() => setModal('shortcut')} />
      <CommitmentModal open={modal === 'commit'} cats={o.categories} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />
      <ZakatModal open={modal === 'zakat'} o={o} onClose={() => setModal(null)} onSaved={() => d.reload()} />
      <ShortcutModal open={modal === 'shortcut'} o={o} onClose={() => setModal(null)} onSaved={() => d.reload()} />
      <RecModal open={modal === 'rec'} cats={o.categories} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />
    </>
  );
}

function Trend({ data, cur }: { data: Ov['trend']; cur: string }) {
  const max = Math.max(1, ...data.flatMap(x => [num(x.income), num(x.expense)]));
  return (
    <div className="col-span-3 sm:col-span-1 sm:border-s sm:border-white/10 sm:ps-5">
      <div className="text-xs text-brand-200">آخر ٦ أشهر</div>
      <div className="mt-2 flex h-16 items-end gap-2">
        {data.map(x => <div key={x.month} className="flex flex-1 flex-col items-center gap-1" title={`${cycleMonth(x.month)} — دخل ${sar(x.income)} · مصروف ${sar(x.expense)}`}>
          <div className="flex h-12 w-full items-end justify-center gap-0.5">
            <span className="w-1/2 max-w-2 rounded-t-sm bg-gold-300" style={{ height: `${(num(x.income) / max) * 100}%` }} />
            <span className="w-1/2 max-w-2 rounded-t-sm bg-[#f0b59c]" style={{ height: `${(num(x.expense) / max) * 100}%` }} />
          </div>
          <span className={clsx('text-[9px]', x.month === cur ? 'text-white' : 'text-brand-300')}>{cycleMonth(x.month).split(' ')[0].slice(0, 3)}</span>
        </div>)}
      </div>
    </div>
  );
}

function Spending({ rows, total, onBudget }: { rows: Ov['by_category']; total: number; onBudget: () => void }) {
  const R = 40, C = 2 * Math.PI * R;
  let off = 0;
  if (!rows.length) return <div className="py-8 text-center text-sm text-muted">لا توجد مصاريف لهذا الشهر بعد.<br /><button onClick={onBudget} className="mt-2 text-brand-600 hover:underline">حدّد ميزانية شهرية لتصنيفاتك</button></div>;
  return (
    <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
      <div className="relative mx-auto size-36">
        <svg viewBox="0 0 100 100" className="size-36 -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--color-canvas)" strokeWidth="12" />
          {total > 0 && rows.filter(r => num(r.spent) > 0).map((r, i) => { const L = (num(r.spent) / total) * C; const el = <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={r.color} strokeWidth="12" strokeDasharray={`${L} ${C}`} strokeDashoffset={-off} />; off += L; return el; })}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[10px] text-muted">المصروف</span><span className="text-lg font-semibold leading-tight num-cell">{Math.round(total).toLocaleString('en-US')}</span><span className="text-[10px] text-muted">ريال</span></span>
      </div>
      <ul className="min-w-0 space-y-2.5 text-sm">
        {rows.map(r => {
          const s = num(r.spent), b = r.budget ? num(r.budget) : null, pct = b ? Math.min(100, (s / b) * 100) : null, over = b !== null && s > b;
          return <li key={r.name}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} /><span className="truncate">{r.name}</span></span>
              <span className="shrink-0 text-xs"><b className={clsx('num-cell', over && 'text-neg')}>{sar(s)}</b>{b !== null && <span className="text-muted"> / <span className="num-cell">{sar(b)}</span></span>}</span>
            </div>
            {pct !== null && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas"><div className={clsx('h-full rounded-full', over ? 'bg-neg' : pct > 80 ? 'bg-clay' : 'bg-brand-500')} style={{ width: `${pct}%` }} /></div>}
          </li>;
        })}
      </ul>
    </div>
  );
}

function Goals({ goals, run }: { goals: Ov['goals']; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [add, setAdd] = useState<Record<string, string>>({});
  if (!goals.length) return <div className="py-6 text-center text-sm text-muted"><Target className="mx-auto mb-2 size-7 text-gold-500" />حط لك هدف — سيارة، زواج، سفرة، دفعة بيت…</div>;
  return (
    <ul className="space-y-4">
      {goals.map(g => {
        const t = num(g.target), s = num(g.saved), pct = Math.min(100, (s / t) * 100);
        const months = g.target_date ? Math.max(1, Math.round((new Date(g.target_date).getTime() - Date.now()) / (30.44 * 86400000))) : null;
        const perMonth = months && t > s ? (t - s) / months : null;
        return <li key={g.id} className="group">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-1.5 font-medium"><Flag className="size-4 text-gold-600" />{g.title}</span>
            <button onClick={() => run(() => rpc('pf_delete_goal', { p_id: g.id }))} className="text-muted opacity-50 hover:text-neg group-hover:opacity-100" aria-label="حذف"><Trash2 className="size-3.5" /></button>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-gradient-to-l from-gold-500 to-gold-300" style={{ width: `${pct}%` }} /></div>
          <div className="mt-1 flex justify-between text-xs text-muted"><span className="num-cell">{sar(s)} من {sar(t)}</span><span className="num-cell">{Math.round(pct)}%</span></div>
          {perMonth && <div className="mt-0.5 text-[11px] text-muted">تحتاج <b className="num-cell text-ink">{sar(perMonth)}</b> شهرياً للوصول بحلول {date(g.target_date)}</div>}
          <div className="mt-2 flex items-center gap-1.5">
            <input value={add[g.id] ?? ''} onChange={e => setAdd({ ...add, [g.id]: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" placeholder="أضف مبلغ"
              className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-xs outline-none focus:border-brand-400 num-cell" />
            <button disabled={!isMoney(add[g.id] ?? '')} onClick={() => run(async () => { await rpc('pf_goal_save', { p_id: g.id, p_amount: add[g.id] }); setAdd({ ...add, [g.id]: '' }); })}
              className="h-8 rounded-lg bg-brand-600 px-2.5 text-xs text-white disabled:opacity-40">ادّخار</button>
            <a href="/member/deposits/new/" className="ms-auto text-[11px] text-brand-600 hover:underline">أودعها في الصندوق ←</a>
          </div>
        </li>;
      })}
    </ul>
  );
}

function TxList({ rows, onDelete }: { rows: Tx[]; onDelete: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Tx[]>();
    rows.forEach(r => m.set(r.date, [...(m.get(r.date) ?? []), r]));
    return [...m.entries()];
  }, [rows]);
  if (!rows.length) return <div className="py-10 text-center text-sm text-muted">لا توجد عمليات في هذا الشهر.<br /><span className="text-xs">جرّب «الصق رسالة البنك» — ننسخ رسائل الشراء ونسجلها دفعة وحدة.</span></div>;
  return (
    <div className="divide-y divide-line">
      {groups.map(([day, list]) => <div key={day}>
        <div className="bg-canvas/60 px-4 py-1.5 text-[11px] text-muted num-cell">{date(day)}</div>
        <ul>{list.map(t => <li key={t.id} className="group flex items-center gap-3 px-4 py-2.5 text-sm">
          <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', t.kind === 'income' ? 'bg-brand-50 text-brand-700' : 'bg-canvas')} style={t.kind === 'expense' && t.color ? { color: t.color } : undefined}>
            {t.kind === 'income' ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.note || t.category || (t.kind === 'income' ? 'دخل' : 'مصروف')}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted">{t.category ?? 'بدون تصنيف'}
              {t.source === 'sms' && <MessageSquareText className="size-3" aria-label="من رسالة البنك" />}{t.source === 'recurring' && <Repeat className="size-3" aria-label="متكرر" />}</span></span>
          <span className={clsx('font-semibold num-cell', t.kind === 'income' ? 'text-pos' : '')}>{t.kind === 'income' ? '+' : '−'}{sar(t.amount)}</span>
          <button onClick={() => onDelete(t.id)} className="text-muted opacity-40 hover:text-neg group-hover:opacity-100" aria-label="حذف"><Trash2 className="size-4" /></button>
        </li>)}</ul>
      </div>)}
    </div>
  );
}

function Recurring({ rows, run }: { rows: Ov['recurring']; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  if (!rows.length) return <p className="text-sm text-muted">الراتب، الإيجار، الفواتير الثابتة… أضفها مرة وتنسجل تلقائياً كل شهر.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map(r => <li key={r.id} className={clsx('flex items-center gap-2', !r.active && 'opacity-50')}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-canvas text-[11px] font-semibold num-cell">{r.day}</span>
        <span className="min-w-0 flex-1 truncate">{r.note || r.category || (r.kind === 'income' ? 'دخل' : 'مصروف')}</span>
        <span className={clsx('num-cell', r.kind === 'income' && 'text-pos')}>{r.kind === 'income' ? '+' : '−'}{sar(r.amount)}</span>
        <button onClick={() => run(() => rpc('pf_set_recurring_active', { p_id: r.id, p_active: !r.active }))} className="text-muted hover:text-brand-600" aria-label={r.active ? 'إيقاف' : 'تشغيل'}>{r.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button>
        <button onClick={() => run(() => rpc('pf_delete_recurring', { p_id: r.id }))} className="text-muted hover:text-neg" aria-label="حذف"><Trash2 className="size-3.5" /></button>
      </li>)}
    </ul>
  );
}

// ---------------------------------------------------------------- modals
const catOptions = (cats: Cat[], kind: string) => cats.filter(c => c.kind === kind).map(c => ({ value: c.id, label: c.name }));
function KindToggle({ kind, setKind }: { kind: 'income' | 'expense'; setKind: (k: 'income' | 'expense') => void }) {
  return <div className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1 text-sm">
    {(['expense', 'income'] as const).map(k => <button key={k} type="button" onClick={() => setKind(k)} className={clsx('rounded-lg py-2 font-medium', kind === k ? 'bg-surface shadow-sm' : 'text-muted')}>{k === 'expense' ? 'مصروف' : 'دخل'}</button>)}
  </div>;
}

function TxModal({ open, kind, setKind, cats, onClose, onSaved }: { open: boolean; kind: 'income' | 'expense'; setKind: (k: 'income' | 'expense') => void; cats: Cat[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(''), [cat, setCat] = useState(''), [day, setDay] = useState(today()), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await rpc('pf_add_tx', { p_kind: kind, p_amount: amount, p_category: cat || null, p_date: day, p_note: note || null }); setAmount(''); setNote(''); setCat(''); toast.ok('تمت الإضافة'); onSaved(); }
    catch (e: any) { toast.err(e.message); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="إضافة عملية" footer={<Button loading={busy} disabled={!isMoney(amount)} onClick={save}>حفظ</Button>}>
    <KindToggle kind={kind} setKind={k => { setKind(k); setCat(''); }} />
    <Field label="المبلغ"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
    <Field label="التصنيف"><Select value={cat} onChange={e => setCat(e.target.value)} options={catOptions(cats, kind)} placeholder="اختر التصنيف" /></Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="التاريخ"><Input type="date" value={day} onChange={e => setDay(e.target.value)} /></Field>
      <Field label="ملاحظة"><Input value={note} onChange={e => setNote(e.target.value)} maxLength={160} placeholder="اختياري" /></Field>
    </div>
  </Modal>;
}

function SmsModal({ open, cats, onClose, onSaved }: { open: boolean; cats: Cat[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<(ParsedSms & { on: boolean; cat: string })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const byName = (n: string | null, kind: string) => cats.find(c => c.kind === kind && c.name === n)?.id ?? '';
  const read = () => {
    const p = parseMany(text);
    if (!p.length) { toast.err('ما قدرت أقرأ مبلغ من الرسالة — تأكد إنها رسالة عملية من البنك'); return; }
    setRows(p.map(x => ({ ...x, on: true, cat: byName(x.guess, x.kind) })));
  };
  const save = async () => {
    setBusy(true);
    try {
      for (const r of rows!.filter(r => r.on)) await rpc('pf_add_tx', { p_kind: r.kind, p_amount: String(r.amount), p_category: r.cat || null, p_date: r.date ?? today(), p_note: r.merchant, p_source: 'sms' });
      toast.ok(`سُجلت ${rows!.filter(r => r.on).length} عملية`); setText(''); setRows(null); onSaved();
    } catch (e: any) { toast.err(e.message); } finally { setBusy(false); }
  };
  const close = () => { setRows(null); onClose(); };
  return <Modal open={open} onClose={close} wide title="الصق رسالة البنك"
    footer={rows ? <><Button loading={busy} disabled={!rows.some(r => r.on)} onClick={save}>تسجيل {rows.filter(r => r.on).length} عملية</Button><Button variant="secondary" onClick={() => setRows(null)}>رجوع</Button></>
      : <Button disabled={!text.trim()} onClick={read}>قراءة الرسائل</Button>}>
    {!rows ? <>
      <p className="text-sm text-muted">انسخ رسالة أو أكثر من رسائل البنك (شراء، سداد، حوالة، راتب) والصقها هنا — افصل بين الرسائل بسطر فاضي. القراءة تتم على جهازك فقط، والرسالة نفسها ما تنحفظ.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={8} dir="auto" autoFocus
        placeholder={'شراء عبر نقاط البيع\nبطاقة: 1234 ;مدى\nمبلغ: SAR 45.50\nلدى: STARBUCKS\nفي: 2026-11-20 14:22'}
        className="w-full rounded-xl border border-line bg-canvas p-3 text-sm outline-none focus:border-brand-400" />
    </> : <ul className="space-y-2">
      {rows.map((r, i) => <li key={i} className={clsx('rounded-xl border p-3', r.on ? 'border-line bg-surface' : 'border-dashed border-line opacity-50')}>
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={r.on} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} className="size-4 accent-brand-600" />
          <span className={clsx('font-semibold num-cell', r.kind === 'income' ? 'text-pos' : '')}>{r.kind === 'income' ? '+' : '−'}{sar(r.amount)}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{r.merchant ?? (r.kind === 'income' ? 'دخل' : 'مصروف')}</span>
          <span className="text-xs text-muted num-cell">{date(r.date ?? today())}</span>
        </div>
        <div className="mt-2 flex gap-2">
          <select value={r.kind} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, kind: e.target.value as any, cat: '' } : x))} className="h-8 rounded-lg border border-line bg-surface px-2 text-xs">
            <option value="expense">مصروف</option><option value="income">دخل</option></select>
          <select value={r.cat} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, cat: e.target.value } : x))} className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-xs">
            <option value="">بدون تصنيف</option>{catOptions(cats, r.kind).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
        </div>
      </li>)}
    </ul>}
  </Modal>;
}

function BudgetModal({ open, ov, onClose, onSaved }: { open: boolean; ov: Ov; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const current = useMemo(() => Object.fromEntries(ov.by_category.filter(b => b.category_id && b.budget).map(b => [b.category_id!, String(num(b.budget))])), [ov]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [newCat, setNewCat] = useState('');
  const v = (id: string) => vals[id] ?? current[id] ?? '';
  const save = async () => {
    try {
      for (const [id, val] of Object.entries(vals)) if (val !== (current[id] ?? '')) await rpc('pf_set_budget', { p_category: id, p_limit: val || '0' });
      setVals({}); toast.ok('حُفظت الميزانيات'); onSaved(); onClose();
    } catch (e: any) { toast.err(e.message); }
  };
  const total = ov.categories.filter(c => c.kind === 'expense').reduce((a, c) => a + num(v(c.id) || 0), 0);
  return <Modal open={open} onClose={onClose} title="الميزانية الشهرية" footer={<Button onClick={save}>حفظ</Button>}>
    <p className="text-sm text-muted">حدّد سقف شهري لكل تصنيف (اتركه فاضي بدون سقف). الإجمالي: <b className="num-cell text-ink">{sar(total)}</b></p>
    <ul className="space-y-2">
      {ov.categories.filter(c => c.kind === 'expense').map(c => <li key={c.id} className="flex items-center gap-2 text-sm">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} /><span className="flex-1">{c.name}</span>
        <input value={v(c.id)} onChange={e => setVals({ ...vals, [c.id]: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" placeholder="—"
          className="h-8 w-28 rounded-lg border border-line bg-surface px-2 text-sm outline-none focus:border-brand-400 num-cell" />
      </li>)}
    </ul>
    <div className="flex gap-2 border-t border-line pt-3">
      <Input value={newCat} onChange={e => setNewCat(e.target.value)} maxLength={40} placeholder="تصنيف جديد…" />
      <Button variant="secondary" disabled={!newCat.trim()} onClick={async () => { try { await rpc('pf_add_category', { p_kind: 'expense', p_name: newCat }); setNewCat(''); onSaved(); } catch (e: any) { toast.err(e.message); } }}>إضافة</Button>
    </div>
  </Modal>;
}

function GoalModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(''), [target, setTarget] = useState(''), [by, setBy] = useState('');
  const save = async () => {
    try { await rpc('pf_add_goal', { p_title: title, p_target: target, p_date: by || null }); setTitle(''); setTarget(''); setBy(''); onSaved(); }
    catch (e: any) { toast.err(e.message); }
  };
  return <Modal open={open} onClose={onClose} title="هدف ادخاري جديد" footer={<Button disabled={!title.trim() || !isMoney(target)} onClick={save}>إضافة</Button>}>
    <Field label="الهدف"><Input value={title} onChange={e => setTitle(e.target.value)} maxLength={60} placeholder="مثلاً: سيارة جديدة" autoFocus /></Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="المبلغ المستهدف"><MoneyInput value={target} onChange={setTarget} /></Field>
      <Field label="بحلول" hint="اختياري"><Input type="date" value={by} onChange={e => setBy(e.target.value)} /></Field>
    </div>
  </Modal>;
}

function RecModal({ open, cats, onClose, onSaved }: { open: boolean; cats: Cat[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState(''), [cat, setCat] = useState(''), [day, setDay] = useState('27'), [note, setNote] = useState('');
  const save = async () => {
    try { await rpc('pf_add_recurring', { p_kind: kind, p_amount: amount, p_category: cat || null, p_day: Number(day), p_note: note || null }); setAmount(''); setNote(''); setCat(''); onSaved(); }
    catch (e: any) { toast.err(e.message); }
  };
  return <Modal open={open} onClose={onClose} title="عملية متكررة شهرياً" footer={<Button disabled={!isMoney(amount)} onClick={save}>إضافة</Button>}>
    <KindToggle kind={kind} setKind={k => { setKind(k); setCat(''); }} />
    <div className="grid grid-cols-2 gap-3">
      <Field label="المبلغ"><MoneyInput value={amount} onChange={setAmount} /></Field>
      <Field label="يوم الشهر" hint="من 1 إلى 28"><Input type="number" min={1} max={28} value={day} onChange={e => setDay(e.target.value)} /></Field>
    </div>
    <Field label="التصنيف"><Select value={cat} onChange={e => setCat(e.target.value)} options={catOptions(cats, kind)} placeholder="اختر التصنيف" /></Field>
    <Field label="الوصف"><Input value={note} onChange={e => setNote(e.target.value)} maxLength={120} placeholder={kind === 'income' ? 'الراتب' : 'إيجار الشقة'} /></Field>
  </Modal>;
}
