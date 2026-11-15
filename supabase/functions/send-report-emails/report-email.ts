// Monthly-report e-mail (Arabic, RTL). Pure module with no imports: the same file is shipped inside the
// Supabase Edge Function that sends the mail and used by the web app for the in-app preview,
// so what the manager previews is byte-for-byte what members receive.

export type EmailReportInput = {
  id: string; report: any; note: string | null; member_name: string; portal_url: string;
  /** Image source for the fund mark. The mailer passes `cid:asf-logo` (inline attachment); the in-app preview uses the data URI. */
  logo_src?: string;
};

/** Gold ASF mark, 144×120 PNG (shown at 58×48). E-mail clients don't render SVG, hence a raster copy. */
export const LOGO_PNG_B64 = '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';
export const LOGO_CID = 'asf-logo';


const C = { plum: '#2A1733', plum2: '#4A2A5A', gold: '#B8925A', goldLight: '#D6BC8C', ivory: '#F6F1E8', paper: '#FFFDF9',
  ink: '#2A1733', muted: '#7A6F80', line: '#E8E0D3', pos: '#3F6B4E', neg: '#A8654A', goldBg: '#F3EAD9' };

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const STATUS: Record<string, string> = { paid: 'مسدد', partial: 'مسدد جزئياً', overdue: 'متأخر', unpaid: 'غير مسدد',
  active: 'نشط', disbursed: 'مصروف', overdue_loan: 'متأخر' };
const TX: Record<string, string> = { contribution_payment: 'اشتراك شهري', deposit: 'إيداع اختياري', withdrawal_payment: 'صرف سحب وديعة',
  loan_disbursement: 'صرف قرض', loan_repayment: 'سداد قرض', manual_journal: 'قيد يدوي' };

const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const money = (v: unknown) => `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n(v))} ر.س`;
const d = (v: unknown) => { if (!v) return '—'; const [y, m, dd] = String(v).slice(0, 10).split('-'); return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`; };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ltr = (s: string) => `<span dir="ltr" style="unicode-bidi:isolate;white-space:nowrap">${esc(s)}</span>`;

function row(label: string, value: string, opts: { strong?: boolean; color?: string } = {}) {
  return `<tr><td style="padding:6px 0;color:${C.muted};font-size:14px">${esc(label)}</td>
<td style="padding:6px 0;text-align:left;font-size:14px;${opts.strong ? `font-weight:700;color:${C.ink};` : ''}${opts.color ? `color:${opts.color};` : ''}">${value}</td></tr>`;
}
function section(title: string, body: string) {
  return `<tr><td style="padding:22px 28px 6px"><div style="font-size:15px;font-weight:700;color:${C.ink};margin-bottom:6px">${esc(title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${body}</table></td></tr>
<tr><td style="padding:0 28px"><div style="height:1px;background:${C.line}"></div></td></tr>`;
}

export function buildReportEmail(x: EmailReportInput) {
  const r = x.report ?? {}, c = r.contribution ?? {}, dep = r.deposits ?? {}, l = r.loans ?? {};
  const first = String(x.member_name ?? '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || '';
  const fund = r.fund_name || 'صندوق النجدي الادخاري';
  const subject = `تقرير حسابك لشهر ${r.period_label} — ${fund}`;
  const link = `${x.portal_url.replace(/\/?$/, '/')}#/member/reports/?id=${encodeURIComponent(x.id)}`;
  const month = c.month;

  const contrib = [
    row(`اشتراك ${r.period_label}`, month ? `<b style="color:${month.status === 'paid' ? C.pos : month.status === 'overdue' ? C.neg : C.gold}">${esc(STATUS[month.status] ?? month.status)}</b>` : '—'),
    month && n(month.outstanding) > 0 ? row('المتبقي من الشهر', ltr(money(month.outstanding)), { color: C.neg }) : '',
    row('المدفوع خلال الشهر', ltr(money(c.paid_in_month))),
    row('إجمالي اشتراكاتك', ltr(money(c.total_paid)), { strong: true }),
    n(c.arrears_months) > 0 ? row(`المتأخرات (${n(c.arrears_months)} شهر)`, ltr(money(c.arrears_amount)), { color: C.neg }) : row('المتأخرات', 'لا يوجد ✓', { color: C.pos }),
  ].join('');
  const deposits = [
    row('الرصيد أول الشهر', ltr(money(dep.opening))),
    row('إيداعات', ltr(money(dep.in)), n(dep.in) ? { color: C.pos } : {}),
    row('سحوبات مصروفة', ltr(money(dep.out))),
    row('الرصيد آخر الشهر', ltr(money(dep.closing)), { strong: true }),
  ].join('');
  const loans = !l.items?.length ? row('لا توجد قروض قائمة', '') : (l.items as any[]).map(it => [
    row(`القرض ${it.loan_no}`, ltr(money(it.outstanding)) + ' متبقي', { strong: true }),
    it.next_due_date ? row('القسط القادم', `${ltr(money(it.next_amount))} · ${esc(d(it.next_due_date))}`) : '',
    n(it.overdue_amount) > 0 ? row('أقساط متأخرة', ltr(money(it.overdue_amount)), { color: C.neg }) : '',
  ].join('')).join('') + (n(l.paid_in_month) > 0 ? row('سددت خلال الشهر', ltr(money(l.paid_in_month)), { color: C.pos }) : '');
  const activity = !r.activity?.length ? row('لا توجد حركات مالية خلال الشهر', '') :
    (r.activity as any[]).map(a => row(`${d(a.date)} · ${TX[a.type] ?? a.type}`, ltr(money(a.amount)))).join('');

  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.ivory};font-family:Tahoma,'Segoe UI',Arial,sans-serif;direction:rtl">
<div style="display:none;max-height:0;overflow:hidden">صافي مركزك ${esc(money(r.net_position))} — ملخص اشتراكاتك وودائعك وقروضك لشهر ${esc(r.period_label)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ivory}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:600px;background:${C.paper};border:1px solid ${C.line};border-radius:16px;overflow:hidden;text-align:right">
  <tr><td style="background:${C.plum};padding:26px 28px;color:#fff">
    <table role="presentation" cellpadding="0" cellspacing="0" dir="rtl"><tr>
      <td style="padding-left:12px;vertical-align:middle"><img src="${esc(x.logo_src ?? `data:image/png;base64,${LOGO_PNG_B64}`)}" width="58" height="48" alt="ASF" style="display:block;border:0;width:58px;height:48px"></td>
      <td style="vertical-align:middle;font-size:14px;font-weight:700;color:${C.goldLight};line-height:1.5">${esc(fund)}<br><span dir="ltr" style="font-size:11px;font-weight:400;letter-spacing:2px;color:${C.gold}">ASF</span></td>
    </tr></table>
    <div style="font-size:24px;font-weight:700;margin-top:14px;line-height:1.4">تقرير حسابك — ${esc(r.period_label)}</div>
    <div style="font-size:14px;color:#E9DFED;margin-top:4px">${esc(r.member?.full_name ?? x.member_name)} · ${ltr(r.member?.member_no ?? '')}</div>
    <div style="height:3px;width:56px;background:${C.gold};border-radius:2px;margin-top:14px"></div>
  </td></tr>
  <tr><td style="padding:22px 28px 4px;font-size:15px;color:${C.ink};line-height:1.8">السلام عليكم ${esc(first)}،<br>هذا ملخص حسابك في الصندوق لشهر ${esc(r.period_label)}.</td></tr>
  <tr><td style="padding:12px 28px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ivory};border-radius:12px"><tr><td style="padding:16px 18px">
      <div style="font-size:12px;color:${C.muted}">صافي مركزك في الصندوق</div>
      <div style="font-size:28px;font-weight:700;color:${C.ink};margin-top:4px">${ltr(money(r.net_position))}</div>
      <div style="font-size:13px;color:${C.muted};margin-top:6px">اشتراكات ${ltr(money(c.total_paid))} + ودائع ${ltr(money(dep.closing))}${n(l.outstanding) > 0 ? ` − قروض ${ltr(money(l.outstanding))}` : ''}</div>
    </td></tr></table>
  </td></tr>
  ${section('الاشتراك الشهري', contrib)}
  ${section('الودائع الاختيارية', deposits)}
  ${section('القروض', loans)}
  ${section('حركات الشهر', activity)}
  ${x.note ? `<tr><td style="padding:20px 28px 0"><div style="background:${C.goldBg};border-radius:12px;padding:14px 16px">
    <div style="font-size:12px;font-weight:700;color:${C.gold}">كلمة من إدارة الصندوق</div>
    <div style="font-size:14px;color:${C.ink};margin-top:4px;line-height:1.8">${esc(x.note).replace(/\n/g, '<br>')}</div></div></td></tr>` : ''}
  <tr><td align="center" style="padding:24px 28px 8px">
    <a href="${esc(link)}" style="display:inline-block;background:${C.plum2};color:#fff;text-decoration:none;font-size:15px;font-weight:700;padding:12px 28px;border-radius:10px">عرض التقرير في بوابة الأعضاء</a>
  </td></tr>
  <tr><td style="padding:14px 28px 24px;font-size:12px;color:${C.muted};line-height:1.8;text-align:center">
    الأرقام لقطة بتاريخ ${esc(d(String(r.generated_at ?? '').slice(0, 10)))} · الصندوق ${esc(String(r.fund?.active_members ?? ''))} عضواً نشطاً<br>
    هذه رسالة آلية من ${esc(fund)} — للاستفسار تواصل مع مدير الصندوق.
  </td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `السلام عليكم ${first}،`, `ملخص حسابك في ${fund} لشهر ${r.period_label}:`, '',
    `صافي مركزك: ${money(r.net_position)}`,
    `اشتراك الشهر: ${month ? STATUS[month.status] ?? month.status : '—'}`,
    `إجمالي اشتراكاتك: ${money(c.total_paid)}`,
    n(c.arrears_months) > 0 ? `المتأخرات: ${money(c.arrears_amount)}` : 'لا توجد متأخرات',
    `رصيد ودائعك: ${money(dep.closing)}`,
    n(l.outstanding) > 0 ? `المتبقي من القروض: ${money(l.outstanding)}` : '',
    x.note ? `\n${x.note}` : '', '', `التفاصيل: ${link}`,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}
