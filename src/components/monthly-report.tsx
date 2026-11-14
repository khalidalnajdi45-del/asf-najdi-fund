'use client';
import clsx from 'clsx';
import { date, dateTime, num, pct, sar } from '@/lib/format';
import { statusLabels, txTypeLabels } from '@/lib/labels';
import { Badge } from './ui';

export type ReportRow = {
  id: string; member_id: string; period: string; report: any; note: string | null; created_at: string; read_at: string | null;
};

const MONTHS_SHORT = ['ينا', 'فبر', 'مار', 'أبر', 'ماي', 'يون', 'يول', 'أغس', 'سبت', 'أكت', 'نوف', 'ديس'];
const dotTone: Record<string, string> = { paid: 'bg-pos', partial: 'bg-gold-500', overdue: 'bg-neg', unpaid: 'bg-line-strong' };

/** The member-facing monthly account report. Renders a frozen snapshot — never live figures. */
export function MonthlyReportView({ row }: { row: ReportRow }) {
  const r = row.report;
  const c = r.contribution ?? {}, d = r.deposits ?? {}, l = r.loans ?? {};
  const month = c.month;
  return (
    <article className="print-area overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="shurfa relative overflow-hidden bg-brand-900 px-6 py-6 text-white sm:px-8">
        <img src="/brand/mark-plum.svg" alt="" aria-hidden className="pointer-events-none absolute -bottom-10 -left-6 w-48 opacity-60" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-gold-300"><img src="/brand/mark-gold.svg" alt="" className="h-5 w-6" />{r.fund_name}</div>
            <h2 className="mt-2 font-display text-2xl font-semibold sm:text-[28px]">تقرير حسابك — {r.period_label}</h2>
            <p className="mt-1 text-sm text-brand-100">{r.member?.full_name} · <span className="num">{r.member?.member_no}</span></p>
          </div>
          <div className="text-left text-xs text-brand-200">
            <div>من {date(r.from)} إلى {date(r.to)}</div>
            <div className="mt-0.5">صدر في {dateTime(r.generated_at)}</div>
          </div>
        </div>
      </header>

      <section className="border-b border-line bg-canvas px-6 py-5 sm:px-8">
        <div className="text-xs font-medium text-muted">صافي مركزك في الصندوق</div>
        <div className="mt-1 font-display text-[34px] font-semibold leading-none text-ink num">{sar(r.net_position)}</div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
          <span>اشتراكات <b className="num">{sar(c.total_paid)}</b></span><span className="text-muted">+</span>
          <span>ودائع <b className="num">{sar(d.closing)}</b></span>
          {num(l.outstanding) > 0 && <><span className="text-muted">−</span><span>قروض قائمة <b className="num">{sar(l.outstanding)}</b></span></>}
        </div>
      </section>

      <div className="grid gap-px bg-line md:grid-cols-3">
        <Block title="الاشتراك الشهري">
          <Row k={`اشتراك ${r.period_label}`} v={month ? <Badge status={month.status} /> : '—'} />
          {month && num(month.outstanding) > 0 && <Row k="المتبقي من الشهر" v={sar(month.outstanding)} tone="neg" />}
          <Row k="المدفوع خلال الشهر" v={sar(c.paid_in_month)} />
          <Row k="إجمالي اشتراكاتك" v={sar(c.total_paid)} strong />
          {num(c.arrears_months) > 0
            ? <Row k={`متأخرات (${c.arrears_months} ${num(c.arrears_months) > 2 ? 'أشهر' : 'شهر'})`} v={sar(c.arrears_amount)} tone="neg" />
            : <Row k="المتأخرات" v="لا يوجد ✓" tone="pos" />}
          {Array.isArray(c.year) && c.year.length > 0 && (
            <div className="pt-2">
              <div className="mb-1.5 text-[11px] text-muted">التزامك هذا العام</div>
              <div className="flex flex-wrap gap-1.5">
                {c.year.map((y: any) => (
                  <span key={y.period} title={statusLabels[y.status]?.[0]} className="flex flex-col items-center gap-0.5">
                    <span className={clsx('size-3 rounded-full', dotTone[y.status] ?? 'bg-line')} />
                    <span className="text-[9px] text-muted">{MONTHS_SHORT[Number(String(y.period).slice(5, 7)) - 1]}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Block>

        <Block title="الودائع الاختيارية">
          <Row k="الرصيد أول الشهر" v={sar(d.opening)} />
          <Row k="إيداعات" v={num(d.in) ? `+ ${sar(d.in)}` : sar(0)} tone={num(d.in) ? 'pos' : undefined} />
          <Row k="سحوبات مصروفة" v={num(d.out) ? `− ${sar(d.out)}` : sar(0)} />
          <Row k="الرصيد آخر الشهر" v={sar(d.closing)} strong />
        </Block>

        <Block title="القروض">
          {!l.items?.length ? <p className="py-2 text-sm text-muted">لا توجد قروض قائمة</p> : l.items.map((x: any) => (
            <div key={x.loan_no} className="space-y-1.5 border-b border-dashed border-line pb-2 last:border-0">
              <div className="flex items-center justify-between text-sm"><span className="num font-medium">{x.loan_no}</span><Badge status={x.status} /></div>
              <Row k="المتبقي" v={sar(x.outstanding)} strong />
              {x.next_due_date && <Row k="القسط القادم" v={`${sar(x.next_amount)} · ${date(x.next_due_date)}`} />}
              {num(x.overdue_amount) > 0 && <Row k="أقساط متأخرة" v={sar(x.overdue_amount)} tone="neg" />}
            </div>
          ))}
          {num(l.paid_in_month) > 0 && <Row k="سددت خلال الشهر" v={sar(l.paid_in_month)} tone="pos" />}
        </Block>
      </div>

      <section className="border-t border-line px-6 py-5 sm:px-8">
        <h3 className="mb-2 text-sm font-semibold">حركات الشهر</h3>
        {!r.activity?.length ? <p className="text-sm text-muted">لا توجد حركات مالية خلال الشهر</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {r.activity.map((a: any, i: number) => (
                  <tr key={i}>
                    <td className="py-2 pe-3 text-muted num-cell">{date(a.date)}</td>
                    <td className="py-2 pe-3">{txTypeLabels[a.type] ?? a.type}<span className="block text-xs text-muted">{a.description}</span></td>
                    <td className="py-2 text-left num-cell font-medium">{sar(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {row.note && (
        <section className="mx-6 mb-5 rounded-xl border border-gold-100 bg-gold-100/50 px-4 py-3 text-sm sm:mx-8">
          <div className="mb-0.5 text-xs font-semibold text-gold-700">كلمة من إدارة الصندوق</div>
          <p className="text-ink-2">{row.note}</p>
        </section>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-canvas px-6 py-3 text-xs text-muted sm:px-8">
        <span>الصندوق: <span className="num">{r.fund?.active_members}</span> عضواً نشطاً · نسبة تحصيل اشتراكات الشهر <bdi>{pct(r.fund?.collection_rate, 0)}</bdi></span>
        <span>هذا التقرير لقطة بتاريخ إصداره؛ كشف الحساب يعرض الأرصدة المحدثة</span>
      </footer>
    </article>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2 bg-surface px-6 py-5 sm:px-8 md:px-5"><h3 className="mb-1 text-sm font-semibold">{title}</h3>{children}</section>;
}
function Row({ k, v, strong, tone }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean; tone?: 'pos' | 'neg' }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{k}</span>
      <span className={clsx('num-cell', strong && 'font-semibold text-ink', tone === 'pos' && 'text-pos', tone === 'neg' && 'text-neg')}>{v}</span>
    </div>
  );
}

/** Short plain-text version for WhatsApp / SMS. */
export function reportText(row: ReportRow) {
  const r = row.report, c = r.contribution ?? {}, d = r.deposits ?? {}, l = r.loans ?? {};
  const first = String(r.member?.full_name ?? '').split(/\s+/)[0];
  const lines = [
    `السلام عليكم ${first}،`,
    `هذا ملخص حسابك في ${r.fund_name} لشهر ${r.period_label}:`,
    '',
    `• اشتراك الشهر: ${c.month ? statusLabels[c.month.status]?.[0] ?? c.month.status : '—'}`,
    `• إجمالي اشتراكاتك: ${sar(c.total_paid)}`,
    num(c.arrears_months) > 0 ? `• متأخرات: ${sar(c.arrears_amount)} (${c.arrears_months} شهر)` : '• لا توجد متأخرات ✓',
    `• رصيد ودائعك: ${sar(d.closing)}`,
    num(l.outstanding) > 0 ? `• المتبقي من القروض: ${sar(l.outstanding)}` : '',
    ...(l.items ?? []).filter((x: any) => x.next_due_date).map((x: any) => `• القسط القادم: ${sar(x.next_amount)} بتاريخ ${date(x.next_due_date)}`),
    `• صافي مركزك: ${sar(r.net_position)}`,
    row.note ? `\n${row.note}` : '',
    '',
    'التفاصيل كاملة في بوابة الأعضاء.',
  ];
  return lines.filter((x, i) => x !== '' || lines[i - 1] !== '').join('\n').trim();
}

/** wa.me link for a Saudi mobile number; null when the number is missing or unusable. */
export function waLink(phone: string | null | undefined, text: string) {
  let p = (phone ?? '').replace(/\D/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('05')) p = '966' + p.slice(1);
  else if (p.startsWith('5') && p.length === 9) p = '966' + p;
  if (!/^\d{11,15}$/.test(p)) return null;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
