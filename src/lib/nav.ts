// Navigation that works in both builds: the normal multi-page site, and the single-file HTML demo
// (NEXT_PUBLIC_SPA=1) where every route lives in the URL hash.
export const IS_SPA = process.env.NEXT_PUBLIC_SPA === '1';

export function go(url: string, replace = false) {
  if (IS_SPA) {
    const h = '#' + url;
    if (replace) location.replace(h); else location.hash = url;
    return;
  }
  if (replace) location.replace(url); else location.href = url;
}

export function currentPath(): string {
  if (!IS_SPA) return location.pathname;
  const p = location.hash.slice(1).split('?')[0] || '/';
  return p.endsWith('/') ? p : `${p}/`;
}

export function currentSearch(): string {
  if (!IS_SPA) return location.search;
  const q = location.hash.split('?')[1];
  return q ? `?${q}` : '';
}
