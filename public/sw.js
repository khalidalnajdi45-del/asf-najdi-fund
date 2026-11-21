/* صندوق النجدي الادخاري — service worker: Web Push only (no offline caching, so updates are never stale). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const route = link => {
  if (!link) return '';
  const [p, q] = link.split('?');
  return '#' + (p.endsWith('/') ? p : p + '/') + (q ? '?' + q : '');
};

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'صندوق النجدي الادخاري', body: e.data ? e.data.text() : '' }; }
  const url = self.registration.scope + route(d.link);
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'صندوق النجدي الادخاري', {
      body: d.body || '', icon: 'app-icons/icon-192.png', badge: 'app-icons/icon-192.png',
      dir: 'rtl', lang: 'ar', tag: d.id || d.tag, data: { url },
    }),
    typeof d.badge === 'number' && self.navigator.setAppBadge
      ? (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {})
      : Promise.resolve(),
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); try { await c.navigate(url); } catch { c.postMessage({ type: 'open', url }); } return; }
    }
    await self.clients.openWindow(url);
  })());
});
