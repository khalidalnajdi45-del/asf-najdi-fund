'use client';
import { go } from '@/lib/nav';
import { ArrowLeft, CalendarCheck, HandCoins, PiggyBank, Plus, Wallet } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { date, monthLabel, num, sar } from '@/lib/format';
import { txTypeLabels, loanStatus } from '@/lib/labels';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, DataTable, ErrorBox, Loading, Stat, Tag } from '@/components/ui';
import { MemberCalendar } from '@/components/member-calendar';
import { NotificationList } from '@/components/member-views';
import { toRoute } from '@/components/account-pages';
import { GreetingBand } from '@/components/welcome';
import { NextEventStrip } from '@/components/events';
import { PushPrompt } from '@/components/push-settings';

export default function MemberDashboard() {
  const { data: d, error, loading } = useData<any>(() => rpc('member_dashboard', { p_member: null }));
  const { memberId } = useAuth();
  const loans = useData<any[]>(() => memberId ? q(supabase().from('v_loan_summary').select('*').eq('member_id', memberId).in('status', ['disbursed', 'active', 'overdue']).order('created_at')) : Promise.resolve([]), [memberId]);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!d) return null;
  const b = d.balances, cur = d.current_contribution, loan = d.active_loan;
  const pendingCount = d.pending.deposits.length + d.pending.withdrawals.length + d.pending.loans.length;
  return (
    <>
      <GreetingBand subtitle={<span className="num">رقم العضوية {d.member.member_no}</span>} />
      <PushPrompt />
      <div className="no-print -mt-2 mb-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => go('/member/deposits/new/')}>طلب إيداع</Button>
        <Button icon={<HandCoins className="size-4" />} onClick={() => go('/member/loans/new/')}>طلب قرض</Button>
      </div>

      <NextEventStrip href="/member/events/" />
      {Number(b.contributions_overdue) > 0 && <div className="mb-4"><ErrorBox>عليك اشتراكات متأخرة بقيمة {sar(b.contributions_overdue)} ({b.contributions_overdue_months} شهر). يرجى التواصل مع مدير الصندوق للسداد.</ErrorBox></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><MemberCalendar /></div>
        <NetCard b={b} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="إجمالي اشتراكاتي" value={sar(b.contributions_total)} hint={`هذا العام ${sar(b.contributions_ytd)}`} icon={<CalendarCheck className="size-4" />} />
        <Stat label="رصيد ودائعي" value={sar(b.deposit_balance)} hint={`المتاح للسحب ${sar(b.available_to_withdraw)}`} icon={<PiggyBank className="size-4" />} tone="brand" />
        <Stat label="رصيد القرض" value={sar(b.loan_outstanding)} hint={loan ? `القسط القادم ${date(loan.next_due_date)}` : 'لا يوجد قرض قائم'} icon={<Wallet className="size-4" />} tone={loan?.status === 'overdue' ? 'neg' : 'neutral'} />
        <Stat label={`اشتراك ${cur ? monthLabel(cur.period) : 'هذا الشهر'}`} value={cur ? <Badge status={cur.status} /> : '—'}
          hint={cur && Number(cur.amount_outstanding) > 0 ? `المتبقي ${sar(cur.amount_outstanding)} — يستحق ${date(cur.due_date)}` : cur ? 'شكراً لك' : undefined} />
      </div>

      {!!loans.data?.length && <Card className="mt-4" title={loans.data.length > 1 ? `قروضي (${loans.data.length})` : 'قرضي'} actions={<a href="/member/loans/" className="flex items-center gap-1 text-xs text-brand-600">كل القروض <ArrowLeft className="size-3.5" /></a>}>
        <LoansDonut loans={loans.data} />
      </Card>}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="آخر العمليات" pad={false} className="lg:col-span-2" actions={<a href="/member/transactions/" className="text-xs text-brand-600 hover:underline">الكل</a>}>
          <DataTable rows={d.recent_transactions} empty="لا توجد عمليات بعد" columns={[
            { key: 'tx_date', header: 'التاريخ', render: r => date(r.tx_date) },
            { key: 'tx_type', header: 'النوع', render: r => <span className="flex gap-1.5">{txTypeLabels[r.tx_type]}{r.is_reversed && <Tag tone="red">معكوسة</Tag>}</span> },
            { key: 'amount', header: 'المبلغ', align: 'end', render: r => sar(r.amount) },
          ]} />
        </Card>
        <div className="space-y-4">
          <Card title="طلبات قيد المعالجة" actions={pendingCount ? <Tag tone="amber">{pendingCount}</Tag> : undefined}>
            {pendingCount === 0 ? <p className="text-sm text-muted">لا توجد طلبات معلقة</p> : <ul className="space-y-2 text-sm">
              {d.pending.deposits.map((x: any) => <li key={x.id} className="flex justify-between"><span>طلب إيداع</span><span className="num">{sar(x.amount)}</span></li>)}
              {d.pending.withdrawals.map((x: any) => <li key={x.id} className="flex justify-between"><span>طلب سحب <Badge status={x.status} /></span><span className="num">{sar(x.amount)}</span></li>)}
              {d.pending.loans.map((x: any) => <li key={x.id} className="flex justify-between"><a href={`/member/loans/view/?id=${x.id}`} className="hover:text-brand-600">قرض <Badge status={x.status} /></a><span className="num">{sar(x.amount)}</span></li>)}
            </ul>}
          </Card>
          <Card title="الإشعارات" pad={false} actions={<a href="/member/notifications/" className="text-xs text-brand-600 hover:underline">{d.unread_count > 0 ? `${d.unread_count} جديد` : 'الكل'}</a>}>
            <NotificationList rows={d.notifications} onOpen={n => n.link && (go(toRoute(n.link)))} />
          </Card>
        </div>
      </div>
    </>
  );
}

function NetCard({ b }: { b: any }) {
  const c = Number(b.contributions_total), dep = Number(b.deposit_balance), l = Number(b.loan_outstanding);
  const net = c + dep - l, total = Math.max(1, c + dep);
  return (
    <div className="shurfa relative overflow-hidden rounded-2xl bg-brand-900 p-5 text-white">
      <div className="pointer-events-none absolute -left-16 -top-16 size-48 rounded-full bg-gold-500/15 blur-3xl" />
      <div className="relative">
        <div className="text-xs text-brand-200">صافي رصيدي في الصندوق</div>
        <div className={`mt-1 font-display text-3xl font-semibold num-cell ${net < 0 ? 'text-[#f0b59c]' : ''}`}>{sar(net)}</div>
        <div className="mt-1 text-[11px] text-brand-200">اشتراكات + ودائع − قروض قائمة</div>
        <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-white/10">
          <span className="h-full bg-gold-500" style={{ width: `${(c / total) * 100}%` }} />
          <span className="h-full bg-gold-300" style={{ width: `${(dep / total) * 100}%` }} />
        </div>
        {l > 0 && <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white/10"><span className="h-full bg-[#f0b59c]" style={{ width: `${Math.min(100, (l / total) * 100)}%` }} /></div>}
        <ul className="mt-4 space-y-1.5 text-sm">
          <li className="flex justify-between"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-gold-500" />اشتراكاتي</span><span className="num-cell">{sar(c)}</span></li>
          <li className="flex justify-between"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-gold-300" />ودائعي</span><span className="num-cell">{sar(dep)}</span></li>
          <li className="flex justify-between"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#f0b59c]" />قروضي</span><span className="num-cell">−{sar(l)}</span></li>
        </ul>
      </div>
    </div>
  );
}

function LoansDonut({ loans }: { loans: any[] }) {
  const sum = (k: string) => loans.reduce((a, l) => a + num(l[k] ?? 0), 0);
  const total = sum('total_repayable') || 1, paid = sum('amount_repaid'), over = sum('overdue_amount'), out = sum('outstanding');
  const rest = Math.max(0, total - paid - over);
  const next = loans.filter(l => l.next_due_date).sort((a, b) => a.next_due_date.localeCompare(b.next_due_date))[0];
  const R = 42, C = 2 * Math.PI * R;
  const seg = (v: number) => (v / total) * C;
  const parts = [[paid, 'var(--color-gold-500)'], [over, 'var(--color-clay)'], [rest, 'var(--color-brand-100)']] as const;
  let off = 0;
  return (
    <div className="grid gap-5 md:grid-cols-[auto_1fr_1fr] md:items-center md:gap-6">
      <div className="relative mx-auto size-36 shrink-0">
        <svg viewBox="0 0 100 100" className="size-36 -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--color-canvas)" strokeWidth="11" />
          {parts.map(([v, col], i) => { const el = v > 0 ? <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={col} strokeWidth="11" strokeDasharray={`${seg(v)} ${C}`} strokeDashoffset={-off} /> : null; off += seg(v); return el; })}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-semibold num-cell">{Math.round((paid / total) * 100)}%</span><span className="text-[10px] text-muted">مسدد</span></span>
      </div>
      <ul className="w-full min-w-0 space-y-2 text-sm">
        <li className="flex justify-between gap-3 font-medium"><span>إجمالي القروض</span><span className="num-cell">{sar(total)}</span></li>
        <li className="flex justify-between gap-3"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-gold-500" />المسدد</span><span className="num-cell">{sar(paid)}</span></li>
        {over > 0 && <li className="flex justify-between gap-3 text-neg"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-clay" />متأخر</span><span className="num-cell">{sar(over)}</span></li>}
        <li className="flex justify-between gap-3"><span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-brand-100" />المتبقي</span><span className="num-cell">{sar(out)}</span></li>
        {next && <li className="flex justify-between gap-3 border-t border-line pt-2 text-muted"><span>أقرب قسط</span><span className="num-cell">{sar(next.next_due_amount)} · {date(next.next_due_date)}</span></li>}
      </ul>
      <ul className="w-full min-w-0 space-y-1.5 border-t border-line pt-4 text-sm md:border-r md:border-t-0 md:pe-0 md:ps-0 md:pr-5 md:pt-0">
        {loans.map(l => {
          const pct = Math.round((num(l.amount_repaid) / (num(l.total_repayable) || 1)) * 100);
          return <li key={l.id}><a href={`/member/loans/view/?id=${l.id}`} className="block rounded-lg px-2.5 py-2 hover:bg-canvas">
            <span className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><span className="text-xs text-muted num-cell">{l.loan_no}</span><Badge status={loanStatus(l.status)} /></span><span className="font-medium num-cell">{sar(l.outstanding)}</span></span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-brand-50"><span className="block h-full rounded-full bg-gold-500" style={{ width: `${pct}%` }} /></span>
          </a></li>;
        })}
      </ul>
    </div>
  );
}
