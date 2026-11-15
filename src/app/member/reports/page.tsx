'use client';
import { useEffect } from 'react';
import clsx from 'clsx';
import { Printer , FileDown } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData, useParam } from '@/lib/hooks';
import { go } from '@/lib/nav';
import { printPdf } from '@/lib/export';
import { sar } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { MonthlyReportView, type ReportRow } from '@/components/monthly-report';

export default function MemberReports() {
  const id = useParam('id');
  const list = useData<ReportRow[]>(() => q(supabase().from('monthly_reports').select('*').order('period', { ascending: false })));
  const rows = list.data ?? [];
  const current = rows.find(r => r.id === id) ?? rows[0];

  useEffect(() => {
    if (current && !current.read_at) rpc('mark_report_read', { p_id: current.id }).then(() => list.reload(), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (list.loading && !list.data) return <Loading />;
  return (
    <>
      <PageHeader title="تقاريري الشهرية" subtitle="ملخص حسابك يصدر أول كل شهر — اشتراكات، ودائع، قروض"
        actions={current && <Button variant="secondary" icon={<FileDown className="size-4" />} onClick={() => printPdf(`تقرير-${current.report.period_label}`)}>تنزيل PDF</Button>} />
      <ErrorBox>{list.error}</ErrorBox>
      {!rows.length ? <Card><Empty>لم يصدر لك تقرير بعد — يصدر التقرير أول كل شهر</Empty></Card> : (
        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <nav className="no-print flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="الأشهر">
            {rows.map(r => (
              <button key={r.id} onClick={() => go(`/member/reports/?id=${r.id}`, true)}
                className={clsx('shrink-0 rounded-lg border px-3 py-2.5 text-start text-sm transition',
                  r.id === current?.id ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface hover:border-line-strong')}>
                <div className="flex items-center gap-2 font-medium">{r.report.period_label}{!r.read_at && <span className="size-2 rounded-full bg-gold-500" aria-label="جديد" />}</div>
                <div className="text-xs text-muted num">{sar(r.report.net_position)}</div>
              </button>
            ))}
          </nav>
          {current && <MonthlyReportView row={current} />}
        </div>
      )}
    </>
  );
}
