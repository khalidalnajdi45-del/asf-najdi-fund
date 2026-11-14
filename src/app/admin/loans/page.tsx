'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { date, sar } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { statusLabels } from '@/lib/labels';
import { Badge, Button, Card, DataTable, PageHeader, Stat, Tabs } from '@/components/ui';
import { RepaymentModal } from '@/components/ops';

export default function LoansManagement() {
  const [tab, setTab] = useState('active');
  const [repay, setRepay] = useState<any>(null);
  const d = useData<any[]>(() => q(supabase().from('v_loan_summary').select('*').in('status', ['disbursed', 'active', 'overdue', 'fully_repaid']).order('disbursed_on', { ascending: false })));
  const rows = d.data ?? [];
  const live = rows.filter(r => ['disbursed', 'active', 'overdue'].includes(r.status));
  const list = tab === 'active' ? live : tab === 'overdue' ? rows.filter(r => r.status === 'overdue') : rows.filter(r => r.status === 'fully_repaid');
  const sum = (xs: any[], k: string) => xs.reduce((s, r) => s + Number(r[k] ?? 0), 0);

  const exportList = () => exportXlsx('محفظة-القروض', [{
    name: 'القروض', header: ['رقم القرض', 'العضو', 'تاريخ الصرف', 'المبلغ', 'الرسوم', 'المسدد', 'المتبقي', 'متأخرات', 'القسط القادم', 'الحالة'],
    rows: rows.map(r => [r.loan_no, r.member_name, r.disbursed_on, n2(r.approved_amount), n2(r.fee_amount), n2(r.amount_repaid), n2(r.outstanding), n2(r.overdue_amount), r.next_due_date, statusLabels[r.status]?.[0]]),
  }]);

  return (
    <>
      <PageHeader title="إدارة القروض" subtitle="القروض المصروفة وجداول السداد"
        actions={<Button variant="secondary" icon={<Download className="size-4" />} onClick={exportList}>Excel</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="الرصيد القائم" value={sar(sum(live, 'outstanding'))} tone="brand" hint={`${live.length} قرض نشط`} />
        <Stat label="المسدد من القروض النشطة" value={sar(sum(live, 'amount_repaid'))} />
        <Stat label="متأخرات" value={sar(sum(live, 'overdue_amount'))} tone={sum(live, 'overdue_amount') > 0 ? 'neg' : 'neutral'} hint={`${rows.filter(r => r.status === 'overdue').length} قرض متأخر`} />
        <Stat label="قروض مسددة بالكامل" value={rows.filter(r => r.status === 'fully_repaid').length} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'active', label: 'القائمة', count: live.length },
        { key: 'overdue', label: 'المتأخرة', count: rows.filter(r => r.status === 'overdue').length },
        { key: 'repaid', label: 'المسددة' },
      ]} />
      <Card pad={false}>
        <DataTable rows={list} loading={d.loading} searchable={r => `${r.member_name} ${r.loan_no}`}
          onRowClick={r => (go(`/admin/loans/view/?id=${r.id}`))} empty="لا توجد قروض"
          columns={[
            { key: 'loan_no', header: 'الرقم', render: r => <span className="num text-xs text-muted">{r.loan_no}</span> },
            { key: 'member_name', header: 'العضو', render: r => <span className="font-medium">{r.member_name}</span> },
            { key: 'disbursed_on', header: 'الصرف', render: r => date(r.disbursed_on) },
            { key: 'total_repayable', header: 'إجمالي المستحق', align: 'end', render: r => sar(r.total_repayable) },
            { key: 'amount_repaid', header: 'المسدد', align: 'end', render: r => sar(r.amount_repaid) },
            { key: 'outstanding', header: 'المتبقي', align: 'end', render: r => <span className="font-semibold">{sar(r.outstanding)}</span> },
            { key: 'progress', header: 'الأقساط', render: r => <span className="num text-xs">{r.paid_count}/{r.installments_count}</span> },
            { key: 'next_due_date', header: 'القسط القادم', render: r => r.status === 'fully_repaid' ? '—' : date(r.next_due_date) },
            { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
            { key: 'act', header: '', render: r => r.status !== 'fully_repaid' && <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); setRepay(r); }}>سداد</Button> },
          ]} />
      </Card>
      <RepaymentModal loan={repay} onClose={() => setRepay(null)} onDone={d.reload} />
    </>
  );
}
