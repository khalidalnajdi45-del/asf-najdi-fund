// Invitation designer: one canvas renderer used for the on-screen preview and the downloadable image,
// so what the manager sees is exactly what members receive. Size 1080×1350 (4:5, WhatsApp/Instagram friendly).
import { getArabicDigits } from './format';

export type EventKind = 'eid' | 'ramadan' | 'sea' | 'desert' | 'gathering' | 'general';
export type InvitationData = {
  kind: EventKind; title: string; message?: string | null; event_date: string; start_time?: string | null;
  location?: string | null; host?: string | null; fund_name?: string | null; cancelled?: boolean;
};

export const W = 1080, H = 1350;

type Theme = {
  label: string; kicker: string; title: string; message: string;
  ink: string; sub: string; accent: string; panel: string | null; mark: 'gold' | 'plum';
  bg: (c: CanvasRenderingContext2D) => void; art: (c: CanvasRenderingContext2D, r: () => number) => void;
};

const GOLD = '#B8925A', DUNE = '#D6BC8C', IVORY = '#F6F1E8', PLUM = '#4A2A5A', NIGHT = '#2A1733';

function vgrad(c: CanvasRenderingContext2D, stops: [number, string][], y0 = 0, y1 = H) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  c.fillStyle = g; c.fillRect(0, 0, W, H);
}
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function stars(c: CanvasRenderingContext2D, r: () => number, n: number, yMax: number, color: string) {
  c.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = r() * yMax, s = 1.2 + r() * 2.6;
    c.globalAlpha = 0.35 + r() * 0.6;
    if (r() > 0.85) sparkle(c, x, y, s * 3.2); else { c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill(); }
  }
  c.globalAlpha = 1;
}
function sparkle(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.beginPath();
  c.moveTo(x, y - s); c.quadraticCurveTo(x, y, x + s, y); c.quadraticCurveTo(x, y, x, y + s);
  c.quadraticCurveTo(x, y, x - s, y); c.quadraticCurveTo(x, y, x, y - s); c.fill();
}
function crescent(c: CanvasRenderingContext2D, cx: number, cy: number, rad: number, color: string) {
  const off = document.createElement('canvas'); off.width = off.height = Math.ceil(rad * 2.4);
  const o = off.getContext('2d')!; const m = off.width / 2;
  o.fillStyle = color; o.beginPath(); o.arc(m, m, rad, 0, Math.PI * 2); o.fill();
  o.globalCompositeOperation = 'destination-out';
  o.beginPath(); o.arc(m + rad * 0.42, m - rad * 0.18, rad * 0.86, 0, Math.PI * 2); o.fill();
  c.save(); c.shadowColor = color; c.shadowBlur = 40; c.drawImage(off, cx - m, cy - m); c.restore();
}
/** Najdi "shurfa" — the stepped triangular parapet — as a repeating band. */
function shurfa(c: CanvasRenderingContext2D, y: number, size: number, color: string, down = false) {
  c.fillStyle = color;
  for (let x = -size; x < W + size; x += size * 1.25) {
    c.beginPath();
    if (down) { c.moveTo(x, y); c.lineTo(x + size, y); c.lineTo(x + size / 2, y + size * 0.9); }
    else { c.moveTo(x, y); c.lineTo(x + size, y); c.lineTo(x + size / 2, y - size * 0.9); }
    c.closePath(); c.fill();
  }
}
function patternWash(c: CanvasRenderingContext2D, color: string, alpha: number) {
  c.save(); c.globalAlpha = alpha; c.fillStyle = color;
  for (let y = 30; y < H; y += 56) for (let x = (y / 56) % 2 ? 0 : 42; x < W; x += 84) {
    c.beginPath(); c.moveTo(x, y + 14); c.lineTo(x + 18, y + 14); c.lineTo(x + 9, y); c.closePath(); c.fill();
  }
  c.restore();
}
function lantern(c: CanvasRenderingContext2D, x: number, top: number, len: number, s: number) {
  c.strokeStyle = DUNE; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, top + len); c.stroke();
  const y = top + len;
  c.save(); c.translate(x, y); c.scale(s, s);
  c.fillStyle = GOLD;
  c.beginPath(); c.arc(0, 4, 7, 0, Math.PI * 2); c.fill();                          // ring
  c.beginPath(); c.moveTo(-26, 40); c.lineTo(0, 10); c.lineTo(26, 40); c.closePath(); c.fill();   // cap
  c.fillRect(-30, 40, 60, 8);
  c.save(); c.shadowColor = '#FFD79A'; c.shadowBlur = 50; c.fillStyle = '#FFE2AE';
  c.beginPath(); c.moveTo(-26, 48); c.lineTo(26, 48); c.lineTo(34, 92); c.lineTo(22, 132); c.lineTo(-22, 132); c.lineTo(-34, 92); c.closePath(); c.fill();
  c.restore();
  c.strokeStyle = GOLD; c.lineWidth = 5;
  c.beginPath(); c.moveTo(-26, 48); c.lineTo(26, 48); c.lineTo(34, 92); c.lineTo(22, 132); c.lineTo(-22, 132); c.lineTo(-34, 92); c.closePath(); c.stroke();
  c.beginPath(); c.moveTo(0, 48); c.lineTo(0, 132); c.moveTo(-34, 92); c.lineTo(34, 92); c.stroke();
  c.fillStyle = GOLD; c.fillRect(-24, 132, 48, 8);
  c.beginPath(); c.moveTo(-14, 140); c.lineTo(14, 140); c.lineTo(0, 162); c.closePath(); c.fill();
  c.restore();
}
function burst(c: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string, rays = 18) {
  c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineCap = 'round';
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2, r0 = rad * 0.28, r1 = rad * (i % 2 ? 0.78 : 1);
    c.lineWidth = i % 2 ? 3 : 5; c.globalAlpha = 0.9;
    c.beginPath(); c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); c.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); c.stroke();
    c.beginPath(); c.arc(x + Math.cos(a) * (r1 + 10), y + Math.sin(a) * (r1 + 10), i % 2 ? 3 : 5, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}
function wave(c: CanvasRenderingContext2D, y: number, amp: number, len: number, phase: number, color: string) {
  c.fillStyle = color; c.beginPath(); c.moveTo(0, H);
  for (let x = 0; x <= W; x += 10) c.lineTo(x, y + Math.sin((x / len) * Math.PI * 2 + phase) * amp);
  c.lineTo(W, H); c.closePath(); c.fill();
}
function dune(c: CanvasRenderingContext2D, y: number, peaks: [number, number][], color: string) {
  c.fillStyle = color; c.beginPath(); c.moveTo(0, H); c.lineTo(0, y);
  let px = 0, py = y;
  for (const [x, yy] of peaks) { c.quadraticCurveTo((px + x) / 2, Math.min(py, yy) - 40, x, yy); px = x; py = yy; }
  c.lineTo(W, H); c.closePath(); c.fill();
}
function palm(c: CanvasRenderingContext2D, x: number, base: number, h: number, color: string) {
  c.strokeStyle = color; c.fillStyle = color; c.lineCap = 'round';
  c.lineWidth = 12; c.beginPath(); c.moveTo(x, base); c.quadraticCurveTo(x + 18, base - h / 2, x + 8, base - h); c.stroke();
  const tx = x + 8, ty = base - h;
  for (const [dx, dy] of [[-90, 10], [-70, 45], [90, 14], [74, 48], [-30, -50], [36, -46], [0, -62]]) {
    c.lineWidth = 9; c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(tx + dx * 0.5, ty + dy * 0.2 - 30, tx + dx, ty + dy); c.stroke();
  }
}

export const THEMES: Record<EventKind, Theme> = {
  ramadan: {
    label: 'رمضان', kicker: 'رمضان كريم', title: 'فطور العائلة', message: 'يسعدنا اجتماعكم على مائدة الإفطار في هذا الشهر الفضيل',
    ink: '#FFFDF9', sub: '#E9DFED', accent: DUNE, panel: null, mark: 'gold',
    bg: c => vgrad(c, [[0, '#140d22'], [0.55, NIGHT], [1, '#3a2150']]),
    art: (c, r) => {
      stars(c, r, 90, 620, '#F3E7CF');
      crescent(c, 250, 230, 120, DUNE);
      lantern(c, 690, 0, 120, 1.15); lantern(c, 840, 0, 230, 0.95); lantern(c, 960, 0, 80, 0.8);
      patternWash(c, GOLD, 0.05);
    },
  },
  eid: {
    label: 'العيد', kicker: 'عيدكم مبارك', title: 'معايدة العائلة', message: 'نتشرف بحضوركم لمعايدة العائلة وتبادل التهاني',
    ink: '#FFFDF9', sub: '#EDE3D2', accent: DUNE, panel: null, mark: 'gold',
    bg: c => vgrad(c, [[0, '#5b3470'], [0.5, PLUM], [1, NIGHT]]),
    art: (c, r) => {
      patternWash(c, GOLD, 0.06);
      burst(c, 250, 230, 150, GOLD); burst(c, 820, 170, 110, DUNE, 14); burst(c, 600, 380, 80, '#F3E7CF', 12);
      for (let i = 0; i < 70; i++) {
        c.save(); c.globalAlpha = 0.5 + r() * 0.5; c.fillStyle = [GOLD, DUNE, '#F3E7CF', '#C99BD8'][Math.floor(r() * 4)];
        c.translate(r() * W, r() * 600); c.rotate(r() * Math.PI); c.fillRect(-6, -2.5, 12, 5); c.restore();
      }
      crescent(c, 880, 440, 54, DUNE);
    },
  },
  sea: {
    label: 'طلعة بحرية', kicker: 'طلعة بحرية', title: 'رحلة العائلة البحرية', message: 'يوم بحر وصيد وجلسة حلوة مع الأهل',
    ink: NIGHT, sub: '#4a4150', accent: '#2f6f7a', panel: 'rgba(255,253,249,0.94)', mark: 'plum',
    bg: c => vgrad(c, [[0, '#f7e6c6'], [0.32, '#f2cfa1'], [0.46, '#9cc9cb'], [1, '#2f6f7a']]),
    art: c => {
      c.save(); c.shadowColor = '#ffd38a'; c.shadowBlur = 80; c.fillStyle = '#ffcf7d'; c.beginPath(); c.arc(760, 300, 95, 0, Math.PI * 2); c.fill(); c.restore();
      c.strokeStyle = '#6b5a4a'; c.lineWidth = 4; c.lineCap = 'round';
      for (const [x, y, s] of [[300, 170, 22], [350, 205, 16], [255, 220, 14]]) { c.beginPath(); c.moveTo(x - s, y - s * 0.4); c.quadraticCurveTo(x - s / 2, y - s, x, y); c.quadraticCurveTo(x + s / 2, y - s, x + s, y - s * 0.4); c.stroke(); }
      wave(c, 470, 10, 300, 0, '#7fb8bb');
      // dhow
      c.fillStyle = '#7a4a2e'; c.beginPath(); c.moveTo(250, 470); c.lineTo(470, 470); c.quadraticCurveTo(450, 510, 410, 515); c.lineTo(290, 515); c.quadraticCurveTo(262, 500, 250, 470); c.fill();
      c.strokeStyle = '#5a3520'; c.lineWidth = 6; c.beginPath(); c.moveTo(360, 470); c.lineTo(360, 250); c.stroke();
      c.fillStyle = '#FFFDF9'; c.beginPath(); c.moveTo(365, 255); c.quadraticCurveTo(470, 340, 455, 455); c.lineTo(370, 455); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(355, 300); c.lineTo(285, 450); c.lineTo(355, 450); c.closePath(); c.fill();
      wave(c, 505, 14, 260, 1.2, '#5aa6aa'); wave(c, 545, 16, 340, 2.4, '#3f8a92'); wave(c, 590, 12, 220, 0.6, '#2f6f7a');
    },
  },
  desert: {
    label: 'طلعة برية', kicker: 'طلعة برية', title: 'كشتة العائلة', message: 'جلسة بر وشبة نار وقهوة… لا تفوتكم',
    ink: NIGHT, sub: '#4a4150', accent: '#a8654a', panel: 'rgba(255,253,249,0.94)', mark: 'plum',
    bg: c => vgrad(c, [[0, '#f8e3b9'], [0.3, '#f1bf82'], [0.48, '#e08d58'], [1, '#a8654a']]),
    art: c => {
      c.save(); c.shadowColor = '#ffcf80'; c.shadowBlur = 90; c.fillStyle = '#ffd890'; c.beginPath(); c.arc(320, 330, 110, 0, Math.PI * 2); c.fill(); c.restore();
      dune(c, 430, [[300, 380], [620, 440], [900, 360], [1080, 410]], '#e3a76c');
      palm(c, 870, 470, 210, '#5a3a2a'); palm(c, 960, 485, 160, '#5a3a2a');
      dune(c, 500, [[260, 470], [560, 520], [820, 470], [1080, 520]], '#cf8a52');
      // بيت شعر (Bedouin tent)
      c.fillStyle = '#2b1f1c'; c.beginPath(); c.moveTo(380, 520); c.lineTo(420, 450); c.lineTo(500, 470); c.lineTo(580, 440); c.lineTo(660, 470); c.lineTo(700, 520); c.closePath(); c.fill();
      c.fillStyle = '#d14b2a'; c.fillRect(470, 482, 80, 38);
      c.strokeStyle = '#2b1f1c'; c.lineWidth = 3; for (const x of [420, 580]) { c.beginPath(); c.moveTo(x, 450); c.lineTo(x - 30, 520); c.stroke(); }
      // fire
      c.save(); c.shadowColor = '#ffb347'; c.shadowBlur = 40; c.fillStyle = '#ff9a3c';
      c.beginPath(); c.moveTo(250, 545); c.quadraticCurveTo(232, 515, 250, 490); c.quadraticCurveTo(262, 515, 270, 500); c.quadraticCurveTo(280, 525, 250, 545); c.fill(); c.restore();
      dune(c, 560, [[400, 540], [760, 580], [1080, 550]], '#b8714c');
    },
  },
  gathering: {
    label: 'اجتماع عائلي', kicker: 'اجتماع عائلي', title: 'لقاء العائلة', message: 'نتشرف بحضوركم ونتطلع لرؤيتكم',
    ink: NIGHT, sub: '#4a4150', accent: GOLD, panel: null, mark: 'plum',
    bg: c => { vgrad(c, [[0, '#fbf7f0'], [1, IVORY]]); patternWash(c, PLUM, 0.05); },
    art: c => {
      c.fillStyle = PLUM; c.fillRect(0, 0, W, 70); shurfa(c, 70, 44, PLUM, true);
      // Najdi doorway
      c.fillStyle = '#e9dfcf'; c.fillRect(360, 170, 360, 400);
      c.fillStyle = PLUM; c.beginPath(); c.moveTo(400, 570); c.lineTo(400, 300); c.arc(540, 300, 140, Math.PI, 0); c.lineTo(680, 570); c.closePath(); c.fill();
      c.strokeStyle = GOLD; c.lineWidth = 6; c.beginPath(); c.moveTo(430, 570); c.lineTo(430, 305); c.arc(540, 305, 110, Math.PI, 0); c.lineTo(650, 570); c.stroke();
      c.fillStyle = '#d8c9b1'; c.fillRect(340, 160, 400, 14);
      for (let x = 350; x < 730; x += 46) { c.beginPath(); c.moveTo(x, 160); c.lineTo(x + 36, 160); c.lineTo(x + 18, 128); c.closePath(); c.fill(); }
      c.fillStyle = GOLD; c.beginPath(); c.arc(615, 450, 8, 0, Math.PI * 2); c.fill();
    },
  },
  general: {
    label: 'مناسبة عامة', kicker: 'دعوة', title: 'مناسبة عائلية', message: 'يسعدنا حضوركم ومشاركتكم',
    ink: '#FFFDF9', sub: '#E9DFED', accent: DUNE, panel: null, mark: 'gold',
    bg: c => vgrad(c, [[0, PLUM], [1, NIGHT]]),
    art: (c, r) => { patternWash(c, GOLD, 0.08); stars(c, r, 30, 600, DUNE); shurfa(c, 600, 40, 'rgba(184,146,90,0.25)'); },
  },
};
export const KIND_ORDER: EventKind[] = ['eid', 'ramadan', 'sea', 'desert', 'gathering', 'general'];

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean); const lines: string[] = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  return lines;
}

export function formatEventDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`); const nu = getArabicDigits() ? '' : '-nu-latn';
  const greg = new Intl.DateTimeFormat(`ar-SA-u-ca-gregory${nu}`, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  let hijri = '';
  try { hijri = new Intl.DateTimeFormat(`ar-SA-u-ca-islamic-umalqura${nu}`, { day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch {}
  return { greg, hijri };
}

const imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadImg(src: string) {
  if (!imgCache.has(src)) imgCache.set(src, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }));
  return imgCache.get(src)!;
}
let fontsReady: Promise<unknown> | null = null;
function ensureFonts() {
  fontsReady ??= Promise.all(['700 80px Changa', '500 40px Changa', '400 34px "IBM Plex Sans Arabic"', '600 34px "IBM Plex Sans Arabic"']
    .map(f => document.fonts?.load(f).catch(() => null)));
  return fontsReady;
}

export async function drawInvitation(canvas: HTMLCanvasElement, d: InvitationData) {
  await ensureFonts();
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d')!; const t = THEMES[d.kind] ?? THEMES.general;
  c.direction = 'rtl'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  t.bg(c); t.art(c, rng(d.kind.length * 7919 + 13));

  const font = (w: string, s: number, fam = 'Changa') => `${w} ${s}px ${fam === 'Changa' ? 'Changa' : '"IBM Plex Sans Arabic"'}, "IBM Plex Sans Arabic", sans-serif`;
  const top = t.panel ? 640 : 610, bottom = H - 120;
  if (t.panel) { c.fillStyle = t.panel; c.beginPath(); c.roundRect(56, top, W - 112, H - top - 60, 40); c.fill(); }

  // two passes: measure the text block, then draw it vertically centred in the space above the footer
  const body = (y: number, draw: boolean) => {
    const text = (s: string, x: number, yy: number) => { if (draw) c.fillText(s, x, yy); };
    c.fillStyle = t.accent; c.font = font('500', 40); text(THEMES[d.kind].kicker, W / 2, y); y += 92;
    c.fillStyle = t.ink; c.font = font('700', 80);
    for (const line of wrap(c, d.title || t.title, W - 200, 2)) { text(line, W / 2, y); y += 96; }
    y -= 50;
    if (draw) { c.fillStyle = t.accent; c.fillRect(W / 2 - 44, y, 88, 5); }
    y += 66;
    const msg = d.message ?? t.message;
    if (msg) {
      c.fillStyle = t.sub; c.font = font('400', 34, 'plex');
      for (const line of wrap(c, msg, W - 240, 3)) { text(line, W / 2, y); y += 52; }
      y += 18;
    }
    if (d.event_date) {
      const { greg, hijri } = formatEventDate(d.event_date);
      c.fillStyle = t.ink; c.font = font('600', 36, 'plex'); text(greg, W / 2, y); y += 46;
      const second = [hijri, d.start_time].filter(Boolean).join(' · ');
      if (second) { c.fillStyle = t.sub; c.font = font('400', 30, 'plex'); text(second, W / 2, y); y += 50; }
    }
    if (d.location) { c.fillStyle = t.accent; c.font = font('600', 32, 'plex'); for (const l of wrap(c, '📍 ' + d.location, W - 240, 2)) { text(l, W / 2, y); y += 46; } }
    if (d.host) { c.fillStyle = t.sub; c.font = font('400', 28, 'plex'); text('الداعي: ' + d.host, W / 2, y + 6); y += 40; }
    return y;
  };
  const first = top + 80;
  const used = body(first, false) - first;
  body(first + Math.max(0, (bottom - top - 40 - used) / 2), true);

  // footer: brand mark + fund name
  try {
    const img = await loadImg(t.mark === 'gold' ? '/brand/mark-gold.svg' : '/brand/mark-plum.svg');
    const mw = 62, mh = mw * (img.height / img.width || 0.83);
    c.font = font('600', 28); const name = d.fund_name || 'صندوق النجدي الادخاري';
    const tw = c.measureText(name).width; const total = tw + mw + 16; const fx = W / 2 + total / 2;
    c.textAlign = 'right'; c.fillStyle = t.panel ? NIGHT : t.ink; c.fillText(name, fx, H - 64);
    c.drawImage(img, fx - tw - 16 - mw, H - 64 - mh + 12, mw, mh);
    c.textAlign = 'center';
  } catch { /* image optional */ }

  if (d.cancelled) {
    c.save(); c.translate(W / 2, H / 2); c.rotate(-0.25);
    c.strokeStyle = '#a8654a'; c.lineWidth = 10; c.strokeRect(-300, -80, 600, 160);
    c.fillStyle = '#a8654a'; c.font = font('700', 96); c.textBaseline = 'middle'; c.fillText('أُلغيت', 0, 6); c.restore();
  }
}

export async function invitationBlob(d: InvitationData): Promise<Blob> {
  const cv = document.createElement('canvas'); await drawInvitation(cv, d);
  return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('تعذر إنشاء الصورة'))), 'image/png'));
}

export async function downloadInvitation(d: InvitationData) {
  const blob = await invitationBlob(d); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `دعوة-${d.title}.png`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function shareInvitation(d: InvitationData): Promise<boolean> {
  const blob = await invitationBlob(d); const file = new File([blob], `دعوة-${d.title}.png`, { type: 'image/png' });
  const nav = navigator as any;
  if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title: d.title }); return true; }
  return false;
}
