import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDemoClient } from './demo/client';

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client && IS_DEMO) client = createDemoClient() as unknown as SupabaseClient;
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('إعدادات Supabase غير مكتملة (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)');
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'najdi-fund-auth' } });
  }
  return client!;
}

/** Call a server-side API function. Throws an Error carrying the (Arabic) database message. */
export async function rpc<T = any>(fn: string, params: Record<string, any> = {}): Promise<T> {
  const { data, error } = await supabase().rpc(fn, params);
  if (error) throw new Error(cleanError(error.message));
  return data as T;
}

export function cleanError(msg: string) {
  if (/JWT|jwt expired/i.test(msg)) return 'انتهت الجلسة، يرجى تسجيل الدخول من جديد';
  if (/permission denied/i.test(msg)) return 'غير مصرح بهذه العملية';
  if (/duplicate key.*idempotency/i.test(msg)) return 'تم تسجيل هذه العملية مسبقاً';
  if (/Failed to fetch/i.test(msg)) return 'تعذر الاتصال بالخادم، تحقق من الإنترنت';
  return msg;
}

/** Idempotency key for one form session — protects against double submits. */
export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));
