'use client';
import { num } from './format';
import { LOCKUP_POS, LOCKUP_RATIO } from './brand-assets';

export type Cell = string | number | null | undefined;
export type RowStyle = 'section' | 'subtotal' | 'total' | 'grand' | 'muted' | undefined;

/** A table block inside a sheet. `money` = column indexes formatted as SAR amounts. */
export type Block = {
  title?: string; header?: string[]; rows: Cell[][]; money?: number[]; styles?: RowStyle[];
  total?: Cell[]; paras?: string[];
};
/** Simple sheet (legacy shape) — one table. Extra blocks are optional. */
export type Sheet = { name: string; header: string[]; rows: Cell[][]; money?: number[]; styles?: RowStyle[]; total?: Cell[]; title?: string };
export type BrandedSheet = { name: string; title?: string; subtitle?: string; blocks: Block[] };
export type ExportMeta = { title?: string; subtitle?: string; fundName?: string };

const BRAND = {
  plum: 'FF4A2A5A', night: 'FF2A1733', gold: 'FFB8925A', dune: 'FFD6BC8C', ivory: 'FFF6F1E8',
  goldTint: 'FFF3EADB', zebra: 'FFFBF8F2', ink: 'FF231C26', muted: 'FF736A74', line: 'FFE9DFCF', white: 'FFFFFFFF',
};
const FONT = 'Arial';
const FUND = 'صندوق النجدي الادخاري';

let excelJs: Promise<any> | null = null;
function loadExcelJs(): Promise<any> {
  if ((window as any).ExcelJS) return Promise.resolve((window as any).ExcelJS);
  if (!excelJs) {
    excelJs = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.async = true;
      s.onload = () => (window as any).ExcelJS ? res((window as any).ExcelJS) : rej(new Error('ExcelJS'));
      s.onerror = () => { excelJs = null; rej(new Error('تعذر تحميل مكتبة Excel')); };
      document.head.appendChild(s);
    });
  }
  return excelJs;
}

const fileName = (f: string) => (f.endsWith('.xlsx') ? f : `${f}.xlsx`).replace(/[\\/:*?"<>|]/g, '-');
const isNum = (v: Cell) => typeof v === 'number' && Number.isFinite(v);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

/** Excel export with the fund identity (logo, plum headers, gold rules, RTL, A4 print setup). */
export async function exportXlsx(filename: string, sheets: Sheet[], meta: ExportMeta = {}) {
  return exportBranded(filename, sheets.map(s => ({
    name: s.name, title: s.title,
    blocks: [{ header: s.header, rows: s.rows, money: s.money ?? guessMoney(s.header, s.rows), styles: s.styles, total: s.total }],
  })), { title: meta.title ?? filename.replace(/[-_]/g, ' '), ...meta });
}

const MONEY_RE = /مبلغ|المبلغ|رصيد|الرصيد|إجمالي|المسدد|المستحق|القيمة|التكلفة|المتبقي|القسط|مدين|دائن|المعتمد|المطلوب|الإيداع|السحب|متأخر|داخل|خارج|الصافي|ربح|عائد|المصروف|المستثمر|المسترد|محقق|المتاح|الإيداعات|السحوبات/;
/** Columns treated as SAR amounts when the caller didn't say: money-like header, or any fractional value. */
function guessMoney(header: string[], rows: Cell[][]): number[] {
  return header.map((h, i) => (rows.some(r => isNum(r[i])) && (MONEY_RE.test(h) || rows.some(r => isNum(r[i]) && !Number.isInteger(r[i])))) ? i : -1).filter(i => i >= 0);
}

export async function exportBranded(filename: string, sheets: BrandedSheet[], meta: ExportMeta = {}) {
  let ExcelJS: any;
  try { ExcelJS = await loadExcelJs(); } catch { return plainXlsx(filename, sheets); }
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.fundName || FUND; wb.created = new Date();
  const logo = wb.addImage({ base64: LOCKUP_POS.split(',')[1], extension: 'png' });
  const used = new Set<string>();

  for (const sh of sheets) {
    let name = sh.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'ورقة';
    for (let i = 2; used.has(name); i++) name = `${sh.name.slice(0, 27)} (${i})`;
    used.add(name);
    const cols = Math.max(2, ...sh.blocks.map(b => Math.max(b.header?.length ?? 0, ...b.rows.map(r => r.length), b.total?.length ?? 0)));
    const ws = wb.addWorksheet(name, {
      views: [{ rightToLeft: true, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: cols > 7 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                   margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 } },
      headerFooter: { oddFooter: `&L&8${FUND}&C&8صفحة &P من &N&R&8${today()}` },
    });

    // ---- brand header: logo + title + subtitle + gold rule
    ws.getRow(1).height = 22; ws.getRow(2).height = 22;
    const logoW = 300;
    ws.addImage(logo, { tl: { col: 0, row: 0.15 }, ext: { width: logoW, height: logoW * LOCKUP_RATIO }, editAs: 'oneCell' });
    let r = 4;
    const put = (text: string, font: any, height?: number) => {
      ws.mergeCells(r, 1, r, cols);
      const c = ws.getCell(r, 1); c.value = text; c.font = { name: FONT, ...font }; c.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl', wrapText: true };
      if (height) ws.getRow(r).height = height;
      r++;
    };
    put(sh.title || meta.title || sh.name, { size: 15, bold: true, color: { argb: BRAND.plum } }, 24);
    const sub = [sh.subtitle || meta.subtitle, 'المبالغ بالريال السعودي'].filter(Boolean).join(' · ');
    put(sub, { size: 10, color: { argb: BRAND.muted } }, 16);
    for (let c = 1; c <= cols; c++) ws.getCell(r, c).border = { top: { style: 'medium', color: { argb: BRAND.gold } } };
    ws.getRow(r).height = 6; r += 1;

    const widths = Array.from({ length: cols }, () => 10);
    const fit = (i: number, v: Cell, money: boolean) => {
      const len = money && isNum(v) ? (Math.abs(v as number) >= 1e6 ? 14 : 12) : String(v ?? '').length;
      widths[i] = Math.min(60, Math.max(widths[i], len + 3));
    };

    for (const b of sh.blocks) {
      r++;
      if (b.title) {
        ws.mergeCells(r, 1, r, cols);
        const c = ws.getCell(r, 1); c.value = b.title;
        c.font = { name: FONT, size: 12, bold: true, color: { argb: BRAND.plum } };
        c.alignment = { horizontal: 'right', readingOrder: 'rtl' };
        c.border = { bottom: { style: 'thin', color: { argb: BRAND.dune } } };
        ws.getRow(r).height = 20; r++;
      }
      for (const p of b.paras ?? []) {
        ws.mergeCells(r, 1, r, cols);
        const c = ws.getCell(r, 1); c.value = p;
        c.font = { name: FONT, size: 10, color: { argb: BRAND.ink } };
        c.alignment = { horizontal: 'right', vertical: 'top', wrapText: true, readingOrder: 'rtl' };
        ws.getRow(r).height = Math.max(16, Math.ceil(p.length / (cols * 11)) * 15);
        r++;
      }
      const money = new Set(b.money ?? []);
      if (b.header?.length) {
        b.header.forEach((h, i) => {
          const c = ws.getCell(r, i + 1); c.value = h;
          c.font = { name: FONT, size: 10, bold: true, color: { argb: BRAND.white } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.plum } };
          c.alignment = { horizontal: money.has(i) ? 'left' : 'right', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
          c.border = { bottom: { style: 'thin', color: { argb: BRAND.gold } } };
          fit(i, h, false);
        });
        ws.getRow(r).height = 20; r++;
      }
      const rows: [Cell[], RowStyle][] = b.rows.map((row, i) => [row, b.styles?.[i]]);
      if (b.total) rows.push([b.total, 'grand']);
      rows.forEach(([row, style], ri) => {
        for (let i = 0; i < Math.max(row.length, b.header?.length ?? 0); i++) {
          const v = row[i];
          const c = ws.getCell(r, i + 1);
          const isMoney = money.has(i);
          c.value = v === null || v === undefined || v === '' ? null : (isMoney && v !== '' && !isNaN(Number(v)) ? Math.round(num(v) * 100) / 100 : v);
          if (isMoney && c.value !== null && typeof c.value === 'number') c.numFmt = '#,##0.00;(#,##0.00);"-"';
          c.alignment = { horizontal: isMoney ? 'left' : 'right', vertical: 'middle', readingOrder: 'rtl', wrapText: !isMoney };
          c.font = { name: FONT, size: 10, color: { argb: BRAND.ink } };
          c.border = { bottom: { style: 'hair', color: { argb: BRAND.line } } };
          if (style === 'section') { c.font = { ...c.font, bold: true, color: { argb: BRAND.plum } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.goldTint } }; }
          else if (style === 'subtotal') { c.font = { ...c.font, bold: true }; c.border = { top: { style: 'thin', color: { argb: BRAND.dune } } }; }
          else if (style === 'total' || style === 'grand') {
            c.font = { ...c.font, bold: true, color: { argb: BRAND.night } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.ivory } };
            c.border = { top: { style: 'thin', color: { argb: BRAND.gold } }, bottom: { style: style === 'grand' ? 'double' : 'thin', color: { argb: BRAND.gold } } };
          } else if (style === 'muted') c.font = { ...c.font, italic: true, color: { argb: BRAND.muted } };
          else if (ri % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.zebra } };
          fit(i, v, isMoney);
        }
        r++;
      });
    }
    r += 1;
    ws.mergeCells(r, 1, r, cols);
    const f = ws.getCell(r, 1);
    f.value = `أُعد من منصة ${meta.fundName || FUND} بتاريخ ${today()} — البيانات مستخرجة مباشرة من دفتر الأستاذ`;
    f.font = { name: FONT, size: 8, italic: true, color: { argb: BRAND.muted } };
    f.alignment = { horizontal: 'right', readingOrder: 'rtl' };
    // the logo needs ~300px across the first columns
    const minFirst = Math.ceil(logoW / 7 / Math.min(cols, 3));
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = i < 3 ? Math.max(w, minFirst) : w; });
  }

  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName(filename));
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Offline fallback: plain RTL workbook via SheetJS. */
async function plainXlsx(filename: string, sheets: BrandedSheet[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] } as any;
  for (const s of sheets) {
    const aoa: Cell[][] = [[s.title ?? s.name], []];
    for (const b of s.blocks) {
      if (b.title) aoa.push([b.title]);
      for (const p of b.paras ?? []) aoa.push([p]);
      if (b.header) aoa.push(b.header);
      aoa.push(...b.rows, ...(b.total ? [b.total] : []), []);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (const key of Object.keys(ws)) { const c = (ws as any)[key]; if (c && typeof c === 'object' && c.t === 'n') c.z = '#,##0.00'; }
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName(filename));
}

export const n2 = (v: unknown) => Math.round(num(v) * 100) / 100;

function loadScript(src: string, global: string): Promise<any> {
  if ((window as any)[global]) return Promise.resolve((window as any)[global]);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = () => (window as any)[global] ? res((window as any)[global]) : rej(new Error(global));
    s.onerror = () => rej(new Error('تعذر تحميل مكتبة PDF'));
    document.head.appendChild(s);
  });
}
let h2p: Promise<any> | null = null;
/** html2pdf (non-bundled) on top of jsPDF + html2canvas-pro (the latter understands Tailwind v4 oklch/oklab colours). */
function loadHtml2Pdf(): Promise<any> {
  if (!h2p) {
    h2p = Promise.all([
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdf'),
      loadScript('https://cdn.jsdelivr.net/npm/html2canvas-pro@1.5.8/dist/html2canvas-pro.min.js', 'html2canvas'),
    ]).then(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.min.js', 'html2pdf'))
      .catch(e => { h2p = null; throw e; });
  }
  return h2p;
}

/** Footer strip (fund name · page x of n) drawn on a canvas so Arabic shapes correctly, then stamped on each PDF page. */
function footerImage(page: number, pages: number, widthMm: number) {
  const scale = 8, w = Math.round(widthMm * scale), h = 6 * scale;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e9dfcf'; g.fillRect(0, 0, w, 2);
  g.font = `${2.6 * scale}px "IBM Plex Sans Arabic", Arial, sans-serif`;
  g.textBaseline = 'middle';
  g.direction = 'rtl'; g.textAlign = 'right'; g.fillStyle = '#8a6a3c';
  g.fillText(FUND, w, h / 2 + 2);
  g.direction = 'rtl'; g.textAlign = 'left'; g.fillStyle = '#736a74';
  g.fillText(`صفحة ${page} من ${pages}`, 0, h / 2 + 2);
  return c.toDataURL('image/png');
}

function busy(on: boolean, text = 'جاري تجهيز ملف PDF…') {
  let el = document.getElementById('pdf-busy');
  if (on && el) el.textContent = text;
  if (on && !el) {
    el = document.createElement('div'); el.id = 'pdf-busy';
    el.textContent = text;
    el.setAttribute('style', 'position:fixed;inset:auto 0 24px 0;margin:auto;width:max-content;z-index:9999;background:#2a1733;color:#fff;padding:10px 18px;border-radius:999px;font:14px "IBM Plex Sans Arabic",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.2)');
    document.body.appendChild(el);
  } else if (!on) el?.remove();
}

/**
 * PDF export: renders the page's printable area ([data-pdf], else <main>) straight to a downloaded A4 PDF
 * with the fund identity (brand header, page breaks, footer with page numbers). Falls back to the print dialog if offline.
 */
export async function printPdf(title?: string, target?: HTMLElement | null) {
  const el = target ?? document.querySelector<HTMLElement>('[data-pdf]') ?? document.querySelector<HTMLElement>('main');
  if (!el) return;
  busy(true);
  const root = document.documentElement;
  let html2pdf: any;
  try { html2pdf = await loadHtml2Pdf(); }
  catch {
    busy(false);
    const prev = document.title;
    if (title) document.title = title;
    window.print();
    setTimeout(() => { document.title = prev; }, 500);
    return;
  }
  let failed = false;
  const pinned: [HTMLElement, string, string, string][] = [];
  try {
    await document.fonts?.ready;
    root.classList.add('pdf-export');
    // html2canvas has weak bidi: pin purely numeric cells (dates, amounts) to LTR so "15/11/2026" isn't scrambled
    el.querySelectorAll<HTMLElement>('td, th, span, div, p').forEach(n => {
      if (n.children.length === 0 && /^[\d\s/.:,()\-+%]+$/.test(n.textContent ?? '') && /\d/.test(n.textContent ?? '')) {
        const cs = getComputedStyle(n);
        const align = cs.textAlign === 'start' ? (cs.direction === 'rtl' ? 'right' : 'left') : cs.textAlign === 'end' ? (cs.direction === 'rtl' ? 'left' : 'right') : cs.textAlign;
        pinned.push([n, n.style.direction, n.style.unicodeBidi, n.style.textAlign]);
        n.style.textAlign = align; n.style.direction = 'ltr'; n.style.unicodeBidi = 'isolate';
      }
    });
    const margin = [12, 12, 16, 12];
    const worker = html2pdf().set({
      margin, filename: `${(title || document.title || FUND).replace(/[\\/:*?"<>|]/g, '-')}.pdf`,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: 900 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
      pagebreak: { mode: ['css', 'legacy'], before: '.print-break-before', avoid: ['tr', 'p', '.report-sign', '.avoid-break', 'h3'] },
    }).from(el).toPdf();
    const pdf = await worker.get('pdf');
    const n = pdf.internal.getNumberOfPages();
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) {
      pdf.setPage(i);
      pdf.addImage(footerImage(i, n, pw - margin[1] - margin[3]), 'PNG', margin[3], ph - 11, pw - margin[1] - margin[3], 6);
    }
    download(pdf.output('blob'), `${(title || document.title || FUND).replace(/[\\/:*?"<>|]/g, '-')}.pdf`);
  } catch (e) {
    console.error('pdf export', e);
    failed = true;
  } finally {
    root.classList.remove('pdf-export');
    pinned.forEach(([n, d, u, a]) => { n.style.direction = d; n.style.unicodeBidi = u; n.style.textAlign = a; });
    if (failed) { busy(true, 'تعذر إنشاء ملف PDF — حاول مرة أخرى'); setTimeout(() => busy(false), 4000); }
    else busy(false);
  }
}
