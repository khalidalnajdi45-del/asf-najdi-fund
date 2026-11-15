// Refreshes Tadawul prices for the fund's portfolio holdings (Yahoo Finance chart API, symbol.SR).
// Called by pg_cron (x-cron-secret) during market hours, and by the fund manager from the app (Bearer JWT).
// Body: { sync?: boolean } — when true, also books the portfolio's market value in the ledger (daily close).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';

async function quote(symbol: string): Promise<{ symbol: string; price: number; prev_close: number | null } | null> {
  const ticker = /^\d{4}$/.test(symbol) ? `${symbol}.SR` : symbol;
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=5m`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ASF-Fund/1.0)', Accept: 'application/json' },
      });
      if (!r.ok) continue;
      const meta = (await r.json())?.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice);
      if (!price) continue;
      const prev = Number(meta?.chartPreviousClose ?? meta?.previousClose);
      return { symbol, price, prev_close: prev || null };
    } catch { /* try next host */ }
  }
  return null;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  let allowed = false;
  const cron = req.headers.get('x-cron-secret');
  if (cron) {
    const { data } = await admin.rpc('cron_secret_ok', { p: cron });
    allowed = data === true;
  } else {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    if (u?.user) {
      const { data: au } = await admin.from('app_users').select('role, is_active').eq('id', u.user.id).maybeSingle();
      allowed = au?.role === 'manager' && au?.is_active === true;
    }
  }
  if (!allowed) return json({ error: 'غير مصرح — هذه العملية لمدير الصندوق فقط' }, 401);

  const body = await req.json().catch(() => ({})) as { sync?: boolean };
  const { data: rows, error } = await admin.from('portfolio_holdings').select('symbol');
  if (error) return json({ error: error.message }, 500);
  const symbols = [...new Set((rows ?? []).map((r: any) => r.symbol as string))];
  const quotes = await Promise.all(symbols.map(quote));
  const ok = quotes.filter(Boolean) as { symbol: string; price: number; prev_close: number | null }[];
  const failed = symbols.filter(s => !ok.find(q => q.symbol === s));
  let updated = 0;
  if (ok.length) {
    const { data, error: e2 } = await admin.rpc('apply_market_prices', { p: ok });
    if (e2) return json({ error: e2.message }, 500);
    updated = data as number;
  }
  let synced = 0;
  if (body.sync) {
    const { data, error: e3 } = await admin.rpc('sync_all_portfolios');
    if (e3) return json({ error: e3.message, updated }, 500);
    synced = data as number;
  }
  return json({ updated, failed, synced, prices: ok });
});
