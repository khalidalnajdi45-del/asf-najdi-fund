'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from 'lucide-react';
import { statusLabels, type Tone } from '@/lib/labels';
import { num, sar } from '@/lib/format';

// ---------------------------------------------------------------- buttons
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode;
};
export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
        variant === 'secondary' && 'bg-surface text-ink border border-line-strong hover:bg-canvas',
        variant === 'ghost' && 'text-ink-2 hover:bg-brand-50 hover:text-brand-700',
        variant === 'danger' && 'bg-surface text-neg border border-[#e8c9bb] hover:bg-[#f8ece6]',
        variant === 'gold' && 'bg-gold-500 text-brand-900 font-semibold hover:bg-gold-300',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- layout primitives
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {back && (
          <a href={back.href} className="mb-1 inline-flex items-center gap-1 text-[13px] text-muted hover:text-brand-600">
            <ChevronRight className="size-4" /> {back.label}
          </a>
        )}
        <h1 className="text-[24px] font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true, subtitle }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={clsx('print-area rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,20,0.04)]', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="no-print flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(pad && 'p-5')}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'neutral', icon, emphasize }: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'pos' | 'neg' | 'brand'; icon?: ReactNode; emphasize?: boolean;
}) {
  return (
    <div className={clsx('rounded-xl border p-3.5 sm:p-4', emphasize ? 'shurfa overflow-hidden border-brand-900 bg-brand-900 text-white' : 'border-line bg-surface')}>
      <div className={clsx('flex items-center justify-between text-[13px]', emphasize ? 'text-brand-100' : 'text-muted')}>
        <span>{label}</span>
        {icon && <span className={clsx(emphasize ? 'text-gold-300' : 'text-gold-500')}>{icon}</span>}
      </div>
      <div className={clsx('mt-2 text-[17px] font-semibold tracking-tight num sm:text-xl', emphasize && 'text-gold-100',
        !emphasize && tone === 'pos' && 'text-pos', !emphasize && tone === 'neg' && 'text-neg', !emphasize && tone === 'brand' && 'text-brand-700')}>
        {value}
      </div>
      {hint && <div className={clsx('mt-1 text-xs', emphasize ? 'text-brand-100' : 'text-muted')}>{hint}</div>}
    </div>
  );
}

const toneClass: Record<Tone, string> = {
  neutral: 'bg-[#f1ece4] text-[#5e5660] ring-line-strong',
  green: 'bg-[#eef3ef] text-[#3c5649] ring-[#c9d8cf]',
  amber: 'bg-gold-100 text-gold-700 ring-gold-300',
  red: 'bg-[#f8ece6] text-[#8c4f37] ring-[#e8c9bb]',
  blue: 'bg-[#eef1f6] text-[#3f4f6b] ring-[#ccd5e3]',
  violet: 'bg-brand-50 text-brand-700 ring-brand-200',
};
export function Tag({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', toneClass[tone])}>{children}</span>;
}
export function Badge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const [label, tone] = statusLabels[status] ?? [status, 'neutral'];
  return <Tag tone={tone}>{label}</Tag>;
}

// ---------------------------------------------------------------- forms
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-neg">{error}</span>}
    </label>
  );
}
const inputCls = 'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none disabled:bg-canvas';
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, 'h-10', props.className)} />;
}
export function Textarea(props: React.ComponentProps<'textarea'>) {
  return <textarea rows={3} {...props} className={clsx(inputCls, 'py-2', props.className)} />;
}
export function Select({ options, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...props} className={clsx(inputCls, 'h-10', props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
/** Money input: digits with up to 2 decimals; value kept as a string (never a float). */
export function MoneyInput({ value, onChange, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Input {...rest} dir="ltr" inputMode="decimal" value={value}
        onChange={e => { const v = e.target.value.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d.]/g, ''); if (/^\d*(\.\d{0,2})?$/.test(v)) onChange(v); }}
        className="pl-12 text-left num-cell" />
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted">ر.س</span>
    </div>
  );
}
export const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0;

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[#e8c9bb] bg-[#f8ece6] px-3 py-2.5 text-sm text-[#7f4630]">
      <AlertCircle className="mt-0.5 size-4 shrink-0" /> <div>{children}</div>
    </div>
  );
}
export function Notice({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'gold' }) {
  return (
    <div className={clsx('rounded-lg border px-3 py-2.5 text-sm',
      tone === 'brand' ? 'border-brand-100 bg-brand-50 text-brand-800' : 'border-gold-100 bg-gold-100/60 text-gold-700')}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- modal
export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={clsx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-canvas" aria-label="إغلاق"><X className="size-5" /></button>
        </header>
        <div className="space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-start gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- table
export type Column<T> = { key: string; header: ReactNode; render?: (row: T) => ReactNode; align?: 'start' | 'end'; className?: string; sortValue?: (row: T) => string | number };
export function DataTable<T extends Record<string, any>>({ columns, rows, empty = 'لا توجد بيانات', onRowClick, searchable, pageSize = 25, footer, loading, rowKey }: {
  columns: Column<T>[]; rows: T[] | null | undefined; empty?: ReactNode; onRowClick?: (r: T) => void; searchable?: (r: T) => string;
  pageSize?: number; footer?: ReactNode; loading?: boolean; rowKey?: (r: T, i: number) => string;
}) {
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const list = rows ?? [];
    if (!searchable || !term.trim()) return list;
    const t = term.trim().toLowerCase();
    return list.filter(r => searchable(r).toLowerCase().includes(t));
  }, [rows, term, searchable]);
  useEffect(() => setPage(0), [term, rows]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const view = filtered.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <div>
      {searchable && (
        <div className="no-print border-b border-line p-3">
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input value={term} onChange={e => setTerm(e.target.value)} placeholder="بحث…" className="pr-9" />
          </div>
        </div>
      )}
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas/60 text-[12px] text-muted">
              {columns.map(c => (
                <th key={c.key} className={clsx('px-4 py-2.5 font-medium whitespace-nowrap', c.align === 'end' ? 'text-left' : 'text-right', c.className)}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !rows && Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {columns.map(c => <td key={c.key} className="px-4 py-3"><div className="h-3.5 w-3/4 animate-pulse rounded bg-line" /></td>)}
              </tr>
            ))}
            {view.map((r, i) => (
              <tr key={rowKey ? rowKey(r, i) : (r.id ?? r.line_id ?? i)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={clsx('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-brand-50/50')}>
                {columns.map(c => (
                  <td key={c.key} className={clsx('px-4 py-3 align-middle', c.align === 'end' ? 'text-left num-cell' : 'text-right', c.className)}>
                    {c.render ? c.render(r) : (r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer}
        </table>
      </div>
      {!loading && filtered.length === 0 && <Empty>{empty}</Empty>}
      {pages > 1 && (
        <div className="no-print flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted">
          <span>{filtered.length} سجل</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronRight className="size-4" /></Button>
            <span>{page + 1} / {pages}</span>
            <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}><ChevronLeft className="size-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted">
      <Inbox className="size-6 text-line-strong" />
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="flex items-center justify-center py-16 text-muted"><Loader2 className="size-5 animate-spin" /></div>;
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: ReactNode; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="no-print mb-4 flex gap-1 overflow-x-auto border-b border-line scroll-thin">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={clsx('-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors',
            value === t.key ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-brand-50 px-1.5 text-[11px] font-semibold text-brand-700 num">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 border-b border-dashed border-line pb-2">
          <dt className="text-[13px] text-muted">{k}</dt>
          <dd className="text-sm font-medium text-ink">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- toasts
type ToastT = { id: number; kind: 'ok' | 'err'; text: string };
const ToastCtx = createContext<{ ok: (t: string) => void; err: (t: string) => void } | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const push = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = Date.now() + Math.random();
    setItems(x => [...x, { id, kind, text }]);
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  const api = useMemo(() => ({ ok: (t: string) => push('ok', t), err: (t: string) => push('err', t) }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="no-print fixed bottom-4 left-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map(t => (
          <div key={t.id} className={clsx('flex items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg',
            t.kind === 'ok' ? 'bg-brand-800 text-white' : 'bg-clay text-white')}>
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('ToastProvider missing');
  return c;
}

/** Signed profit / loss amount */
export function PL({ v }: { v: any }) {
  const n = num(v);
  return <span className={n > 0 ? 'text-pos' : n < 0 ? 'text-neg' : 'text-muted'}>{n === 0 ? '—' : sar(n, { sign: true })}</span>;
}
