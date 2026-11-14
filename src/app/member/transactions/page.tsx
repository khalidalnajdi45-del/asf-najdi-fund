'use client';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { TransactionsTable } from '@/components/member-views';

export default function MyTransactions() {
  const { memberId } = useAuth();
  const d = useData<any[]>(() => q(supabase().from('v_transactions').select('*').eq('member_id', memberId!).order('tx_date', { ascending: false }).order('created_at', { ascending: false })), [memberId]);
  return (
    <>
      <PageHeader title="عملياتي المالية" subtitle="كل حركة مالية على حسابك، مع رقم العملية للمراجعة" />
      <Card pad={false}><TransactionsTable rows={d.data} loading={d.loading} /></Card>
    </>
  );
}
