'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { CalendarCheck2, Lock, LockOpen, FileText } from 'lucide-react';
import { go } from '@/lib/nav';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, dateTime, num, sar, today } from '@/lib/format';
import { Button, Card, ErrorBox, Field, Modal, Notice, PageHeader, Stat, Textarea } from '@/components/ui';

const QN = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
type P = { type: 'quarter' | 'year'; year: number; q?: number; start: string; end: string; label: string };
const qStart = (y: number, k: number) => `${y}-${String((k - 1) * 3 + 1).padStart(2, '0')}-01`;
const qEnd = (y: number, k: number) => new Date(Date.UTC(y, k * 3, 0)).toISOString().slice(0, 10);

export default function PeriodsPage() {
  const sb = supabase();
  const d = useData<any>(async () => {
    const [closes, first, st] = await Promise.all([
      q(sb.from('fiscal_closes').select('*').order('period_end', { ascending: false })),
      q(sb.from('v_transactions').select('tx_date').order('tx_date').limit(1)),
      q(sb.from('fund_settings').select('locked_through').eq('id', 1)),
    ]);
    return { closes, first: (first as any[])[0]?.tx_date ?? today(), locked: (st as any[])[0]?.locked_through ?? null };
  });
  const [act, setAct] = useState<{ p?: P; c?: any; mode: 'close' | 'reopen' | 'view' } | null>(null);
  if (!d.data) return null;
  const { closes, first, locked } = d.data as { closes: any[]; first: string; locked: string | null };
  const active = (type: string, start: string) => closes.find(c => c.status === 'closed' && c.period_type === type && c.period_start === start);
  const t = today();
  const years: number[] = [];
  for (let y = Number(t.slice(0, 4)); y >= Number(String(first).slice(0, 4)); y--) years.push(y);

  const cell = (p: P) => {
    const c = active(p.type, p.start);
    const ended = p.end < t;
    return (
      <button key={p.label} onClick={() => setAct(c ? { c, mode: 'view' } : ended ? { p, mode: 'close' } : null)} disabled={!c && !ended}
        className={clsx('flex flex-col items-start gap-1 rounded-xl border p-3 text-start transition',
          c ? 'border-brand-600 bg-brand-600 text-white' : ended ? 'border-gold-300 bg-gold-100/50 hover:bg-gold-100' : 'border-line bg-surface text-muted')}>
        <span className="flex w-full items-center justify-between text-sm font-medium">{p.type === 'year' ? 'السنة كاملة' : `الربع ${QN[(p.q ?? 1) - 1]}`}
          {c ? <Lock className="size-4 text-gold-300" /> : ended ? <LockOpen className="size-4 text-gold-700" /> : null}</span>
        <span className={clsx('text-[11px]', c ? 'text-brand-100' : 'text-muted')}>{c ? `مقفل ${date(c.closed_at)}` : ended ? 'جاهز للإقفال' : 'جارية'}</span>
      </button>
    );
  };

  return (
    <>
      <PageHeader title="الإقفال المالي" subtitle="إقفال الأرباع والسنوات: تُحفظ القوائم كما هي، ويُمنع تسجيل أي عملية بتاريخ داخل الفترة المقفلة" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="الدفاتر مقفلة حتى" value={locked ? date(locked) : 'لا يوجد إقفال'} tone="brand" icon={<Lock className="size-4" />} />
        <Stat label="فترات مقفلة" value={closes.filter(c => c.status === 'closed').length} />
      </div>
      <div className="space-y-4">
        {years.map(y => (
          <Card key={y} title={<span className="num">{y}</span>} actions={<Button size="sm" variant="secondary" icon={<FileText className="size-4" />} onClick={() => go(`/admin/reports/?r=fs&year=${y}`)}>القوائم المالية</Button>}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[1, 2, 3, 4].map(k => cell({ type: 'quarter', year: y, q: k, start: qStart(y, k), end: qEnd(y, k), label: `الربع ${QN[k - 1]} ${y}` }))}
              {cell({ type: 'year', year: y, start: `${y}-01-01`, end: `${y}-12-31`, label: `السنة المالية ${y}` })}
            </div>
          </Card>
        ))}
      </div>
      {closes.some(c => c.status === 'reopened') && <Card className="mt-4" title="سجل إعادة الفتح">
        <ul className="space-y-2 text-sm">{closes.filter(c => c.status === 'reopened').map(c => <li key={c.id} className="flex flex-wrap justify-between gap-2">
          <span>{c.period_label} — {c.reopen_note}</span><span className="text-xs text-muted">{dateTime(c.reopened_at)}</span></li>)}</ul>
      </Card>}
      <CloseModal act={act} onClose={() => setAct(null)} onDone={d.reload} />
    </>
  );
}

function CloseModal({ act, onClose, onDone }: { act: { p?: P; c?: any; mode: 'close' | 'reopen' | 'view' } | null; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const [note, setNote] = useState('');
  const [reopen, setReopen] = useState(false);
  const close = async () => {
    const p = act!.p!;
    const r = await a.run(() => rpc('close_fiscal_period', { p_type: p.type, p_year: p.year, p_quarter: p.q ?? null, p_note: note || null }).then(() => true), `تم إقفال ${p.label}`);
    if (r) { onDone(); onClose(); setNote(''); }
  };
  const doReopen = async () => {
    const r = await a.run(() => rpc('reopen_fiscal_period', { p_id: act!.c.id, p_note: note }).then(() => true), 'تمت إعادة فتح الفترة');
    if (r) { onDone(); onClose(); setNote(''); setReopen(false); }
  };
  const snap = act?.c?.snapshot;
  return (
    <Modal open={!!act} onClose={() => { onClose(); setReopen(false); }} title={act?.p?.label ?? act?.c?.period_label ?? ''}
      footer={act?.mode === 'close' ? <><Button onClick={close} loading={a.busy} icon={<Lock className="size-4" />}>إقفال الفترة</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>
        : reopen ? <><Button variant="danger" onClick={doReopen} loading={a.busy} disabled={note.trim().length < 3}>إعادة الفتح</Button><Button variant="secondary" onClick={() => setReopen(false)}>رجوع</Button></>
        : <><Button variant="secondary" icon={<LockOpen className="size-4" />} onClick={() => setReopen(true)}>إعادة فتح الفترة</Button><Button variant="secondary" onClick={onClose}>إغلاق</Button></>}>
      {act?.mode === 'close' && <>
        <Notice>بعد الإقفال تُحفظ نسخة من المركز المالي وقائمة الدخل والتدفقات النقدية وميزان المراجعة لهذه الفترة، ولن يُسمح بتسجيل أو عكس أي عملية بتاريخ حتى <b className="num">{date(act.p!.end)}</b> إلا بعد إعادة فتحها.</Notice>
        <Field label="ملاحظة (اختياري)" className="mt-3"><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      </>}
      {act?.c && !reopen && snap && <div className="space-y-3">
        <div className="text-xs text-muted">{date(act.c.period_start)} — {date(act.c.period_end)} · أُقفلت {dateTime(act.c.closed_at)}</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[['إجمالي الأصول', snap.balance_sheet?.total_assets], ['إجمالي الالتزامات', snap.balance_sheet?.total_liabilities], ['حقوق الأعضاء', snap.balance_sheet?.total_equity],
            ['إيرادات الفترة', snap.income_statement?.total_income], ['مصروفات الفترة', snap.income_statement?.total_expense], ['صافي فائض الفترة', snap.income_statement?.net_surplus],
            ['النقد أول الفترة', snap.cash_flow?.opening_cash], ['النقد آخر الفترة', snap.cash_flow?.closing_cash]].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-canvas px-3 py-2"><div className="text-[11px] text-muted">{k}</div><div className="font-semibold num">{sar(num(v))}</div></div>))}
        </div>
        {act.c.note && <p className="text-xs text-muted">ملاحظة: {act.c.note}</p>}
      </div>}
      {reopen && <>
        <Notice>إعادة الفتح تسمح بالتسجيل داخل الفترة من جديد، وتبقى النسخة المحفوظة في السجل. يُسجّل السبب في سجل التدقيق.</Notice>
        <Field label="سبب إعادة الفتح" className="mt-3"><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
      </>}
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
