'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { date, sar } from '@/lib/format';
import { Badge, Card, DataTable, PageHeader, Tabs } from '@/components/ui';

export default function LoanApplications() {
  const [tab, setTab] = useState('pending');
  const d = useData<any[]>(() => q(supabase().from('v_loan_summary').select('*').order('request_date', { ascending: false }).order('created_at', { ascending: false })));
  const rows = d.data ?? [];
  const filtered = tab === 'pending' ? rows.filter(r => r.status === 'pending')
    : tab === 'approved' ? rows.filter(r => r.status === 'approved')
    : tab === 'closed' ? rows.filter(r => ['rejected', 'cancelled'].includes(r.status)) : rows;
  return (
    <>
      <PageHeader title="طلبات القروض" subtitle="مراجعة الطلبات واعتمادها — الاعتماد لا يعني الصرف" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'pending', label: 'جديدة', count: rows.filter(r => r.status === 'pending').length },
        { key: 'approved', label: 'معتمدة بانتظار الصرف', count: rows.filter(r => r.status === 'approved').length },
        { key: 'closed', label: 'مرفوضة / ملغاة' }, { key: 'all', label: 'الكل' },
      ]} />
      <Card pad={false}>
        <DataTable rows={filtered} loading={d.loading} searchable={r => `${r.member_name} ${r.loan_no} ${r.purpose}`}
          onRowClick={r => (go(`/admin/loans/view/?id=${r.id}`))} empty="لا توجد طلبات"
          columns={[
            { key: 'loan_no', header: 'الرقم', render: r => <span className="num text-xs text-muted">{r.loan_no}</span> },
            { key: 'request_date', header: 'تاريخ الطلب', render: r => date(r.request_date) },
            { key: 'member_name', header: 'العضو', render: r => <span className="font-medium">{r.member_name}</span> },
            { key: 'requested_amount', header: 'المبلغ المطلوب', align: 'end', render: r => sar(r.requested_amount) },
            { key: 'approved_amount', header: 'المعتمد', align: 'end', render: r => r.approved_amount ? sar(r.approved_amount) : '—' },
            { key: 'preferred_months', header: 'المدة المفضلة', render: r => `${r.preferred_months} شهر` },
            { key: 'purpose', header: 'الغرض', className: 'max-w-[220px] truncate' },
            { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
          ]} />
      </Card>
    </>
  );
}
