// Sends the monthly account reports by e-mail (Arabic, RTL).
// Called by pg_cron on the 1st (x-cron-secret header) or by the fund manager from the app (Bearer JWT).
// Provider: Gmail SMTP (GMAIL_USER + GMAIL_APP_PASSWORD) or Resend (RESEND_API_KEY + MAIL_FROM).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import nodemailer from 'npm:nodemailer@6.9.14';
import { buildReportEmail } from './report-email.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  // ---- who is calling
  let byCron = false, allowed = false;
  const cronHeader = req.headers.get('x-cron-secret');
  if (cronHeader) {
    const { data } = await admin.rpc('cron_secret_ok', { p: cronHeader });
    allowed = byCron = data === true;
  } else {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    if (u?.user) {
      const { data: au } = await admin.from('app_users').select('role, is_active').eq('id', u.user.id).maybeSingle();
      allowed = au?.role === 'manager' && au?.is_active === true;
    }
  }
  if (!allowed) return json({ error: 'غير مصرح — هذه العملية لمدير الصندوق فقط' }, 401);

  const body = await req.json().catch(() => ({})) as { period?: string; ids?: string[]; resend?: boolean; test_to?: string };
  const { data: settings } = await admin.from('fund_settings').select('fund_name, monthly_report_email').eq('id', 1).single();
  if (byCron && settings && !settings.monthly_report_email) return json({ skipped: 'الإرسال بالبريد متوقف من الإعدادات' });

  // ---- provider
  const gmailUser = env('GMAIL_USER'), gmailPass = env('GMAIL_APP_PASSWORD').replace(/\s+/g, ''), resendKey = env('RESEND_API_KEY');
  if (!resendKey && !(gmailUser && gmailPass)) {
    return json({ error: 'لم يُضبط مزود البريد بعد — أضف GMAIL_USER و GMAIL_APP_PASSWORD في أسرار Edge Functions' }, 503);
  }
  const fundName = settings?.fund_name || 'صندوق النجدي الادخاري';
  const smtp = !resendKey ? nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: gmailUser, pass: gmailPass } }) : null;
  const send = async (to: string, m: { subject: string; html: string; text: string }) => {
    if (smtp) {
      await smtp.sendMail({ from: { name: fundName, address: gmailUser }, to, subject: m.subject, html: m.html, text: m.text });
    } else {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env('MAIL_FROM') || `${fundName} <onboarding@resend.dev>`, to: [to], subject: m.subject, html: m.html, text: m.text }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  };

  // ---- test message with sample figures (no member data involved)
  if (body.test_to) {
    const sample = {
      period_label: 'نموذج تجريبي', fund_name: fundName, generated_at: new Date().toISOString(),
      member: { full_name: 'رسالة تجربة', member_no: 'M-0000' },
      contribution: { month: { status: 'paid', outstanding: 0 }, paid_in_month: 200, total_paid: 2400, arrears_months: 0, arrears_amount: 0 },
      deposits: { opening: 5000, in: 1000, out: 0, closing: 6000 },
      loans: { outstanding: 0, paid_in_month: 0, items: [] },
      activity: [{ date: new Date().toISOString().slice(0, 10), type: 'contribution_payment', amount: 200 }],
      net_position: 8400, fund: { active_members: 0 },
    };
    try {
      await send(body.test_to, buildReportEmail({ id: 'test', report: sample, note: 'هذه رسالة تجربة للتأكد من وصول تقارير الصندوق إلى البريد.', member_name: 'خالد', portal_url: env('PORTAL_URL') || 'https://khalidalnajdi45-del.github.io/asf-najdi-fund/' }));
      return json({ test: 'sent', to: body.test_to });
    } catch (e) { return json({ test: 'failed', error: String((e as Error)?.message ?? e) }, 502); }
  }

  // ---- recipients
  const { data: rows, error } = await admin.rpc('reports_to_email', {
    p_period: body.period ?? null, p_ids: body.ids?.length ? body.ids : null, p_resend: !!body.resend,
  });
  if (error) return json({ error: error.message }, 500);

  const portal = env('PORTAL_URL') || 'https://khalidalnajdi45-del.github.io/asf-najdi-fund/';
  let sent = 0, failed = 0, noEmail = 0;
  for (const r of rows ?? []) {
    if (!r.email) { noEmail++; await admin.rpc('mark_report_emailed', { p_id: r.id, p_to: null, p_error: 'لا يوجد بريد إلكتروني للعضو' }); continue; }
    try {
      await send(r.email, buildReportEmail({ id: r.id, report: r.report, note: r.note, member_name: r.member_name, portal_url: portal }));
      await admin.rpc('mark_report_emailed', { p_id: r.id, p_to: r.email, p_error: null });
      sent++;
    } catch (e) {
      failed++;
      await admin.rpc('mark_report_emailed', { p_id: r.id, p_to: r.email, p_error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
    if (smtp) await new Promise(res => setTimeout(res, 400));   // stay well inside Gmail's rate limits
  }
  return json({ total: rows?.length ?? 0, sent, failed, no_email: noEmail });
});
