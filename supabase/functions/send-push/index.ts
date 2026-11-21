// send-push — Web Push (iPhone home-screen app, Android, desktop) for the fund's notifications.
//  • Database hook (pg_net, header x-cron-secret): { notification_id } → push it to the owner's devices.
//  • Signed-in user: { action: 'public_key' } → VAPID public key for subscribing; { action: 'test' } → test push.
// The VAPID key pair is generated here on first use and kept in public.push_vapid (service_role only) — no manual secret.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';
const SUBJECT = 'https://khalidalnajdi45-del.github.io/asf-najdi-fund/';

const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

async function vapid() {
  let { data } = await admin.from('push_vapid').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (!data) {
    const k = webpush.generateVAPIDKeys();
    await admin.from('push_vapid').upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: 'id', ignoreDuplicates: true });
    ({ data } = await admin.from('push_vapid').select('public_key, private_key').eq('id', 1).single());
  }
  webpush.setVapidDetails(SUBJECT, data!.public_key, data!.private_key);
  return data!.public_key as string;
}

async function sendTo(userId: string, payload: Record<string, unknown>) {
  await vapid();
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false);
  const body = JSON.stringify({ ...payload, badge: count ?? 0 });
  let sent = 0, gone = 0, failed = 0;
  await Promise.all((subs ?? []).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body,
        { TTL: 60 * 60 * 24, urgency: payload.urgent ? 'high' : 'normal', topic: undefined });
      sent++;
      await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { gone++; await admin.from('push_subscriptions').delete().eq('id', s.id); }
      else { failed++; console.error('push failed', code, String((e as Error).message ?? e).slice(0, 200)); }
    }
  }));
  return { sent, gone, failed };
}

const URGENT = new Set(['contribution_overdue', 'repayment_overdue', 'due_today', 'task_reminder', 'loan_request', 'withdrawal_request']);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const body = await req.json().catch(() => ({})) as { notification_id?: string; action?: string };

  // 1) database hook
  const secret = req.headers.get('x-cron-secret');
  if (secret) {
    const { data: ok } = await admin.rpc('cron_secret_ok', { p: secret });
    if (!ok) return json({ error: 'forbidden' }, 403);
    if (!body.notification_id) return json({ error: 'notification_id required' }, 400);
    const { data: n } = await admin.from('notifications').select('id, user_id, type, title, body, link').eq('id', body.notification_id).maybeSingle();
    if (!n) return json({ error: 'not found' }, 404);
    const r = await sendTo(n.user_id, { id: n.id, title: n.title, body: n.body ?? '', link: n.link, tag: n.type, urgent: URGENT.has(n.type) });
    return json(r);
  }

  // 2) signed-in user
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null };
  if (!u?.user) return json({ error: 'سجّل الدخول أولاً' }, 401);
  if (body.action === 'public_key') return json({ key: await vapid() });
  if (body.action === 'test') {
    const r = await sendTo(u.user.id, { title: 'صندوق النجدي الادخاري', body: 'تم تفعيل الإشعارات على هذا الجهاز ✓', link: null, tag: 'push_test' });
    return json(r);
  }
  return json({ error: 'unknown action' }, 400);
});
