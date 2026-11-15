'use client';
import { LOCKUP_REV, LOCKUP_RATIO } from './brand-assets';

export type CoverData = { kicker: string; title: string; period: string; year: string; contents?: string[]; prepared?: string };

const SHURFA = new Path2D('M0 21 L0 14 L7 14 L7 7 L14 7 L14 0 L28 0 L28 7 L35 7 L35 14 L42 14 L42 21ZM42 49 L42 42 L49 42 L49 35 L56 35 L56 28 L70 28 L70 35 L77 35 L77 42 L84 42 L84 49ZM-42 49 L-42 42 L-35 42 L-35 35 L-28 35 L-28 28 L-14 28 L-14 35 L-7 35 L-7 42 L0 42 L0 49ZM57 16 L63 6 L69 16ZM15 44 L21 34 L27 44Z');
const img = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/** Full-bleed A4 cover (ASF identity) drawn on a canvas — Arabic shaping is the browser's own, so it is exact. */
export async function drawCover(c: CoverData): Promise<string> {
  const W = 1654, H = 2339, u = W / 210; // px per mm (200 dpi)
  await Promise.all(['700 80px Changa', '600 80px Changa', '500 30px "IBM Plex Sans Arabic"', '600 200px "Cormorant Garamond"']
    .map(f => document.fonts?.load(f).catch(() => null)));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;

  // ground: plum → night plum
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#4A2A5A'); bg.addColorStop(0.62, '#3D2249'); bg.addColorStop(1, '#2A1733');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  // shurfa pattern, rising from the bottom and fading out towards the middle
  const pat = document.createElement('canvas'); pat.width = W; pat.height = H;
  const p = pat.getContext('2d')!;
  const s = 2.6; // tile scale (84×56 → ~218×146 px)
  p.fillStyle = '#B8925A';
  for (let y = 0; y < H; y += 56 * s) for (let x = -84 * s; x < W + 84 * s; x += 84 * s) {
    p.save(); p.translate(x, y); p.scale(s, s); p.fill(SHURFA); p.restore();
  }
  p.globalCompositeOperation = 'destination-in';
  const fade = p.createLinearGradient(0, H * 0.38, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.55, 'rgba(0,0,0,0.55)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  p.fillStyle = fade; p.fillRect(0, 0, W, H);
  g.globalAlpha = 0.13; g.drawImage(pat, 0, 0); g.globalAlpha = 1;

  const R = W - 22 * u, L = 22 * u; // right / left text edges
  g.direction = 'rtl'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';

  // top: gold hairline + lockup
  g.fillStyle = '#B8925A'; g.fillRect(L, 20 * u, R - L, 0.5 * u);
  const logo = await img(LOCKUP_REV);
  const lw = 98 * u, lh = lw * LOCKUP_RATIO;
  g.drawImage(logo, R - lw, 30 * u, lw, lh);

  // title block
  let y = 118 * u;
  g.fillStyle = '#D6BC8C'; g.font = `500 ${3.3 * u}px "IBM Plex Sans Arabic", Arial, sans-serif`;
  g.direction = 'ltr'; g.textAlign = 'right';
  (g as any).letterSpacing = `${0.9 * u}px`;
  g.fillText(c.kicker, R, y);
  (g as any).letterSpacing = '0px';
  y += 36 * u;
  g.fillStyle = '#D6BC8C'; g.font = `600 ${42 * u}px "Cormorant Garamond", Georgia, serif`;
  g.fillText(c.year, R, y);
  g.direction = 'rtl';
  y += 22 * u;
  g.fillStyle = '#FFFFFF'; g.font = `700 ${15 * u}px Changa, "IBM Plex Sans Arabic", Arial, sans-serif`;
  g.fillText(c.title, R, y);
  y += 10 * u;
  g.fillStyle = 'rgba(255,255,255,0.78)'; g.font = `500 ${4.6 * u}px "IBM Plex Sans Arabic", Arial, sans-serif`;
  g.fillText(c.period, R, y);
  y += 9 * u;
  g.fillStyle = '#B8925A'; g.fillRect(R - 22 * u, y, 22 * u, 0.9 * u);

  // contents
  if (c.contents?.length) {
    let cy = 212 * u;
    const cw = 92 * u;
    g.fillStyle = '#D6BC8C'; g.font = `600 ${3.6 * u}px "IBM Plex Sans Arabic", Arial, sans-serif`;
    g.fillText('المحتويات', R, cy);
    cy += 4 * u;
    c.contents.forEach((t, i) => {
      cy += 9 * u;
      g.direction = 'rtl'; g.textAlign = 'right';
      g.fillStyle = 'rgba(255,255,255,0.92)'; g.font = `500 ${4 * u}px "IBM Plex Sans Arabic", Arial, sans-serif`;
      g.fillText(t, R, cy);
      g.direction = 'ltr'; g.textAlign = 'left';
      g.fillStyle = '#B8925A'; g.font = `600 ${4 * u}px "Cormorant Garamond", Georgia, serif`;
      g.fillText(String(i + 1).padStart(2, '0'), R - cw, cy);
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(R - cw, cy + 3 * u, cw, 0.25 * u);
    });
  }

  // footer band
  g.fillStyle = '#B8925A'; g.fillRect(L, H - 24 * u, R - L, 0.5 * u);
  g.direction = 'rtl'; g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `500 ${3.3 * u}px "IBM Plex Sans Arabic", Arial, sans-serif`;
  g.fillText('سري — للاستخدام الداخلي لأعضاء الصندوق', R, H - 16 * u);
  if (c.prepared) { g.textAlign = 'left'; g.fillText(c.prepared, L, H - 16 * u); }

  return cv.toDataURL('image/jpeg', 0.93);
}
