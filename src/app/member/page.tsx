'use client';
import { go } from '@/lib/nav';
import { ArrowLeft, CalendarCheck, HandCoins, PiggyBank, Plus, Wallet } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/hooks';
import { date, monthLabel, sar } from '@/lib/format';
import { txTypeLabels } from '@/lib/labels';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, DataTable, ErrorBox, Loading, PageHeader, Stat, Tag } from '@/components/ui';
import { ContributionBars } from '@/components/charts';
import { NotificationList } from '@/components/member-views';
import { toRoute } from '@/components/account-pages';
import { GreetingBand } from '@/components/welcome';

export default function MemberDashboard() {
  const { data: d, error, loading } = useData<any>(() => rpc('member_dashboard', { p_member: null }));
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!d) return null;
  const b = d.balances, cur = d.current_contribution, loan = d.active_loan;
  const pendingCount = d.pending.deposits.length + d.pending.withdrawals.length + d.pending.loans.length;
  return (
    <>
      <GreetingBand subtitle={<span className="num">رقم العضوية {d.member.member_no}</span>} />
      <div className="no-print -mt-2 mb-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => go('/member/deposits/new/')}>طلب إيداع</Button>
        <Button icon={<HandCoins className="size-4" />} onClick={() => go('/member/loans/new/')}>طلب قرض</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat emphasize label="إجمالي اشتراكاتي" value={sar(b.contributions_total)} hint={`هذا العام ${sar(b.contributions_ytd)}`} icon={<CalendarCheck className="size-4" />} />
        <Stat label="رصيد ودائعي" value={sar(b.deposit_balance)} hint={`المتاح للسحب ${sar(b.available_to_withdraw)}`} icon={<PiggyBank className="size-4" />} tone="brand" />
        <Stat label="رصيد القرض" value={sar(b.loan_outstanding)} hint={loan ? `القسط القادم ${date(loan.next_due_date)}` : 'لا يوجد قرض قائم'} icon={<Wallet className="size-4" />} tone={loan?.status === 'overdue' ? 'neg' : 'neutral'} />
        <Stat label={`اشتراك ${cur ? monthLabel(cur.period) : 'هذا الشهر'}`} value={cur ? <Badge status={cur.status} /> : '—'}
          hint={cur && Number(cur.amount_outstanding) > 0 ? `المتبقي ${sar(cur.amount_outstanding)} — يستحق ${date(cur.due_date)}` : cur ? 'شكراً لك' : undefined} />
      </div>

      {Number(b.contributions_overdue) > 0 && <div className="mt-3"><ErrorBox>لديك اشتراكات متأخرة بقيمة {sar(b.contributions_overdue)} ({b.contributions_overdue_months} شهر). يرجى التواصل مع مدير الصندوق للسداد.</ErrorBox></div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="اشتراكات هذا العام" className="lg:col-span-2"><ContributionBars data={d.year_contributions} /></Card>
        <Card title="القرض الحالي">
          {loan ? <a href={`/member/loans/view/?id=${loan.id}`} className="block space-y-3">
            <div className="flex items-center justify-between"><span className="num text-sm text-muted">{loan.loan_no}</span><Badge status={loan.status} /></div>
            <div><div className="text-xs text-muted">المتبقي</div><div className="num text-xl font-semibold">{sar(loan.outstanding)}</div></div>
            <div className="h-2 rounded-full bg-line"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, (Number(loan.amount_repaid) / Number(loan.total_repayable)) * 100)}%` }} /></div>
            <div className="flex justify-between text-sm"><span className="text-muted">القسط القادم</span><span className="num">{sar(loan.next_due_amount)} · {date(loan.next_due_date)}</span></div>
            <span className="flex items-center gap-1 text-xs text-brand-600">التفاصيل وجدول السداد <ArrowLeft className="size-3.5" /></span>
          </a> : <p className="text-sm text-muted">لا يوجد قرض قائم.</p>}
        </Card>
      </div>

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
