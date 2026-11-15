'use client';
import clsx from 'clsx';
import { dateTime, sar } from '@/lib/format';
import { LOCKUP_POS, LOCKUP_REV } from '@/lib/brand-assets';
import type { BrandedSheet, Cell, RowStyle } from '@/lib/export';

export type { Cell, RowStyle };
export type Section = {
  title: string; header: string[]; rows: Cell[][]; money?: number[]; total?: Cell[]; styles?: RowStyle[];
  /** paragraphs (notes) — rendered above the table; a section may be text only (empty header/rows) */
  paras?: string[]; note?: string;
  /** Excel sheet this section goes to (default: one sheet for the whole report) */
  sheet?: string; breakBefore?: boolean; compact?: boolean;
};
export type Cover = { kicker: string; title: string; period: string; year: string };
export type Doc = {
  title: string; subtitle: string; kpis?: [string, string][]; sections: Section[]; note?: string;
  cover?: Cover; signatures?: string[]; contents?: string[];
};

const FUND = 'صندوق النجدي الادخاري';

/** Print-only brand header for any printable page (statements, loan sheets, member reports). */
export function PrintBrand({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="print-only print-brand">
      <div className="flex items-end justify-between gap-6">
        <img src={LOCKUP_POS} alt={FUND} className="h-11 w-auto" />
        <div className="text-left text-[10px] leading-5 text-muted">أُعد في {dateTime(new Date().toISOString())}<br />المبالغ بالريال السعودي</div>
      </div>
      <div className="mt-3 h-[3px] w-full bg-gold-500" />
      <h1 className="mt-4 text-xl font-semibold text-brand-600">{title}</h1>
      {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
    </div>
  );
}

const cellText = (c: Cell, money: boolean) => {
  if (!money || c === null || c === undefined || c === '') return c ?? '';
  const v = Number(c);
  if (!Number.isFinite(v)) return c;
  return v < -0.004 ? `(${sar(-v)})` : sar(Math.abs(v) < 0.005 ? 0 : v);
};

export function ReportView({ doc, fundName }: { doc: Doc; fundName?: string }) {
  const name = fundName || FUND;
  return (
    <div data-pdf className="print-area report-doc space-y-4">
      {doc.cover && <CoverPage cover={doc.cover} contents={doc.contents} />}
      <header className="rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <img src={LOCKUP_POS} alt={name} className="h-9 w-auto sm:h-10" />
          <div className="text-left text-[11px] leading-5 text-muted">أُعد في {dateTime(new Date().toISOString())}<br />المبالغ بالريال السعودي</div>
        </div>
        <div className="mt-4 h-[3px] w-full rounded bg-gold-500" />
        <h2 className="mt-4 text-xl font-semibold text-brand-600">{doc.title}</h2>
        <div className="text-sm text-muted">{doc.subtitle}</div>
        {doc.kpis && <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {doc.kpis.map(([k, v]) => <div key={k} className="border-b border-dashed border-line pb-1.5"><div className="text-xs text-muted">{k}</div><div className="num font-semibold">{v}</div></div>)}
        </div>}
        {doc.note && <p className="mt-3 text-xs text-muted">{doc.note}</p>}
      </header>
      {doc.sections.map((sec, si) => (
        <section key={si} className={clsx('report-sec overflow-hidden rounded-xl border border-line bg-surface', sec.breakBefore && 'print-break-before', sec.rows.length + (sec.paras?.length ?? 0) * 2 < 28 && 'avoid-break')}>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="h-5 w-1 rounded bg-gold-500" />
            <h3 className="text-[15px] font-semibold text-brand-700">{sec.title}</h3>
          </div>
          {sec.paras?.length ? <div className="space-y-2 px-4 py-3 text-[13.5px] leading-7 text-ink-2">{sec.paras.map((p, i) => <p key={i}>{p}</p>)}</div> : null}
          {sec.header.length > 0 && <div className="scroll-thin overflow-x-auto">
            <table className={clsx('rtable w-full', sec.compact ? 'text-[12.5px]' : 'text-sm')}>
              <thead><tr>
                {sec.header.map((h, i) => <th key={i} className={clsx('whitespace-nowrap px-4 py-2.5 font-medium', sec.money?.includes(i) ? 'text-left' : 'text-right')}>{h}</th>)}
              </tr></thead>
              <tbody>
                {sec.rows.map((r, ri) => {
                  const st = sec.styles?.[ri];
                  return <tr key={ri} className={clsx('border-b border-line/70', st && `row-${st}`)}>
                    {sec.header.map((_, i) => <td key={i} className={clsx('px-4 py-2', sec.money?.includes(i) ? 'num-cell text-left' : 'text-right')}>{cellText(r[i], !!sec.money?.includes(i))}</td>)}
                  </tr>;
                })}
                {sec.rows.length === 0 && <tr><td colSpan={sec.header.length} className="px-4 py-6 text-center text-muted">لا توجد بيانات</td></tr>}
              </tbody>
              {sec.total && <tfoot><tr className="row-grand">
                {sec.header.map((_, i) => <td key={i} className={clsx('px-4 py-2.5', sec.money?.includes(i) ? 'num-cell text-left' : 'text-right')}>{cellText(sec.total![i], !!sec.money?.includes(i))}</td>)}
              </tr></tfoot>}
            </table>
          </div>}
          {sec.note && <p className="border-t border-line px-4 py-2 text-xs text-muted">{sec.note}</p>}
        </section>
      ))}
      {doc.signatures && <section className="report-sec report-sign rounded-xl border border-line bg-surface p-5">
        <p className="text-[13px] text-ink-2">اعتُمدت هذه القوائم المالية والإيضاحات المرفقة بها من قبل:</p>
        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {doc.signatures.map(s => <div key={s} className="text-center">
            <div className="mx-auto h-12 w-44 border-b border-ink/40" />
            <div className="mt-2 text-sm font-medium text-brand-700">{s}</div>
            <div className="mt-1 text-xs text-muted">الاسم: ................................</div>
            <div className="mt-1 text-xs text-muted">التاريخ: ..............................</div>
          </div>)}
        </div>
      </section>}
    </div>
  );
}

function CoverPage({ cover, contents }: { cover: Cover; contents?: string[] }) {
  return (
    <div data-cover={JSON.stringify({ ...cover, contents })} className="fs-cover shurfa relative overflow-hidden rounded-xl bg-brand-600 p-8 text-white sm:p-12">
      <img src={LOCKUP_REV} alt={FUND} className="h-10 w-auto sm:h-12" />
      <div className="fs-cover-body mt-16 sm:mt-24">
        <div className="text-xs tracking-[0.25em] text-gold-300">{cover.kicker}</div>
        <div className="mt-3 font-[family-name:var(--font-latin-display)] text-7xl leading-none text-gold-300 sm:text-8xl">{cover.year}</div>
        <h1 className="mt-6 text-3xl font-semibold sm:text-4xl">{cover.title}</h1>
        <div className="mt-2 text-sm text-white/75">{cover.period}</div>
        <div className="mt-6 h-[3px] w-16 rounded bg-gold-500" />
      </div>
      {contents && <div className="mt-12 grid gap-1 text-[13px] text-white/85 sm:max-w-md">
        <div className="mb-1 text-xs text-gold-300">المحتويات</div>
        {contents.map((c, i) => <div key={c} className="flex justify-between gap-4 border-b border-white/10 py-1"><span>{c}</span><span className="num text-white/50">{String(i + 1).padStart(2, '0')}</span></div>)}
      </div>}
    </div>
  );
}

/** Excel workbook layout for a Doc — same content, same identity. */
export function docToSheets(doc: Doc): BrandedSheet[] {
  const map = new Map<string, BrandedSheet>();
  const sheetOf = (name: string) => {
    if (!map.has(name)) map.set(name, { name, title: name === 'التقرير' ? doc.title : name, subtitle: doc.subtitle, blocks: [] });
    return map.get(name)!;
  };
  if (!doc.sections.length) sheetOf('التقرير');
  if (doc.kpis?.length) sheetOf(doc.sections[0]?.sheet ?? 'التقرير').blocks.push({ title: 'ملخص', header: ['البند', 'القيمة'], rows: doc.kpis.map(k => [k[0], k[1]]) });
  for (const s of doc.sections) {
    sheetOf(s.sheet ?? 'التقرير').blocks.push({
      title: s.title, paras: s.paras, header: s.header.length ? s.header : undefined,
      rows: s.rows, money: s.money, styles: s.styles, total: s.total,
    });
    if (s.note) sheetOf(s.sheet ?? 'التقرير').blocks.push({ rows: [[s.note]], styles: ['muted'] });
  }
  if (doc.note) [...map.values()][0]?.blocks.push({ rows: [[doc.note]], styles: ['muted'] });
  if (doc.signatures) {
    const last = [...map.values()].at(-1)!;
    last.blocks.push({ title: 'الاعتماد', header: doc.signatures, rows: [doc.signatures.map(() => ''), doc.signatures.map(() => 'التوقيع: ................'), doc.signatures.map(() => 'التاريخ: ................')] });
  }
  return [...map.values()];
}
