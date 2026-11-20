'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { go } from '@/lib/nav';
import { CalendarClock, ChevronDown, ChevronLeft, CircleCheck, HandCoins, Plus, TriangleAlert } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date, num, sar, today } from '@/lib/format';
import { frequencyLabels, statusLabels } from '@/lib/labels';
import { Badge, Button, Card, Empty, Loading, PageHeader } from '@/components/ui';

const LIVE = ['disbursed', 'active', 'overdue'];
const PENDING = ['pending', 'approved'];
const days = (d?: string | null) => d ? Math.round((new Date(d).getTime() - new Date(today()).getTime()) / 86400000) : null;

export default function MyLoans() {
  const { memberId } = useAuth();
  const d = useData<any[]>(() => q(supabase().from('v_loan_summary').select('*').eq('member_id', memberId!).order('created_at', { ascending: false })), [memberId]);
  const [showPast, setShowPast] = useState(false);
  const chk = useData<any>(() => rpc('loan_auto_check', { p_amount: '0' }));
  if (!d.data) return <Loading />;
  const rows = d.data;
  const live = rows.filter(r => LIVE.includes(r.status));
  const pending = rows.filter(r => PENDING.includes(r.status));
  const past = rows.filter(r => !LIVE.includes(r.status) && !PENDING.includes(r.status));
  const outstanding = live.reduce((a, r) => a + num(r.outstanding), 0);
  const next = live.filter(r => r.next_due_date).sort((a, b) => a.next_due_date.localeCompare(b.next_due_date))[0];
  const nd = days(next?.next_due_date);

  return (
    <>
      <PageHeader title="قروضي" subtitle="قروضك القائمة، أقساطك القادمة، وسجل قروضك السابقة"
        actions={<Button icon={<Plus className="size-4" />} onClick={() => go('/member/loans/new/')}>طلب قرض جديد</Button>} />

      {/* summary */}
      <div className="shurfa relative mb-5 overflow-hidden rounded-2xl bg-brand-900 p-5 text-white sm:p-6">
        <div className="relative grid gap-5 sm:grid-cols-3">
          <div>
            <div className="text-xs text-brand-200">إجمالي المتبقي عليك</div>
            <div className="mt-1 font-display text-3xl font-semibold num">{sar(outstanding)}</div>
            <div className="mt-1 text-xs text-brand-200">{live.length ? `${live.length} قرض قائم` : 'لا توجد قروض قائمة'}</div>
          </div>
          <div className="sm:border-s sm:border-white/10 sm:ps-5">
            <div className="text-xs text-brand-200">القسط القادم</div>
            {next ? <>
              <div className="mt-1 text-2xl font-semibold num text-gold-300">{sar(next.next_due_amount)}</div>
              <div className="mt-1 text-xs text-brand-100">{date(next.next_due_date)} · {nd === null ? '' : nd < 0 ? `متأخر ${-nd} يوم` : nd === 0 ? 'اليوم' : `بعد ${nd} يوم`}</div>
            </> : <div className="mt-1 text-lg text-brand-100">—</div>}
          </div>
          <div className="sm:border-s sm:border-white/10 sm:ps-5">
            <div className="text-xs text-brand-200">المسدد حتى الآن</div>
            <div className="mt-1 text-2xl font-semibold num">{sar(live.reduce((a, r) => a + num(r.amount_repaid), 0))}</div>
            <div className="mt-1 text-xs text-brand-200">من {sar(live.reduce((a, r) => a + num(r.total_repayable), 0))}</div>
          </div>
        </div>
      </div>

      {chk.data && <div className="-mt-2 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
        <span>صافي رصيدك في الصندوق <b className={`num-cell ${Number(chk.data.net_before) < 0 ? 'text-neg' : 'text-brand-700'}`}>{sar(chk.data.net_before)}</b></span>
        {chk.data.blocked ? <span className="text-xs text-muted">{chk.data.blocked}</span>
          : <span className="text-muted">تقدر تطلب حتى <b className="num-cell text-gold-700">{sar(chk.data.max_auto)}</b> ويُعتمد تلقائياً</span>}
      </div>}

      {pending.length > 0 && <div className="mb-5 space-y-3">
        {pending.map(r => (
          <button key={r.id} onClick={() => go(`/member/loans/view/?id=${r.id}`)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-gold-300 bg-gold-100/60 px-4 py-3 text-start">
            <span className="flex items-center gap-3"><CalendarClock className="size-5 text-gold-700" />
              <span><span className="font-medium">طلب قرض {sar(r.approved_amount ?? r.requested_amount)}</span>
                <span className="block text-xs text-muted">{statusLabels[r.status]?.[0]} · {date(r.request_date)}</span></span></span>
            <ChevronLeft className="size-4 text-muted" />
          </button>
        ))}
      </div>}

      {live.length === 0 && pending.length === 0 && <Card><Empty>ما عليك قروض حالياً 🌿</Empty></Card>}

      <div className="grid gap-4 lg:grid-cols-2">
        {live.map(r => <LoanCard key={r.id} r={r} />)}
      </div>

      {past.length > 0 && <div className="mt-6">
        <button onClick={() => setShowPast(v => !v)} className="mb-3 flex items-center gap-2 text-sm font-medium text-ink-2">
          <ChevronDown className={clsx('size-4 transition-transform', showPast && 'rotate-180')} /> القروض السابقة ({past.length})
        </button>
        {showPast && <Card pad={false}><ul className="divide-y divide-line">
          {past.map(r => (
            <li key={r.id}><button onClick={() => go(`/member/loans/view/?id=${r.id}`)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-canvas">
              <span className="flex min-w-0 items-center gap-3">
                {r.status === 'fully_repaid' ? <CircleCheck className="size-5 shrink-0 text-pos" /> : <HandCoins className="size-5 shrink-0 text-muted" />}
                <span className="min-w-0"><span className="block truncate font-medium num-cell">{sar(r.approved_amount ?? r.requested_amount)} <span className="text-xs font-normal text-muted">· {r.loan_no}</span></span>
                  <span className="block truncate text-xs text-muted">{r.purpose} · {date(r.disbursed_on ?? r.request_date)}</span></span>
              </span>
              <Badge status={r.status} />
            </button></li>
          ))}
        </ul></Card>}
      </div>}
    </>
  );
}

function LoanCard({ r }: { r: any }) {
  const total = num(r.total_repayable), paid = num(r.amount_repaid), pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
  const n = num(r.installments_count), done = num(r.paid_count);
  const overdue = num(r.overdue_amount) > 0;
  const nd = days(r.next_due_date);
  return (
    <button onClick={() => go(`/member/loans/view/?id=${r.id}`)} className={clsx('group w-full rounded-2xl border bg-surface p-5 text-start shadow-sm transition hover:shadow-md', overdue ? 'border-clay/40' : 'border-line')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted num">{r.loan_no} · {r.purpose}</div>
          <div className="mt-1 text-xs text-muted">المتبقي</div>
          <div className="font-display text-2xl font-semibold text-brand-700 num">{sar(r.outstanding)}</div>
        </div>
        <Ring pct={pct} />
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-brand-50">
        <div className="h-full rounded-full bg-gradient-to-l from-gold-500 to-brand-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted num-cell">
        <span>مسدد {sar(paid)}</span><span>من {sar(total)}</span>
      </div>

      {n > 0 && n <= 36 && <div className="mt-4 flex flex-wrap gap-1" aria-label={`${done} من ${n} أقساط`}>
        {Array.from({ length: n }, (_, i) => <span key={i} className={clsx('h-1.5 w-4 rounded-full', i < done ? 'bg-gold-500' : i < done + num(r.overdue_count) ? 'bg-clay' : 'bg-line')} />)}
      </div>}

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
        <div><div className="text-[11px] text-muted">القسط القادم</div>
          <div className="font-medium num">{r.next_due_date ? sar(r.next_due_amount) : '—'}</div>
          {r.next_due_date && <div className={clsx('text-[11px]', nd !== null && nd < 0 ? 'text-neg' : 'text-muted')}>{date(r.next_due_date)}{nd !== null && nd >= 0 ? ` · بعد ${nd} يوم` : ''}</div>}
        </div>
        <div><div className="text-[11px] text-muted">الأقساط</div>
          <div className="font-medium num">{done} / {n || '—'}</div>
          <div className="text-[11px] text-muted">{frequencyLabels[r.frequency] ?? ''}</div>
        </div>
      </div>
      {overdue && <div className="mt-3 flex items-center gap-2 rounded-lg bg-clay/10 px-3 py-2 text-xs text-neg">
        <TriangleAlert className="size-4" /> عليك أقساط متأخرة بقيمة <span className="num font-semibold">{sar(r.overdue_amount)}</span></div>}
    </button>
  );
}

function Ring({ pct }: { pct: number }) {
  const R = 22, C = 2 * Math.PI * R;
  return (
    <div className="relative size-14 shrink-0">
      <svg viewBox="0 0 56 56" className="size-14 -rotate-90">
        <circle cx="28" cy="28" r={R} fill="none" stroke="var(--color-brand-50)" strokeWidth="6" />
        <circle cx="28" cy="28" r={R} fill="none" stroke="var(--color-gold-500)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold num-cell">{Math.round(pct)}%</span>
    </div>
  );
}
