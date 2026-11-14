'use client';
import { num } from './format';

export type Sheet = { name: string; header: string[]; rows: (string | number | null)[][] };

/** Excel export (RTL workbook). Money cells are written as numbers with 2-decimal format. */
export async function exportXlsx(filename: string, sheets: Sheet[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] } as any;
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.header, ...s.rows]);
    ws['!cols'] = s.header.map((h, i) => ({ wch: Math.min(48, Math.max(h.length + 2, ...s.rows.map(r => String(r[i] ?? '').length + 2))) }));
    for (const key of Object.keys(ws)) {
      const c = (ws as any)[key];
      if (c && typeof c === 'object' && c.t === 'n') c.z = '#,##0.00';
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export const n2 = (v: unknown) => Math.round(num(v) * 100) / 100;

/** PDF export: the browser's print dialog ("Save as PDF") renders Arabic RTL correctly. */
export function printPdf(title?: string) {
  const prev = document.title;
  if (title) document.title = title;
  window.print();
  setTimeout(() => { document.title = prev; }, 500);
}
