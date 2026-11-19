// Sends the monthly account reports by e-mail (Arabic, RTL).
// Called by pg_cron on the 1st (x-cron-secret header) or by the fund manager from the app (Bearer JWT).
// Provider: Gmail SMTP (GMAIL_USER + GMAIL_APP_PASSWORD) or Resend (RESEND_API_KEY + MAIL_FROM).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import nodemailer from 'npm:nodemailer@6.9.14';
import { Buffer } from 'node:buffer';
import { buildMessageEmail, buildReportEmail, BANNER_CID } from './report-email.ts';

// Brand banner (full Arabic lockup). Cached in a private Storage bucket; seeded once from the repo.
const BANNER_VERSION = 'v2';
const BANNER_SOURCE = 'https://raw.githubusercontent.com/khalidalnajdi45-del/asf-najdi-fund/main/public/brand/email-banner.png';
async function loadBanner(admin: any): Promise<Uint8Array | null> {
  const path = `banner-${BANNER_VERSION}.png`;
  try {
    const { data } = await admin.storage.from('email-assets').download(path);
    if (data) return new Uint8Array(await data.arrayBuffer());
    const r = await fetch(Deno.env.get('BANNER_URL') || BANNER_SOURCE);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    await admin.storage.from('email-assets').upload(path, bytes, { contentType: 'image/png', upsert: true });
    return bytes;
  } catch { return null; }
}

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

  const body = await req.json().catch(() => ({})) as { period?: string; ids?: string[]; resend?: boolean; test_to?: string; message_id?: string; retry?: boolean; credentials?: { member_id: string; username: string; password: string } };
  const { data: settings } = await admin.from('fund_settings').select('fund_name, monthly_report_email').eq('id', 1).single();
  if (byCron && settings && !settings.monthly_report_email) return json({ skipped: 'الإرسال بالبريد متوقف من الإعدادات' });

  // ---- provider
  const gmailUser = env('GMAIL_USER'), gmailPass = env('GMAIL_APP_PASSWORD').replace(/\s+/g, ''), resendKey = env('RESEND_API_KEY');
  if (!resendKey && !(gmailUser && gmailPass)) {
    return json({ error: 'لم يُضبط مزود البريد بعد — أضف GMAIL_USER و GMAIL_APP_PASSWORD في أسرار Edge Functions' }, 503);
  }
  const fundName = settings?.fund_name || 'صندوق النجدي الادخاري';
  const banner = await loadBanner(admin);
  const bannerSrc = banner ? `cid:${BANNER_CID}` : null;
  const bannerB64 = banner ? Buffer.from(banner).toString('base64') : '';
  const smtp = !resendKey ? nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: gmailUser, pass: gmailPass } }) : null;
  const send = async (to: string, m: { subject: string; html: string; text: string }) => {
    if (smtp) {
      await smtp.sendMail({ from: { name: fundName, address: gmailUser }, to, subject: m.subject, html: m.html, text: m.text,
        attachments: banner ? [{ filename: 'asf.png', content: Buffer.from(banner), cid: BANNER_CID, contentType: 'image/png' }] : [] });
    } else {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env('MAIL_FROM') || `${fundName} <onboarding@resend.dev>`, to: [to], subject: m.subject, html: m.html, text: m.text,
          attachments: banner ? [{ filename: 'asf.png', content: bannerB64, content_id: BANNER_CID }] : [] }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  };

  // ---- login details for one member (manager only; username must match that member)
  if (body.credentials) {
    if (byCron) return json({ error: 'غير مصرح' }, 401);
    const c = body.credentials;
    const { data: m } = await admin.from('members').select('id, full_name, username').eq('id', c.member_id).maybeSingle();
    if (!m || !m.username || m.username !== c.username || !c.password) return json({ error: 'بيانات الحساب غير مطابقة' }, 400);
    const { data: to } = await admin.rpc('member_email', { p_member: m.id });
    if (!to) return json({ error: 'لا يوجد بريد شخصي لهذا العضو — أضفه من «تعديل» أولاً' }, 400);
    const portalUrl = env('PORTAL_URL') || 'https://khalidalnajdi45-del.github.io/asf-najdi-fund/';
    const first = String(m.full_name).replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
    try {
      await send(to, buildMessageEmail({
        subject: `بيانات دخولك — ${fundName}`,
        body: `أهلاً ${first}،\n\nتم تجهيز حسابك في منصة ${fundName}، وتقدر منها تتابع اشتراكاتك وودائعك وقروضك وتقاريرك الشهرية.\n\nاسم المستخدم: ${m.username}\nكلمة المرور المؤقتة: ${c.password}\n\nسيُطلب منك اختيار كلمة مرور جديدة عند أول دخول. لا تشارك هذه البيانات مع أحد.`,
        fields: {}, fund_name: fundName, portal_url: portalUrl, banner_src: bannerSrc,
      }));
      return json({ sent: true, to });
    } catch (err) {
      return json({ error: String((err as Error)?.message ?? err).slice(0, 300) }, 502);
    }
  }

  // ---- test message with sample figures (no member data involved)
  // ---- manager's message / reminder to selected members
  if (body.message_id) {
    if (byCron) return json({ error: 'غير مصرح' }, 401);
    const { data: q, error: e } = await admin.rpc('message_recipients_pending', { p_message: body.message_id, p_retry: !!body.retry });
    if (e) return json({ error: e.message }, 500);
    const portalUrl = env('PORTAL_URL') || 'https://khalidalnajdi45-del.github.io/asf-najdi-fund/';
    let sent = 0, failed = 0;
    for (const r of q ?? []) {
      try {
        await send(r.email, buildMessageEmail({ subject: r.subject, body: r.body, fields: r.fields ?? {}, fund_name: fundName, portal_url: portalUrl, banner_src: bannerSrc }));
        await admin.rpc('mark_message_recipient', { p_id: r.id, p_error: null }); sent++;
      } catch (err) {
        failed++; await admin.rpc('mark_message_recipient', { p_id: r.id, p_error: String((err as Error)?.message ?? err).slice(0, 300) });
      }
      if (smtp) await new Promise(res => setTimeout(res, 400));
    }
    return json({ total: q?.length ?? 0, sent, failed });
  }

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
      await send(body.test_to, buildReportEmail({ id: 'test', report: sample, note: 'هذه رسالة تجربة للتأكد من وصول تقارير الصندوق إلى البريد.', member_name: 'خالد', banner_src: bannerSrc, portal_url: env('PORTAL_URL') || 'https://khalidalnajdi45-del.github.io/asf-najdi-fund/' }));
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
      await send(r.email, buildReportEmail({ id: r.id, report: r.report, note: r.note, member_name: r.member_name, banner_src: bannerSrc, portal_url: portal }));
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
