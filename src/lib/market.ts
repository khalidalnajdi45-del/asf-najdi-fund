'use client';
import { IS_DEMO, supabase } from './supabase';

export type PriceResult = { updated: number; failed: string[]; synced: number; demo?: boolean };

/** Pulls the latest Tadawul prices for every holding; `sync` also books the portfolio value in the ledger. */
export async function refreshPrices(sync = false): Promise<PriceResult> {
  if (IS_DEMO) { const { demoMarketTick } = await import('./demo/client'); return demoMarketTick(sync); }
  const { data, error } = await (supabase() as any).functions.invoke('refresh-prices', { body: { sync } });
  if (error) {
    let msg = error.message as string;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data as PriceResult;
}

/** Tadawul trading session: Sunday–Thursday, 10:00–15:00 Riyadh. */
export function marketOpen(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const wd = p.find(x => x.type === 'weekday')!.value, h = Number(p.find(x => x.type === 'hour')!.value), m = Number(p.find(x => x.type === 'minute')!.value);
  return !['Fri', 'Sat'].includes(wd) && h * 60 + m >= 600 && h * 60 + m < 900;
}
