'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { BookCheck, Pencil, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { dateTime, num, sar } from '@/lib/format';
import { marketOpen, refreshPrices } from '@/lib/market';
import { Button, Card, ErrorBox, Field, Input, Modal, MoneyInput, Notice, Tag, useToast } from './ui';

export type Holding = {
  id: string; investment_id: string; symbol: string; name: string; quantity: string; avg_cost: string; last_price: string | null;
  prev_close: string | null; price_at: string | null; cost_value: string; market_value: string; unrealized_pl: string;
  unrealized_pct: string | null; day_change: string | null; day_change_pct: string | null;
};

const price = (v: unknown) => (v === null || v === undefined ? '—' : num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qty = (v: unknown) => num(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
export function Chg({ v, p, className }: { v?: unknown; p?: unknown; className?: string }) {
  if (p === null || p === undefined) return <span className="text-muted">—</span>;
  const n = num(p), up = n > 0, dn = n < 0;
  return (
    <span dir="ltr" className={clsx('num-cell whitespace-nowrap', up && 'text-pos', dn && 'text-neg', !up && !dn && 'text-muted', className)}>
      {v !== undefined && v !== null && <>{num(v) > 0 ? '+' : ''}{price(v)} </>}
      <span className="text-[0.9em]">{n > 0 ? '+' : ''}{(n * 100).toFixed(2)}%</span>
    </span>
  );
}

/** Live holdings for an equity investment: edit positions, pull market prices, and book the value in the ledger. */
export function PortfolioCard({ p, onBooked }: { p: any; onBooked: () => void }) {
  const toast = useToast();
  const sb = supabase();
  const h = useData<Holding[]>(() => q(sb.from('v_portfolio_holdings').select('*').eq('investment_id', p.id).order('market_value', { ascending: false })), [p.id]);
  const [edit, setEdit] = useState<Partial<Holding> | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const [busy, setBusy] = useState<'' | 'prices' | 'book'>('');
  const rows = h.data ?? [];
  const cash = num(p.cash_balance);
  const mv = rows.reduce((t, r) => t + num(r.market_value), 0) + cash;
  const cost = rows.reduce((t, r) => t + num(r.cost_value), 0);
  const dayChg = rows.reduce((t, r) => t + num(r.day_change), 0);
  const prevMv = mv - dayChg;
  const pl = rows.reduce((t, r) => t + num(r.unrealized_pl), 0);
  const lastAt = rows.map(r => r.price_at).filter(Boolean).sort().pop();
  const bookGap = Math.round((mv - num(p.current_value)) * 100) / 100;

  const pull = async () => {
    setBusy('prices');
    try {
      const r = await refreshPrices(false);
      toast.ok(r.demo ? 'النسخة التجريبية: أسعار محاكاة' : `تم تحديث ${r.updated} سعر${r.failed.length ? ` — تعذر: ${r.failed.join('، ')}` : ''}`);
      h.reload();
    } catch (e: any) { toast.err(e?.message ?? 'تعذر تحديث الأسعار'); }
    finally { setBusy(''); }
  };
  const book = async () => {
    setBusy('book');
    try { await rpc('sync_portfolio_valuation', { p_inv: p.id }); toast.ok('تم ترحيل القيمة السوقية للدفاتر'); onBooked(); }
    catch (e: any) { toast.err(e?.message ?? 'تعذر الترحيل'); }
    finally { setBusy(''); }
  };

  return (
    <Card className="mt-4" pad={false}
      title={<span className="flex items-center gap-2">محفظة الأسهم {marketOpen() ? <Tag tone="green">السوق مفتوح</Tag> : <Tag>السوق مغلق</Tag>}</span>}
      subtitle={lastAt ? `آخر تحديث للأسعار ${dateTime(lastAt)} · تتحدث تلقائياً كل 15 دقيقة أثناء التداول` : 'الأسعار تتحدث تلقائياً كل 15 دقيقة أثناء التداول (الأحد–الخميس 10:00–15:00)'}
      actions={<div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<RefreshCw className={clsx('size-4', busy === 'prices' && 'animate-spin')} />} disabled={!!busy || !rows.length} onClick={pull}>تحديث الأسعار</Button>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>إضافة سهم</Button>
      </div>}>
      <ErrorBox>{h.error}</ErrorBox>
      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        <Fig label="القيمة السوقية (مع النقد)" value={sar(mv)} big />
        <Fig label="الربح اليومي" value={<Chg v={dayChg} p={prevMv > 0 ? dayChg / prevMv : null} />} />
        <Fig label="ربح/خسارة الأسهم" value={<Chg v={pl} p={cost > 0 ? pl / cost : null} />} />
        <Fig label="نقد في المحفظة" value={<button className="inline-flex items-center gap-1.5 hover:text-brand-700" onClick={() => setCashOpen(true)}>{sar(cash)}<Pencil className="size-3.5 text-muted" /></button>} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-canvas text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">السهم</th>
              <th className="px-3 py-2.5 text-end font-medium">الكمية</th>
              <th className="px-3 py-2.5 text-end font-medium">م. التكلفة</th>
              <th className="px-3 py-2.5 text-end font-medium">آخر سعر</th>
              <th className="px-3 py-2.5 text-end font-medium">التغير اليومي</th>
              <th className="px-3 py-2.5 text-end font-medium">القيمة السوقية</th>
              <th className="px-3 py-2.5 text-end font-medium">إجمالي الربح</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!rows.length && !h.loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">لا توجد أسهم بعد — أضف أسهم المحفظة بكمياتها ومتوسط تكلفتها</td></tr>}
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-canvas/60">
                <td className="px-4 py-2.5"><div className="font-medium text-ink">{r.name}</div><div className="text-xs text-muted num">{r.symbol}</div></td>
                <td className="px-3 py-2.5 text-end num-cell">{qty(r.quantity)}</td>
                <td className="px-3 py-2.5 text-end num-cell text-muted">{price(r.avg_cost)}</td>
                <td className="px-3 py-2.5 text-end num-cell font-medium">{price(r.last_price)}</td>
                <td className="px-3 py-2.5 text-end"><Chg p={r.day_change_pct} /></td>
                <td className="px-3 py-2.5 text-end num-cell">{price(r.market_value)}</td>
                <td className="px-3 py-2.5 text-end"><Chg v={r.unrealized_pl} p={r.unrealized_pct} /></td>
                <td className="px-2 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    <button aria-label="تعديل" title="تعديل" className="rounded p-1.5 text-muted hover:bg-brand-50 hover:text-brand-700" onClick={() => setEdit(r)}><Pencil className="size-4" /></button>
                    <DeleteBtn id={r.id} name={r.name} onDone={h.reload} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas px-4 py-3 text-sm">
          <span className="text-ink-2">
            القيمة في الدفاتر <bdi className="num font-semibold">{sar(p.current_value)}</bdi>
            {Math.abs(bookGap) >= 0.01
              ? <> · الفرق عن السوق <bdi className={bookGap > 0 ? 'text-pos' : 'text-neg'}>{sar(bookGap, { sign: true })}</bdi> — يُرحَّل تلقائياً بعد إغلاق السوق يومياً</>
              : <> · <span className="text-pos">مطابقة لقيمة السوق ✓</span></>}
          </span>
          <Button size="sm" variant="secondary" icon={<BookCheck className="size-4" />} loading={busy === 'book'} disabled={Math.abs(bookGap) < 0.01 || !!busy} onClick={book}>ترحيل التقييم للدفاتر الآن</Button>
        </div>
      )}

      {edit && <HoldingModal inv={p.id} h={edit} onClose={ok => { setEdit(null); if (ok) h.reload(); }} />}
      {cashOpen && <CashModal inv={p.id} cash={cash} onClose={ok => { setCashOpen(false); if (ok) onBooked(); }} />}
    </Card>
  );
}

function Fig({ label, value, big }: { label: string; value: React.ReactNode; big?: boolean }) {
  return <div className="bg-surface px-4 py-3"><div className="text-xs text-muted">{label}</div><div className={clsx('mt-1 font-semibold num', big ? 'text-xl text-ink' : 'text-base')}>{value}</div></div>;
}

function DeleteBtn({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const a = useAction();
  if (confirm) return (
    <span className="flex items-center gap-1 text-xs">
      <button className="rounded bg-neg px-2 py-1 text-white" onClick={async () => { if (await a.run(() => rpc('delete_holding', { p_id: id }).then(() => true), `تم حذف ${name}`)) onDone(); }}>حذف</button>
      <button className="px-1 text-muted" onClick={() => setConfirm(false)}>لا</button>
    </span>
  );
  return <button aria-label="حذف" title="حذف" className="rounded p-1.5 text-muted hover:bg-red-50 hover:text-neg" onClick={() => setConfirm(true)}><Trash2 className="size-4" /></button>;
}

function HoldingModal({ inv, h, onClose }: { inv: string; h: Partial<Holding>; onClose: (ok: boolean) => void }) {
  const a = useAction();
  const [f, setF] = useState({ symbol: h.symbol ?? '', name: h.name ?? '', quantity: h.quantity ? String(num(h.quantity)) : '', avg: h.avg_cost ? String(num(h.avg_cost)) : '' });
  const valid = /^[0-9A-Za-z.]{2,12}$/.test(f.symbol.trim()) && f.name.trim() && num(f.quantity) > 0 && /^\d+(\.\d{1,4})?$/.test(f.avg);
  const save = async () => {
    if (await a.run(() => rpc('upsert_holding', { p_inv: inv, p_symbol: f.symbol, p_name: f.name, p_quantity: f.quantity, p_avg_cost: f.avg }).then(() => true), 'تم حفظ السهم')) onClose(true);
  };
  return (
    <Modal open onClose={() => onClose(false)} title={h.id ? `تعديل ${h.name}` : 'إضافة سهم للمحفظة'}
      footer={<><Button onClick={save} loading={a.busy} disabled={!valid}>حفظ</Button><Button variant="secondary" onClick={() => onClose(false)}>إلغاء</Button></>}>
      <ErrorBox>{a.error}</ErrorBox>
      <Notice>الكمية ومتوسط التكلفة كما تظهر في تطبيق الوساطة. السعر يُجلب من السوق تلقائياً برمز السهم في تداول.</Notice>
      <div className="grid grid-cols-2 gap-3">
        <Field label="رمز السهم" hint="مثال: 2222 لأرامكو"><Input dir="ltr" inputMode="numeric" value={f.symbol} disabled={!!h.id} onChange={e => setF({ ...f, symbol: e.target.value })} /></Field>
        <Field label="اسم السهم"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="الكمية"><Input dir="ltr" inputMode="decimal" value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="متوسط التكلفة (ريال)"><Input dir="ltr" inputMode="decimal" value={f.avg} onChange={e => setF({ ...f, avg: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function CashModal({ inv, cash, onClose }: { inv: string; cash: number; onClose: (ok: boolean) => void }) {
  const a = useAction();
  const [v, setV] = useState(cash.toFixed(2));
  const save = async () => { if (await a.run(() => rpc('set_portfolio_cash', { p_inv: inv, p_cash: v }).then(() => true), 'تم تحديث النقد')) onClose(true); };
  return (
    <Modal open onClose={() => onClose(false)} title="النقد المتاح في المحفظة"
      footer={<><Button onClick={save} loading={a.busy} icon={<Wallet className="size-4" />}>حفظ</Button><Button variant="secondary" onClick={() => onClose(false)}>إلغاء</Button></>}>
      <ErrorBox>{a.error}</ErrorBox>
      <p className="text-sm text-ink-2">الرصيد النقدي غير المستثمر داخل حساب الوساطة. يدخل ضمن القيمة السوقية للمحفظة.</p>
      <Field label="المبلغ"><MoneyInput value={v} onChange={setV} /></Field>
    </Modal>
  );
}

