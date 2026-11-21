'use client';
import clsx from 'clsx';
import { go } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { BadgeCheck, CircleAlert, Clock3, HandCoins, Sparkles, XCircle } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { date, num, sar } from '@/lib/format';
import { Badge, Card, DataTable, PageHeader, Tabs, Tag } from '@/components/ui';
import { Avatar, Band, BandStat, Ring } from '@/components/admin-viz';
import { RescheduleRequests } from '@/components/loan-schedule';

type Check = { auto: boolean; net_before: string; net_after: string; blocked?: boolean; liquid_after?: string; reserve?: string; reasons: string[] };

/** Live policy check for one request — net position after the loan and fund liquidity after it. */
function useCheck(r: any) {
  const [c, setC] = useState<Check | null>(null);
  useEffect(() => {
    let alive = true;
    rpc<Check>('loan_auto_check', { p_amount: String(r.requested_amount), p_member: r.member_id }).then(x => alive && setC(x)).catch(() => {});
    return () => { alive = false; };
  }, [r.id]); // eslint-disable-line
  return c;
}

function RequestCard({ r }: { r: any }) {
  const c = useCheck(r);
  const monthly = num(r.requested_amount) / Math.max(1, Number(r.preferred_months ?? 1));
  const netAfter = c ? num(c.net_after) : null;
  return (
    <button onClick={() => go(`/admin/loans/view/?id=${r.id}`)}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-start shadow-xs transition hover:border-gold-500 hover:shadow-md">
      <div className="flex w-full items-center gap-3"><Avatar name={r.member_name} />
        <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.member_name}</div>
          <div className="text-xs text-muted"><span className="num">{r.loan_no}</span> · {date(r.request_date)}</div></div>
        {r.auto_approved && <Tag tone="green">قُبل تلقائياً</Tag>}
      </div>
      <div className="flex w-full items-end justify-between gap-2">
        <div><div className="font-display text-2xl font-semibold text-brand-700 num-cell">{sar(r.requested_amount)}</div>
          <div className="text-xs text-muted">{r.repayment_mode === 'lump' ? <>دفعة كاملة بتاريخ <span className="num">{date(r.preferred_start)}</span></>
            : <><span className="num">{r.preferred_months}</span> شهر · قسط تقريبي <span className="num-cell">{sar(monthly)}</span>{r.preferred_start && <> · من {date(r.preferred_start)}</>}</>}</div></div>
      </div>
      {r.purpose && <p className="w-full truncate rounded-lg bg-canvas px-3 py-2 text-xs text-ink-2">«{r.purpose}»</p>}
      <div className="w-full rounded-xl border border-dashed border-line p-3 text-xs">
        {!c ? <span className="text-muted">جاري فحص السياسة…</span> : <>
          <div className="flex items-center justify-between gap-2">
            <span className={clsx('flex items-center gap-1.5 font-semibold', c.auto ? 'text-pos' : 'text-gold-700')}>
              {c.auto ? <BadgeCheck className="size-4" /> : <CircleAlert className="size-4" />}{c.auto ? 'يستوفي شروط القبول التلقائي' : 'يحتاج قرارك'}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div><div className="text-muted">صافي العضو الآن</div><div className="font-semibold num-cell">{sar(c.net_before)}</div></div>
            <div><div className="text-muted">بعد القرض</div><div className={clsx('font-semibold num-cell', netAfter! < 0 ? 'text-neg' : 'text-pos')}>{sar(c.net_after)}</div></div>
          </div>
          {!c.auto && c.reasons?.length > 0 && <ul className="mt-2 list-inside list-disc space-y-0.5 text-muted">{c.reasons.slice(0, 2).map(x => <li key={x}>{x}</li>)}</ul>}
        </>}
      </div>
      <span className="mt-auto w-full rounded-lg bg-brand-600 py-2 text-center text-sm font-medium text-white">مراجعة واعتماد</span>
    </button>
  );
}

export default function LoanApplications() {
  const [tab, setTab] = useState('board');
  const d = useData<any[]>(() => q(supabase().from('v_loan_summary').select('*').order('request_date', { ascending: false }).order('created_at', { ascending: false })));
  const liq = useData<any>(() => rpc('liquidity_report'));
  const rows = d.data ?? [];
  const pending = rows.filter(r => r.status === 'pending'), approved = rows.filter(r => r.status === 'approved');
  const closed = rows.filter(r => ['rejected', 'cancelled'].includes(r.status));
  const tot = (xs: any[], k: string) => xs.reduce((a, r) => a + num(r[k] ?? 0), 0);
  const liquid = num(liq.data?.liquid ?? 0), reserve = num(liq.data?.reserve ?? 0), lendable = Math.max(0, liquid - reserve);
  const ask = tot(pending, 'requested_amount') + tot(approved, 'approved_amount');
  const cover = ask > 0 ? Math.min(100, (lendable / ask) * 100) : 100;
  const yr = new Date().getFullYear().toString();
  const thisYear = rows.filter(r => String(r.request_date).startsWith(yr));
  const approvedRate = thisYear.length ? Math.round((thisYear.filter(r => !['rejected', 'cancelled', 'pending'].includes(r.status)).length / thisYear.length) * 100) : 0;

  return (
    <>
      <PageHeader title="طلبات القروض" subtitle="من الطلب إلى القرار ثم الصرف — الاعتماد لا يعني الصرف" />
      <Band>
        <div className="grid items-center gap-6 lg:grid-cols-[auto_1fr]">
          <Ring pct={cover} size={124} stroke={11} color={cover >= 100 ? '#9fd3b4' : '#f0b59c'} track="rgba(255,255,255,0.12)">
            <span className="flex flex-col items-center text-center leading-tight"><span className="text-2xl font-semibold num-cell">{Math.round(cover)}%</span><span className="text-[10px] text-brand-200">قدرة الإقراض</span></span>
          </Ring>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <BandStat big label="المتاح للإقراض" value={sar(lendable)} tone="gold" sub={`سيولة ${sar(liquid)} − احتياطي ${sar(reserve)}`} />
            <BandStat label="طلبات جديدة" value={sar(tot(pending, 'requested_amount'))} sub={`${pending.length} طلب`} />
            <BandStat label="معتمد بانتظار الصرف" value={sar(tot(approved, 'approved_amount'))} sub={`${approved.length} قرض`} />
            <BandStat label={`نسبة القبول ${yr}`} value={`${approvedRate}%`} tone="pos" sub={`${thisYear.length} طلب هذه السنة`} />
          </div>
        </div>
      </Band>

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'board', label: 'لوحة القرارات', count: pending.length + approved.length },
        { key: 'closed', label: 'مرفوضة / ملغاة', count: closed.length }, { key: 'all', label: 'السجل الكامل' },
      ]} />

      {tab === 'board' && <RescheduleRequests />}
      {tab === 'board' ? (
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gold-700"><Clock3 className="size-4" />بانتظار قرارك <span className="rounded-full bg-gold-100 px-2 text-xs num">{pending.length}</span></h2>
            {pending.length === 0 ? <Card><p className="flex flex-col items-center gap-2 py-8 text-sm text-muted"><Sparkles className="size-7 text-gold-500" />لا توجد طلبات جديدة — كل شي محسوم</p></Card> :
              <div className="grid gap-4 sm:grid-cols-2">{pending.map(r => <RequestCard key={r.id} r={r} />)}</div>}
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-700"><HandCoins className="size-4" />معتمدة — جاهزة للصرف <span className="rounded-full bg-brand-50 px-2 text-xs num">{approved.length}</span></h2>
            <div className="space-y-3">
              {approved.length === 0 ? <Card><p className="py-6 text-center text-sm text-muted">لا توجد قروض بانتظار الصرف</p></Card> : approved.map(r => (
                <button key={r.id} onClick={() => go(`/admin/loans/view/?id=${r.id}`)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-start transition hover:border-gold-500">
                  <Avatar name={r.member_name} size={34} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{r.member_name}</span>
                    <span className="block text-xs text-muted"><span className="num">{r.installments_count}</span> قسط · اعتُمد {date(r.approved_at ?? r.request_date)}</span></span>
                  <span className="text-end"><span className="block font-semibold num-cell">{sar(r.approved_amount)}</span><span className="text-[11px] text-brand-600">صرف ←</span></span>
                </button>))}
            </div>
            {closed.length > 0 && <div className="mt-5 rounded-xl bg-canvas p-3 text-xs text-muted"><XCircle className="me-1 inline size-3.5" />آخر رفض: {closed[0].member_name} — {sar(closed[0].requested_amount)}{closed[0].decision_note ? ` · ${closed[0].decision_note}` : ''}</div>}
          </section>
        </div>
      ) : (
        <Card pad={false}>
          <DataTable rows={tab === 'closed' ? closed : rows} loading={d.loading} searchable={r => `${r.member_name} ${r.loan_no} ${r.purpose}`}
            onRowClick={r => (go(`/admin/loans/view/?id=${r.id}`))} empty="لا توجد طلبات"
            columns={[
              { key: 'loan_no', header: 'الرقم', render: r => <span className="num text-xs text-muted">{r.loan_no}</span> },
              { key: 'request_date', header: 'تاريخ الطلب', render: r => date(r.request_date) },
              { key: 'member_name', header: 'العضو', render: r => <span className="flex items-center gap-2"><Avatar name={r.member_name} size={26} /><span className="font-medium">{r.member_name}</span></span> },
              { key: 'requested_amount', header: 'المطلوب', align: 'end', render: r => sar(r.requested_amount) },
              { key: 'approved_amount', header: 'المعتمد', align: 'end', render: r => r.approved_amount ? sar(r.approved_amount) : '—' },
              { key: 'preferred_months', header: 'المدة', render: r => `${r.preferred_months} شهر` },
              { key: 'purpose', header: 'الغرض', className: 'max-w-[220px] truncate' },
              { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
            ]} />
        </Card>
      )}
    </>
  );
}
