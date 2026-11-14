// Monthly-report e-mail (Arabic, RTL). Pure module with no imports: the same file is shipped inside the
// Supabase Edge Function that sends the mail and used by the web app for the in-app preview,
// so what the manager previews is byte-for-byte what members receive.

export type EmailReportInput = {
  id: string; report: any; note: string | null; member_name: string; portal_url: string;
};

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
    <div style="font-size:13px;color:${C.goldLight};letter-spacing:.3px">${esc(fund)} · <span dir="ltr">ASF</span></div>
    <div style="font-size:24px;font-weight:700;margin-top:8px;line-height:1.4">تقرير حسابك — ${esc(r.period_label)}</div>
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
