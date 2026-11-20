// Builds ONE self-contained HTML file of the demo (open it in any modern browser).
// The real schema + accounting engine run in-browser via PGlite loaded from jsDelivr.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const PROD = process.env.MODE === 'prod';
const ARTIFACT = process.env.MODE === 'artifact';
const env = { NEXT_PUBLIC_DEMO: PROD ? '' : '1', NEXT_PUBLIC_SPA: '1', NEXT_PUBLIC_PGLITE_LITE: ARTIFACT ? '1' : '', NEXT_PUBLIC_PGLITE_BASE: process.env.PGLITE_BASE || 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.16/dist' };
execSync('node scripts/prepare-demo.mjs', { stdio: 'inherit' });
mkdirSync('dist', { recursive: true });
const r = await build({
  entryPoints: ['src/spa.tsx'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false,
  jsx: 'automatic', alias: { '@': './src' }, outdir: 'dist', logLevel: 'warning',
  loader: { '.css': 'empty' },
  define: Object.fromEntries([...Object.entries(env).map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)]),
    ['process.env.NEXT_PUBLIC_SUPABASE_URL', JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL || '')], ['process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '')], ['process.env.NODE_ENV', '"production"']]),
});
let js = r.outputFiles.find(f => f.path.endsWith('.js')).text;
execSync('npx tailwindcss -i src/app/globals.css -o dist/spa.css --minify', { stdio: 'inherit' });
let css = readFileSync('dist/spa.css', 'utf8');
const dataUri = f => 'data:image/svg+xml;base64,' + readFileSync(f).toString('base64');
for (const n of ['mark-gold', 'mark-plum', 'mark-micro-gold', 'shurfa-gold', 'shurfa-plum']) {
  const uri = dataUri(`public/brand/${n}.svg`);
  js = js.split(`/brand/${n}.svg`).join(uri);
  css = css.split(`/brand/${n}.svg`).join(uri);
}
// Installed app (Add to Home Screen): fund icon + full name, no pinch/double-tap zoom.
const appHead = PROD ? `<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="صندوق النجدي الادخاري"><meta name="application-name" content="صندوق النجدي الادخاري">
<meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="theme-color" content="#F6F1E8">
<link rel="apple-touch-icon" href="app-icons/apple-touch-icon.png"><link rel="manifest" href="manifest.webmanifest">
<script>(function(){var s=matchMedia('(display-mode: standalone)').matches||navigator.standalone;if(!s)return;document.documentElement.classList.add('standalone');
['gesturestart','gesturechange'].forEach(function(e){document.addEventListener(e,function(ev){ev.preventDefault()},{passive:false})});
document.addEventListener('touchmove',function(ev){if(ev.touches&&ev.touches.length>1)ev.preventDefault()},{passive:false});})();</script>` : '';
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1${PROD ? ',maximum-scale=1,user-scalable=no' : ''}">${appHead}
<title>${PROD ? 'صندوق النجدي الادخاري' : 'صندوق النجدي الادخاري — نسخة تجريبية'}</title>
<link rel="icon" href="${dataUri('public/brand/mark-micro-gold.svg')}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Changa:wght@500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const out = PROD ? 'dist/index.html' : ARTIFACT ? 'dist/artifact/index.html' : 'dist/asf-demo.html';
if (ARTIFACT) {
  mkdirSync('dist/artifact', { recursive: true });
  const body = html.replace(/^<!doctype html><html[^>]*><head>/, '').replace('</head><body>', '').replace('</body></html>', '')
    .replace('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">', '');
  // the artifact host supplies its own <html>, so set RTL + Arabic before anything renders
  writeFileSync(out, `<script>document.documentElement.dir='rtl';document.documentElement.lang='ar'</script>\n` + body);
} else writeFileSync(out, html);
console.log(out, (html.length / 1024 / 1024).toFixed(2), 'MB');
