'use client';
import { go } from '@/lib/nav';
import { Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { Button, Card, PageHeader } from '@/components/ui';
import { LoansTable } from '@/components/member-views';

export default function MyLoans() {
  const { memberId } = useAuth();
  const d = useData<any[]>(() => q(supabase().from('v_loan_summary').select('*').eq('member_id', memberId!).order('created_at', { ascending: false })), [memberId]);
  return (
    <>
      <PageHeader title="قروضي" subtitle="طلبات القروض، الشروط المعتمدة، وجداول السداد"
        actions={<Button icon={<Plus className="size-4" />} onClick={() => (go('/member/loans/new/'))}>طلب قرض جديد</Button>} />
      <Card pad={false}><LoansTable rows={d.data} loading={d.loading} hrefBase="/member/loans/view/" /></Card>
    </>
  );
}
