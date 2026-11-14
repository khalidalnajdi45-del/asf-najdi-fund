'use client';
import { useParam } from '@/lib/hooks';
import { Loading, PageHeader } from '@/components/ui';
import { Statement } from '@/components/statement';

export default function AdminStatement() {
  const id = useParam('member');
  if (!id) return <Loading />;
  return <>
    <PageHeader title="كشف حساب عضو" back={{ href: `/admin/members/view/?id=${id}`, label: 'ملف العضو' }} />
    <Statement memberId={id} />
  </>;
}
