// pf-capture — «ماليتي» automatic bank-SMS capture from an iPhone Shortcut (Message automation).
// POST { text } with header x-capture-key: <personal key>  (or ?k=<key>). The key is matched by its SHA-256 only.
// The message is parsed here (same parser as the app) and only the parsed fields are stored — never the SMS text.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { parseSms } from './bank-sms.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-capture-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
const env = (k: string) => Deno.env.get(k) ?? '';
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  const url = new URL(req.url);
  const key = (req.headers.get('x-capture-key') ?? url.searchParams.get('k') ?? '').trim();
  if (!/^pf_[0-9a-f]{48}$/.test(key)) return json({ ok: false, error: 'المفتاح غير صحيح' }, 401);

  // Shortcuts may send JSON, form data or plain text — accept all three
  let text = '';
  const ct = req.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) { const b = await req.json(); text = String(b.text ?? b.message ?? b.body ?? ''); }
    else if (ct.includes('form')) { const f = await req.formData(); text = String(f.get('text') ?? ''); }
    else text = await req.text();
  } catch { /* empty */ }
  text = text.trim().slice(0, 2000);
  if (!text) return json({ ok: false, error: 'لا يوجد نص رسالة' }, 400);

  const p = parseSms(text);
  if (!p) return json({ ok: false, skipped: true, error: 'ليست رسالة عملية مالية' });   // OTPs etc. — ignored quietly

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('pf_capture', {
    p_key_hash: await sha(key), p_kind: p.kind, p_amount: p.amount, p_cat_name: p.guess, p_date: p.date,
    p_note: p.merchant, p_sms_hash: await sha(text.replace(/\s+/g, ' ')),
  });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ...data, kind: p.kind, amount: p.amount, merchant: p.merchant });
});
