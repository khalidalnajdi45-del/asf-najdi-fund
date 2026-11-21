// Web Push on iPhone (iOS 16.4+, home-screen app), Android and desktop browsers.
import { rpc, supabase, IS_DEMO } from './supabase';

export const PUSH_BUILD = process.env.NEXT_PUBLIC_PUSH === '1';   // only the real site (GitHub Pages) ships sw.js

export const isIOS = () => typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const isStandalone = () => typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export type PushState = 'demo' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

export async function registerSW() {
  if (!PUSH_BUILD || IS_DEMO || !('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('./sw.js', { scope: './' }); } catch { return null; }
}

async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration('./');
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushState(): Promise<PushState> {
  if (IS_DEMO || !PUSH_BUILD) return 'demo';
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentSub()) ? 'on' : 'off';
}

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};
const bytesToB64 = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))) : '');

async function invoke<T>(body: object): Promise<T> {
  const { data, error } = await (supabase() as any).functions.invoke('send-push', { body });
  if (error) throw new Error(error.message || 'تعذر الاتصال بخدمة الإشعارات');
  if (data?.error) throw new Error(data.error);
  return data as T;
}

/** Must be called from a tap (iOS only shows the permission prompt for a user gesture). */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'الإشعارات مرفوضة — فعّلها من إعدادات الآيفون ← الإشعارات ← صندوق النجدي' : 'لم يتم السماح بالإشعارات');
  const reg = (await registerSW()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const { key } = await invoke<{ key: string }>({ action: 'public_key' });
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await rpc('save_push_subscription', {
    p_endpoint: sub.endpoint, p_p256dh: bytesToB64(sub.getKey('p256dh')), p_auth: bytesToB64(sub.getKey('auth')),
    p_ua: navigator.userAgent,
  });
  return sub;
}

export async function disablePush() {
  const sub = await currentSub();
  if (!sub) return;
  await rpc('delete_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export const testPush = () => invoke<{ sent: number }>({ action: 'test' });

/** Keep the home-screen icon badge in step with unread notifications. */
export function setBadge(n: number) {
  const nav = navigator as any;
  if (!nav.setAppBadge) return;
  (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge()).catch(() => {});
}
