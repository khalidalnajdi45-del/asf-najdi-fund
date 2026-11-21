'use client';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { CalendarClock, CalendarRange, Check, Wallet, X } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, monthLabel, sar, today } from '@/lib/format';
import { Button, Card, ErrorBox, Field, Input, Modal, Notice, Tag, Textarea } from './ui';
import { Avatar } from './admin-viz';
import { useSettings } from '@/lib/settings';

export type Plan = { mode: 'installments' | 'lump'; month: string; day: string; count: string };
type Preview = { total: string; start: string; due_day: number; min_installment: string; monthly_cap?: string | null; rows: { seq: number; due: string; amount: string }[] };

const ym = (offset: number) => {
  const [y, m] = today().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
};
const addMonths = (d: string, k: number) => {
  const [y, m, dd] = d.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1 + k, dd));
  return x.toISOString().slice(0, 10);
};
export const blankPlan = (count = 12): Plan => ({ mode: 'installments', month: ym(1), day: addMonths(today(), 1), count: String(count) });
export const planArgs = (p: Plan) => ({ p_mode: p.mode, p_start: p.mode === 'lump' ? p.day : `${p.month}-01`, p_count: p.mode === 'lump' ? 1 : Number(p.count) });
export const planReady = (p: Plan) => p.mode === 'lump' ? !!p.day && p.day > today() : !!p.month && Number(p.count) >= 1;

/** Installments from a chosen month (on the fund's due day) or one full payment on a chosen date — with a live schedule preview. */
export function PlanPicker({ value, onChange, amount, loan, maxMonths = 24, admin }: {
  value: Plan; onChange: (p: Plan) => void; amount?: string; loan?: string; maxMonths?: number; admin?: boolean;
}) {
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ready = planReady(value) && (loan || Number(amount) > 0);
  useEffect(() => {
    if (!ready) { setPv(null); return; }
    let alive = true;
    const t = setTimeout(() => rpc<Preview>('loan_plan_preview', { p_amount: amount ?? '0', ...planArgs(value), p_loan: loan ?? null })
      .then(r => { if (alive) { setPv(r); setErr(null); } }).catch(e => alive && setErr(String(e.message ?? e))), 250);
    return () => { alive = false; clearTimeout(t); };
  }, [value.mode, value.month, value.day, value.count, amount, loan]); // eslint-disable-line
  const rows = pv?.rows ?? [];
  const per = rows.length > 1 ? rows[0].amount : null;
  const set = (x: Partial<Plan>) => onChange({ ...value, ...x });
  const { data: s } = useSettings();
  const maxDay = addMonths(today(), admin ? 120 : 12);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {([['installments', 'أقساط شهرية', CalendarRange], ['lump', 'دفعة كاملة', Wallet]] as const).map(([k, l, I]) => (
          <button key={k} type="button" onClick={() => set({ mode: k })}
            className={clsx('flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition',
              value.mode === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-surface text-ink-2 hover:border-brand-300')}>
            <I className="size-4" />{l}</button>))}
      </div>
      {value.mode === 'installments' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="يبدأ السداد من شهر" hint={pv ? `يوم ${pv.due_day} من كل شهر` : undefined}>
            <Input type="month" dir="ltr" min={ym(admin ? 0 : 1)} max={ym(admin ? 120 : 12)} value={value.month} onChange={e => set({ month: e.target.value })} /></Field>
          <Field label="عدد الأقساط" hint={pv ? `الحد الأدنى للقسط ${sar(pv.min_installment)}` : undefined}>
            <Input type="number" dir="ltr" min={1} max={admin ? 120 : maxMonths} value={value.count} onChange={e => set({ count: e.target.value })} /></Field>
        </div>
      ) : (
        <Field label="تاريخ الدفعة الكاملة" hint={admin ? undefined : 'خلال 12 شهراً من اليوم'}>
          <Input type="date" dir="ltr" min={addMonths(today(), 0)} max={maxDay} value={value.day} onChange={e => set({ day: e.target.value })} /></Field>
      )}
      {err ? <ErrorBox>{err}</ErrorBox> : pv && rows.length > 0 && (
        <div className="rounded-xl border border-line bg-canvas p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{value.mode === 'lump' ? 'دفعة واحدة' : <><span className="num">{rows.length}</span> قسط{per && <> × <span className="num-cell font-semibold">{sar(per)}</span></>}</>}</span>
            <span className="text-xs text-muted">{date(rows[0].due)}{rows.length > 1 && <> ← {date(rows[rows.length - 1].due)}</>}</span>
          </div>
          {value.mode === 'installments' && Number(value.count) > rows.length && <p className="mt-1 text-xs text-gold-700">عُدّل العدد إلى <span className="num">{rows.length}</span> حتى لا يقل القسط عن {sar(pv.min_installment)}</p>}
          {value.mode === 'installments' && Number(value.count) < rows.length && <p className="mt-1 text-xs text-gold-700">عُدّل العدد إلى <span className="num">{rows.length}</span> حتى لا يتجاوز مجموع أقساطك الشهرية {sar(pv.monthly_cap)}</p>}
          {admin && s?.loan_member_monthly_cap && per && Number(per) > Number(s.loan_member_monthly_cap) && <p className="mt-1 text-xs text-gold-700">القسط أعلى من حد العضو الشهري ({sar(s.loan_member_monthly_cap)}) — مسموح لك كمدير</p>}
          {rows.length > 1 && <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {rows.map(r => <span key={r.seq} className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-ink-2 ring-1 ring-line"><span className="num">{date(r.due)}</span> · <span className="num-cell">{sar(r.amount)}</span></span>)}
          </div>}
        </div>
      )}
    </div>
  );
}

/** Member asks to reschedule (pending until approval); the manager reschedules directly. */
export function RescheduleModal({ open, loan, admin, onClose, onDone }: { open: boolean; loan: any; admin: boolean; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const [p, setP] = useState<Plan>(blankPlan(12));
  const [note, setNote] = useState('');
  const submit = async () => {
    const r = await a.run(() => rpc(admin ? 'admin_reschedule_loan' : 'request_loan_reschedule',
      { p_loan: loan.id, ...planArgs(p), p_note: note || null }).then(() => true),
      admin ? 'تم تحديث جدول الأقساط' : 'تم إرسال طلب إعادة الجدولة');
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title={admin ? 'إعادة جدولة القرض' : 'طلب إعادة جدولة'}
      footer={<><Button onClick={submit} loading={a.busy} disabled={!planReady(p)}>{admin ? 'اعتماد الجدول الجديد' : 'إرسال الطلب'}</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <Notice>المتبقي على القرض <span className="num-cell font-semibold">{sar(loan.outstanding)}</span> — {admin ? 'يتغير الجدول فوراً ويُشعَر العضو.' : 'جدولك الحالي يبقى سارياً حتى يوافق مدير الصندوق.'}</Notice>
      <PlanPicker value={p} onChange={setP} loan={loan.id} admin={admin} />
      <Field label={admin ? 'ملاحظة' : 'سبب الطلب (اختياري)'}><Textarea value={note} onChange={e => setNote(e.target.value)} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}

const planText = (r: any) => r.mode === 'lump' ? <>دفعة كاملة بتاريخ <span className="num">{date(r.start_date)}</span></>
  : <><span className="num">{r.installments}</span> قسط ابتداءً من <span className="num">{date(r.start_date)}</span></>;

/** Pending reschedule request on the loan page: member can withdraw it, the manager decides. */
export function ReschedulePanel({ loan, admin, onChange }: { loan: any; admin: boolean; onChange: () => void }) {
  const a = useAction();
  const d = useData<any[]>(() => q(supabase().from('loan_reschedule_requests').select('*').eq('loan_id', loan.id).order('created_at', { ascending: false }).limit(5)), [loan.id]);
  const [note, setNote] = useState('');
  const rows = d.data ?? [];
  const pend = rows.find(r => r.status === 'pending');
  const last = rows.find(r => r.status !== 'pending' && r.status !== 'cancelled');
  if (!pend && !last) return null;
  const act = async (fn: () => Promise<any>, ok: string) => { const r = await a.run(() => fn().then(() => true), ok); if (r) { d.reload(); onChange(); } };
  return (
    <div className={clsx('mt-3 rounded-2xl border p-4 text-sm', pend ? 'border-gold-300 bg-gold-100/50' : 'border-line bg-surface')}>
      {pend ? <>
        <div className="flex items-center gap-2 font-semibold text-gold-700"><CalendarClock className="size-4" />طلب إعادة جدولة بانتظار {admin ? 'قرارك' : 'موافقة مدير الصندوق'}</div>
        <p className="mt-1 text-ink-2">{planText(pend)}{pend.note && <> — «{pend.note}»</>}</p>
        <p className="mt-0.5 text-xs text-muted">أُرسل {date(pend.created_at)} · الجدول الحالي ساري حتى القرار</p>
        {admin ? <div className="mt-3 space-y-2">
          <Input placeholder="ملاحظة للعضو (اختياري)" value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Check className="size-4" />} loading={a.busy} onClick={() => act(() => rpc('decide_loan_reschedule', { p_id: pend.id, p_approve: true, p_note: note || null }), 'تمت الموافقة وتحديث الجدول')}>موافقة</Button>
            <Button size="sm" variant="danger" icon={<X className="size-4" />} loading={a.busy} onClick={() => act(() => rpc('decide_loan_reschedule', { p_id: pend.id, p_approve: false, p_note: note || null }), 'تم رفض الطلب')}>رفض</Button>
          </div></div>
          : <button className="mt-2 text-xs text-neg hover:underline" onClick={() => act(() => rpc('cancel_loan_reschedule', { p_id: pend.id }), 'تم سحب الطلب')}>سحب الطلب</button>}
      </> : <div className="flex items-center gap-2 text-ink-2">
        <Tag tone={last.status === 'approved' ? 'green' : 'red'}>{last.status === 'approved' ? 'أُعيدت الجدولة' : 'رُفض طلب الجدولة'}</Tag>
        <span className="text-xs">{planText(last)} · {date(last.decided_at)}{last.decision_note ? ` · ${last.decision_note}` : ''}</span></div>}
      <ErrorBox>{a.error}</ErrorBox>
    </div>
  );
}

/** Manager board section: all pending reschedule requests. */
export function RescheduleRequests() {
  const d = useData<any[]>(async () => {
    const reqs = await q<any[]>(supabase().from('loan_reschedule_requests').select('*').eq('status', 'pending').order('created_at'));
    if (!reqs.length) return [];
    const loans = await q<any[]>(supabase().from('v_loan_summary').select('id, loan_no, member_name, outstanding, next_due_date').in('id', reqs.map(r => r.loan_id)));
    return reqs.map(r => ({ ...r, loan: loans.find(l => l.id === r.loan_id) }));
  });
  const rows = d.data ?? [];
  if (!rows.length) return null;
  return (
    <section className="mb-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold-700"><CalendarClock className="size-4" />طلبات إعادة الجدولة <span className="rounded-full bg-gold-100 px-2 text-xs num">{rows.length}</span></h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(r => (
          <a key={r.id} href={`/admin/loans/view/?id=${r.loan_id}`} className="flex items-center gap-3 rounded-xl border border-gold-300 bg-surface p-3 transition hover:border-gold-500">
            <Avatar name={r.loan?.member_name ?? ''} size={34} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.loan?.member_name} <span className="num text-xs text-muted">{r.loan?.loan_no}</span></span>
              <span className="block text-xs text-ink-2">{planText(r)}</span></span>
            <span className="text-end text-xs"><span className="block font-semibold num-cell">{sar(r.loan?.outstanding)}</span><span className="text-brand-600">مراجعة ←</span></span>
          </a>))}
      </div>
    </section>
  );
}

/** Manager: spread every member's open loans over N months from a start month — within the monthly cap, loans one after another. */
export function BulkRescheduleModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const nextJan = `${Number(today().slice(0, 4)) + 1}-01`;
  const [f, setF] = useState({ month: nextJan, count: '12' });
  const [pv, setPv] = useState<any[] | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const { data: s } = useSettings();
  const start = f.month ? `${f.month}-${String(s?.loan_due_day ?? 28).padStart(2, '0')}` : '';
  useEffect(() => {
    if (!open || !start || !(Number(f.count) > 0)) return;
    let alive = true;
    rpc<any[]>('bulk_reschedule_preview', { p_start: start, p_count: Number(f.count) })
      .then(r => { if (alive) { setPv(r); a.setError(null); } }).catch(e => alive && a.setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [open, start, f.count]); // eslint-disable-line
  const chosen = (pv ?? []).filter(m => !skip.has(m.member_id));
  const total = chosen.reduce((x, m) => x + Number(m.outstanding), 0);
  const monthly = chosen.reduce((x, m) => x + Number(m.months?.[0]?.amount ?? 0), 0);
  const cap = s?.loan_member_monthly_cap;
  const submit = async () => {
    const ids = chosen.flatMap(m => m.loans.map((l: any) => l.id));
    const n = await a.run(() => rpc<number>('bulk_reschedule_apply', { p_start: start, p_count: Number(f.count), p_loans: ids }), 'تمت جدولة القروض');
    if (n !== undefined) { onDone(); onClose(); }
  };
  return (
    <Modal wide open={open} onClose={onClose} title="جدولة جماعية للقروض القائمة"
      footer={<><Button onClick={submit} loading={a.busy} disabled={!chosen.length || !start}>اعتماد جدولة {chosen.length} عضو</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="أول قسط في شهر"><Input type="month" dir="ltr" min={ym(0)} value={f.month} onChange={e => setF({ ...f, month: e.target.value })} /></Field>
        <Field label="عدد الأشهر المستهدف"><Input type="number" dir="ltr" min={1} max={120} value={f.count} onChange={e => setF({ ...f, count: e.target.value })} /></Field>
      </div>
      <Notice>المتبقي يتقسم من <b className="num">{start ? date(start) : monthLabel(f.month)}</b>{cap ? <> — مجموع أقساط العضو لا يتجاوز <b className="num-cell">{sar(cap)}</b> شهرياً، فقد تطول المدة لبعض الأعضاء</> : null}. من عنده أكثر من قرض يسدد الأقدم أولاً ثم الذي بعده. المسدد سابقاً يبقى محسوباً، ويوصل كل عضو إشعار بجدوله.</Notice>
      {pv && <div className="grid grid-cols-3 gap-2 rounded-xl bg-canvas p-3 text-center text-sm">
        <div><div className="text-[11px] text-muted">الأعضاء</div><div className="font-semibold num">{chosen.length}</div></div>
        <div><div className="text-[11px] text-muted">إجمالي المتبقي</div><div className="font-semibold num-cell">{sar(total)}</div></div>
        <div><div className="text-[11px] text-muted">تحصيل شهري متوقع</div><div className="font-semibold num-cell text-brand-700">{sar(monthly)}</div></div>
      </div>}
      <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
        {(pv ?? []).map(m => {
          const off = skip.has(m.member_id), months = m.months ?? [];
          const last = months[months.length - 1]?.due;
          return (
            <label key={m.member_id} className={clsx('flex cursor-pointer items-start gap-3 rounded-xl border p-2.5 text-sm transition', off ? 'border-line opacity-50' : 'border-brand-200 bg-surface')}>
              <input className="mt-1" type="checkbox" checked={!off} onChange={() => setSkip(x => { const y = new Set(x); off ? y.delete(m.member_id) : y.add(m.member_id); return y; })} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.member_name}</span>
                <span className="block text-xs text-muted">{m.loans.map((l: any, i: number) => <span key={l.id}>{i > 0 && ' ← '}<span className="num">{l.loan_no}</span> ({l.rows?.length ?? 0} قسط)</span>)}</span>
                <span className="block text-xs text-muted">حتى {date(last)}</span></span>
              <span className="text-end"><span className="block num-cell font-semibold">{sar(m.outstanding)}</span>
                <span className="block text-xs text-brand-700"><span className="num">{months.length}</span> × <span className="num-cell">{sar(months[0]?.amount)}</span></span></span>
            </label>);
        })}
        {pv && !pv.length && <p className="py-6 text-center text-sm text-muted">لا توجد قروض قائمة</p>}
      </div>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
