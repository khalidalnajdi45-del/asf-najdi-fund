'use client';
import { useAuth } from '@/lib/auth';
import { Loading, PageHeader } from '@/components/ui';
import { Statement } from '@/components/statement';

export default function MyStatements() {
  const { memberId } = useAuth();
  if (!memberId) return <Loading />;
  return <>
    <PageHeader title="كشوف الحساب" subtitle="اختر الفترة ثم نزّل الكشف بصيغة PDF أو Excel" />
    <Statement memberId={memberId} />
  </>;
}
