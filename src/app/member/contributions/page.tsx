'use client';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { sar } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { Card, Notice, PageHeader, Stat } from '@/components/ui';
import { ContributionsTable } from '@/components/member-views';

export default function MyContributions() {
  const { memberId, fund } = useAuth();
  const sb = supabase();
  const d = useData<any>(async () => {
    const [rows, bal] = await Promise.all([
      q(sb.from('v_contribution_status').select('*').eq('member_id', memberId!).order('period', { ascending: false })),
      q(sb.from('v_member_balances').select('*').eq('member_id', memberId!).single()),
    ]);
    return { rows, bal };
  }, [memberId]);
  const b = d.data?.bal;
  return (
    <>
      <PageHeader title="اشتراكاتي الشهرية" subtitle={`الاشتراك الإلزامي ${sar(fund?.monthly_contribution)} شهرياً — منفصل عن ودائعك الاختيارية`} />
      {b && <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="إجمالي المسدد" value={sar(b.contributions_total)} tone="brand" />
        <Stat label="هذا العام" value={sar(b.contributions_ytd)} />
        <Stat label="متأخرات" value={sar(b.contributions_overdue)} tone={Number(b.contributions_overdue) > 0 ? 'neg' : 'neutral'} hint={`${b.contributions_overdue_months} شهر`} />
      </div>}
      <div className="mb-4"><Notice>يتم تسجيل الدفعات من قبل مدير الصندوق بعد استلامها. إذا دفعت ولم تظهر الدفعة، تواصل معه مع مرجع التحويل.</Notice></div>
      <Card pad={false}><ContributionsTable rows={d.data?.rows ?? null} loading={d.loading} /></Card>
    </>
  );
}
