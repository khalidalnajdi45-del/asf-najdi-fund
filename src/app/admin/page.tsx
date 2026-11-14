'use client';
import { go } from '@/lib/nav';
import { AlertTriangle, ArrowLeft, Banknote, HandCoins, Landmark, PiggyBank, Scale, TrendingUp, Users, Wallet } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/hooks';
import { date, num, pct, plain, sar } from '@/lib/format';
import { txTypeLabels } from '@/lib/labels';
import { Badge, Card, DataTable, ErrorBox, Loading, PageHeader, Stat, Tag } from '@/components/ui';
import { CashFlowChart, RateChart, ShareBars } from '@/components/charts';
import { useAuth } from '@/lib/auth';
import { categoryLabel, useSettings } from '@/lib/settings';

export default function ManagerDashboard() {
  const { data: d, error, loading } = useData<any>(() => rpc('manager_dashboard'));
  const { data: s } = useData<any>(() => rpc('integrity_check'));
  const { fund } = useAuth();
  const { data: settings } = useSettings();
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!d) return null;
  return (
    <>
      <PageHeader title="لوحة التحكم" subtitle={`المركز المالي لـ${fund?.fund_name ?? 'الصندوق'} — بالريال السعودي`}
        actions={s && (s.ok
          ? <Tag tone="green">السجلات المحاسبية متطابقة</Tag>
          : <a href="/admin/ledger/"><Tag tone="red">تنبيه: عدم تطابق في السجلات</Tag></a>)} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat emphasize label="صافي مركز الصندوق" value={sar(d.net_position)} hint="إجمالي الأصول ناقص الالتزامات" icon={<Scale className="size-4" />} />
        <Stat label="إجمالي الأصول" value={sar(d.total_assets)} icon={<Landmark className="size-4" />} />
        <Stat label="النقد المتاح" value={sar(d.cash)} hint="رصيد البنك الفعلي" icon={<Banknote className="size-4" />} tone="brand" />
        <Stat label="إجمالي الالتزامات" value={sar(d.total_liabilities)} hint="ودائع الأعضاء والتزامات أخرى" icon={<Wallet className="size-4" />} />
        <Stat label="الاشتراكات الشهرية (تراكمي)" value={sar(d.contributions_total)} icon={<Users className="size-4" />} />
        <Stat label="الودائع الاختيارية" value={sar(d.deposits_total)} hint="التزام لصالح الأعضاء" icon={<PiggyBank className="size-4" />} />
        <Stat label="القروض القائمة" value={sar(d.loans_outstanding)} icon={<HandCoins className="size-4" />} />
        <Stat label="الاستثمارات (القيمة الحالية)" value={sar(d.investments_total)} hint={`التكلفة ${sar(d.investments_cost)}`} icon={<TrendingUp className="size-4" />} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="أرباح استثمار محققة" value={sar(d.realized_investment_pl, { sign: true })} tone={num(d.realized_investment_pl) >= 0 ? 'pos' : 'neg'} />
        <Stat label="أرباح/خسائر غير محققة" value={sar(d.unrealized_investment_pl, { sign: true })} tone={num(d.unrealized_investment_pl) >= 0 ? 'pos' : 'neg'} hint="لا تعتبر نقداً ولا دخلاً محققاً" />
        <Stat label="المصروفات التشغيلية" value={sar(d.operating_expenses)} />
        <Stat label="نسبة التحصيل هذا الشهر" value={pct(d.collection.rate)} hint={`${plain(d.collection.paid_members)} من ${plain(d.collection.members)} عضو سددوا`} tone="brand" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="التدفق النقدي الشهري" subtitle="آخر 12 شهراً" className="lg:col-span-2"><CashFlowChart data={d.cash_flow} /></Card>
        <Card title="نسبة تحصيل الاشتراكات" subtitle="آخر 6 أشهر"><RateChart data={d.collection_trend} />
          {num(d.overdue_contributions) > 0 && <div className="mt-3 flex items-center justify-between rounded-lg bg-[#f8ece6] px-3 py-2 text-[13px] text-[#7f4630]">
            <span>اشتراكات متأخرة</span><span className="num font-semibold">{sar(d.overdue_contributions)}</span></div>}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="طلبات القروض المعلقة" pad={false} actions={<a href="/admin/loan-applications/" className="text-xs text-brand-600 hover:underline">الكل</a>}>
          <DataTable rows={d.pending_loans} empty="لا توجد طلبات" onRowClick={(r: any) => (go(`/admin/loans/view/?id=${r.id}`))}
            columns={[
              { key: 'member_name', header: 'العضو' },
              { key: 'amount', header: 'المبلغ', align: 'end', render: (r: any) => sar(r.amount) },
              { key: 'status', header: 'الحالة', render: (r: any) => <Badge status={r.status} /> },
            ]} />
        </Card>
        <Card title="طلبات سحب الودائع" pad={false} actions={<a href="/admin/withdrawals/" className="text-xs text-brand-600 hover:underline">الكل</a>}>
          <DataTable rows={d.pending_withdrawals} empty="لا توجد طلبات"
            columns={[
              { key: 'member_name', header: 'العضو' },
              { key: 'amount', header: 'المبلغ', align: 'end', render: (r: any) => sar(r.amount) },
              { key: 'status', header: 'الحالة', render: (r: any) => <Badge status={r.status} /> },
            ]} />
          {d.pending_deposits > 0 && <a href="/admin/deposits/" className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] text-brand-700 hover:bg-brand-50">
            <span>{plain(d.pending_deposits)} طلب إيداع بانتظار التأكيد</span><ArrowLeft className="size-4" /></a>}
        </Card>
        <Card title="أقساط متأخرة" pad={false} actions={<AlertTriangle className="size-4 text-neg" />}>
          <DataTable rows={d.overdue_installments} empty="لا توجد أقساط متأخرة" onRowClick={(r: any) => (go(`/admin/loans/view/?id=${r.loan_id}`))}
            columns={[
              { key: 'member_name', header: 'العضو' },
              { key: 'due_date', header: 'الاستحقاق', render: (r: any) => date(r.due_date) },
              { key: 'amount', header: 'المتبقي', align: 'end', render: (r: any) => <span className="text-neg">{sar(r.amount)}</span> },
            ]} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="آخر العمليات المالية" pad={false} className="lg:col-span-2" actions={<a href="/admin/ledger/" className="text-xs text-brand-600 hover:underline">دفتر الأستاذ</a>}>
          <DataTable rows={d.recent_transactions} empty="لا توجد عمليات"
            columns={[
              { key: 'tx_no', header: 'الرقم', render: (r: any) => <span className="num text-xs text-muted">{r.tx_no}</span> },
              { key: 'tx_date', header: 'التاريخ', render: (r: any) => date(r.tx_date) },
              { key: 'tx_type', header: 'النوع', render: (r: any) => <span className="flex items-center gap-1.5">{txTypeLabels[r.tx_type]}{r.is_reversed && <Tag tone="red">معكوسة</Tag>}</span> },
              { key: 'description', header: 'الوصف', className: 'max-w-[260px] truncate' },
              { key: 'amount', header: 'المبلغ', align: 'end', render: (r: any) => sar(r.amount) },
            ]} />
        </Card>
        <Card title="توزيع الاستثمارات" actions={<a href="/admin/investments/" className="text-xs text-brand-600 hover:underline">المحفظة</a>}>
          {d.investments_by_category.length ? <ShareBars items={d.investments_by_category.map((c: any) => ({ label: categoryLabel(settings, c.category), value: c.value }))} />
            : <p className="text-sm text-muted">لا توجد استثمارات نشطة</p>}
        </Card>
      </div>
    </>
  );
}

