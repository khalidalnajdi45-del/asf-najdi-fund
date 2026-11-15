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

/** PDF export: the browser's print dialog ("Save as PDF"); branded via the print stylesheet + PrintBrand header. */
export function printPdf(title?: string) {
  const prev = document.title;
  if (title) document.title = title;
  document.documentElement.classList.add('printing');
  window.print();
  setTimeout(() => { document.title = prev; document.documentElement.classList.remove('printing'); }, 500);
}
