'use client';
import { go } from '@/lib/nav';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Download, FileText, Printer , FileDown } from 'lucide-react';
import { rpc, supabase, cleanError } from '@/lib/supabase';
import { q } from '@/lib/hooks';
import { date, dateTime, firstOfMonth, lastOfMonth, monthLabel, num, pct, sar, today } from '@/lib/format';
import { accountTypeLabels, frequencyLabels, statusLabels, txTypeLabels } from '@/lib/labels';
import { exportBranded, printPdf } from '@/lib/export';
import { ReportView, docToSheets, type Cell, type Doc, type Section } from '@/components/report-doc';
import { buildFinancialStatements } from '@/lib/fin-statements';
import { categoryLabel, useSettings, type Settings } from '@/lib/settings';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select } from '@/components/ui';
import { MemberSelect } from '@/components/ops';

type Params = { from: string; to: string; asOf: string; year: number; month: string };

const REPORTS: { key: string; label: string; params: ('period' | 'asOf' | 'year' | 'month' | 'member')[] }[] = [
  { key: 'fs', label: 'القوائم المالية السنوية (حزمة كاملة)', params: ['year'] },
  { key: 'monthly', label: 'التقرير المالي الشهري', params: ['month'] },
  { key: 'annual', label: 'التقرير المالي السنوي', params: ['year'] },
  { key: 'pl', label: 'قائمة الدخل (الأرباح والخسائر)', params: ['period'] },
  { key: 'bs', label: 'الميزانية العمومية', params: ['asOf'] },
  { key: 'cf', label: 'قائمة التدفقات النقدية', params: ['period'] },
  { key: 'liquidity', label: 'تقرير السيولة', params: [] },
  { key: 'contrib', label: 'تقرير الأعضاء الشهري — اشتراكات وقروض وسداد وودائع', params: ['year'] },
  { key: 'deposits', label: 'تقرير ودائع الأعضاء', params: [] },
  { key: 'loans', label: 'محفظة القروض', params: [] },
  { key: 'outstanding', label: 'القروض القائمة', params: [] },
  { key: 'overdue', label: 'الأقساط المتأخرة', params: [] },
  { key: 'investments', label: 'أداء الاستثمارات', params: [] },
  { key: 'incomes', label: 'تقرير الإيرادات الأخرى', params: ['period'] },
  { key: 'expenses', label: 'تقرير المصروفات', params: ['period'] },
  { key: 'statement', label: 'كشوف حسابات الأعضاء', params: ['member'] },
];

export default function ReportsPage() {
  const qp = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const [key, setKey] = useState(qp.get('r') ?? 'fs');
  const [p, setP] = useState<Params>({ from: `${today().slice(0, 4)}-01-01`, to: today(), asOf: today(), year: Number(qp.get('year') ?? today().slice(0, 4)), month: firstOfMonth().slice(0, 7) });
  const [member, setMember] = useState('');
  const [doc, setDoc] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: s } = useSettings();
  const { fund } = useAuth();
  const def = REPORTS.find(r => r.key === key)!;

  useEffect(() => {
    if (key === 'statement' || !s) return;
    let alive = true;
    setBusy(true); setError(null);
    build(key, p, s, fund?.fund_name ?? '').then(d => { if (alive) setDoc(d); }).catch(e => alive && setError(cleanError(e.message))).finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [key, p, s]);

  const [xl, setXl] = useState(false);
  const toExcel = async () => {
    if (!doc) return;
    setXl(true);
    try { await exportBranded(doc.title, docToSheets(doc), { title: doc.title, subtitle: doc.subtitle, fundName: fund?.fund_name }); }
    catch (e: any) { setError(cleanError(e.message)); } finally { setXl(false); }
  };

  return (
    <>
      <PageHeader title="التقارير المالية" subtitle="جميع التقارير محسوبة مباشرة من دفتر الأستاذ — قابلة للتصدير إلى Excel و PDF" />
      <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
        <nav className="no-print rounded-xl border border-line bg-surface p-2">
          {REPORTS.map(r => (
            <button key={r.key} onClick={() => { setKey(r.key); setDoc(null); }}
              className={clsx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-[13.5px]', key === r.key ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-2 hover:bg-canvas')}>
              <FileText className="size-4 shrink-0 opacity-60" />{r.label}
            </button>
          ))}
        </nav>
        <div>
          <div className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
            {def.params.includes('period') && <>
              <Field label="من"><Input type="date" value={p.from} onChange={e => setP({ ...p, from: e.target.value })} /></Field>
              <Field label="إلى"><Input type="date" value={p.to} onChange={e => setP({ ...p, to: e.target.value })} /></Field></>}
            {def.params.includes('asOf') && <Field label="كما في"><Input type="date" value={p.asOf} onChange={e => setP({ ...p, asOf: e.target.value })} /></Field>}
            {def.params.includes('year') && <Field label="السنة"><Input type="number" dir="ltr" className="w-28" value={p.year} onChange={e => setP({ ...p, year: Number(e.target.value) })} /></Field>}
            {def.params.includes('month') && <Field label="الشهر"><Input type="month" value={p.month} onChange={e => setP({ ...p, month: e.target.value })} /></Field>}
            {def.params.includes('member') && <Field label="العضو" className="min-w-64"><MemberSelect value={member} onChange={setMember} /></Field>}
            {key === 'statement'
              ? <Button disabled={!member} onClick={() => (go(`/admin/statement/?member=${member}`))}>فتح كشف الحساب</Button>
              : <div className="mr-auto flex gap-2">
                  <Button variant="secondary" icon={<Download className="size-4" />} disabled={!doc} loading={xl} onClick={toExcel}>Excel</Button>
                  <Button variant="secondary" icon={<FileDown className="size-4" />} disabled={!doc} onClick={() => printPdf(doc?.title)}>تنزيل PDF</Button>
                </div>}
          </div>
          {key === 'statement' && <Card><p className="text-sm text-muted">اختر العضو لعرض كشف حسابه الكامل (الاشتراكات، الودائع، القروض، والعمليات) مع إمكانية التصدير والطباعة.</p></Card>}
          <ErrorBox>{error}</ErrorBox>
          {busy && !doc && <Loading />}
          {doc && key !== 'statement' && <ReportView doc={doc} fundName={fund?.fund_name ?? ''} />}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ report builders
const sb = () => supabase();
const sum = (xs: any[], k: string) => xs.reduce((a, r) => a + num(r[k]), 0);
const st = (s: string) => statusLabels[s]?.[0] ?? s;

async function build(key: string, p: Params, s: Settings, fundName: string): Promise<Doc> {
  switch (key) {
    case 'fs': return buildFinancialStatements(p.year, s, fundName);
    case 'monthly': {
      const from = `${p.month}-01`;
      const [y, m] = p.month.split('-').map(Number);
      const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return periodDoc(`التقرير المالي الشهري — ${monthLabel(from)}`, from, to);
    }
    case 'annual': return periodDoc(`التقرير المالي السنوي — ${p.year}`, `${p.year}-01-01`, `${p.year}-12-31`);
    case 'pl': { const r = await rpc('report_income_statement', { p_from: p.from, p_to: p.to }); return { title: 'قائمة الدخل', subtitle: `${date(p.from)} — ${date(p.to)}`, sections: plSections(r), note: r.note }; }
    case 'bs': { const r = await rpc('report_balance_sheet', { p_as_of: p.asOf }); return { title: 'الميزانية العمومية', subtitle: `كما في ${date(p.asOf)}`, sections: bsSections(r) }; }
    case 'cf': { const r = await rpc('report_cash_flow', { p_from: p.from, p_to: p.to }); return { title: 'قائمة التدفقات النقدية', subtitle: `${date(p.from)} — ${date(p.to)} (الطريقة المباشرة)`, sections: [cfSection(r)] }; }
    case 'liquidity': {
      const r = await rpc('report_liquidity');
      return { title: 'تقرير السيولة', subtitle: `كما في ${date(today())}`, sections: [{
        title: 'مؤشرات السيولة', header: ['البند', 'القيمة'], money: [1], rows: [
          ['النقد المتاح', r.cash], ['ودائع الأعضاء (قابلة للسحب)', r.member_deposits], ['اشتراكات قابلة للاسترداد', r.refundable_contributions],
          ['طلبات سحب معلقة/معتمدة', r.pending_withdrawals], ['قروض معتمدة لم تُصرف', r.approved_undisbursed_loans],
          ['النقد الحر بعد الالتزامات القريبة', r.free_cash], ['أقساط متوقعة خلال 30 يوماً', r.expected_repayments_30d],
          ['أقساط متوقعة خلال 90 يوماً', r.expected_repayments_90d], ['استثمارات تستحق خلال 90 يوماً', r.investments_maturing_90d]] }],
        kpis: [['نسبة تغطية الودائع بالنقد', r.deposit_coverage_ratio === null ? '—' : pct(r.deposit_coverage_ratio)]] };
    }
    case 'contrib': {
      const [r, act]: [any[], any[]] = await Promise.all([rpc('report_contribution_matrix', { p_year: p.year }), rpc('report_member_activity', { p_year: p.year })]);
      const MH = Array.from({ length: 12 }, (_, i) => String(i + 1));
      const key = (i: number) => `${p.year}-${String(i + 1).padStart(2, '0')}`;
      const cellOf = (m: any, i: number, f: (x: any) => number) => { const x = m.months?.[key(i)]; const v = x ? f(x) : 0; return v ? v : ''; };
      const total = (m: any, f: (x: any) => number) => Object.values(m.months ?? {}).reduce((a: number, x: any) => a + f(x), 0);
      const matrix = (title: string, sheet: string, f: (x: any) => number, only = true): Section => {
        const rows = act.filter(m => !only || total(m, f) !== 0);
        return { title, sheet, breakBefore: true, header: ['العضو', ...MH, 'الإجمالي'], money: [13],
          rows: rows.map(m => [m.name, ...MH.map((_, i) => cellOf(m, i, f)), total(m, f)]),
          total: ['الإجمالي', ...MH.map((_, i) => act.reduce((a, m) => a + num(cellOf(m, i, f) || 0), 0) || ''), act.reduce((a, m) => a + total(m, f), 0)] };
      };
      const fsum = (i: number, k: string) => act.reduce((a, m) => a + num(m.months?.[key(i)]?.[k] ?? 0), 0);
      const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      const K = ['contrib', 'repay', 'loans', 'dep', 'wd'];
      return { title: `تقرير الأعضاء الشهري — ${p.year}`, subtitle: 'الاشتراكات والقروض والسداد والودائع لكل شهر — من العمليات المسجلة فعلياً', sections: [
        { title: 'ملخص الصندوق لكل شهر', sheet: 'ملخص شهري', header: ['الشهر', 'اشتراكات', 'سداد قروض', 'قروض مصروفة', 'ودائع', 'سحوبات', 'صافي التدفق'], money: [1, 2, 3, 4, 5, 6],
          rows: MONTHS.map((mn, i) => [mn, ...K.map(k => fsum(i, k)), fsum(i, 'contrib') + fsum(i, 'repay') + fsum(i, 'dep') - fsum(i, 'loans') - fsum(i, 'wd')]),
          total: ['الإجمالي', ...K.map(k => MONTHS.reduce((a, _, i) => a + fsum(i, k), 0)), MONTHS.reduce((a, _, i) => a + fsum(i, 'contrib') + fsum(i, 'repay') + fsum(i, 'dep') - fsum(i, 'loans') - fsum(i, 'wd'), 0)] },
        { title: 'الاشتراكات — المسدد لكل شهر', sheet: 'الاشتراكات', breakBefore: true, header: ['العضو', ...MH, 'المسدد', 'المستحق حتى اليوم', 'المتأخر'],
          money: [13, 14, 15], rows: r.map(m => [m.name, ...MH.map((_, i) => m.months[i + 1] ? `${num(m.months[i + 1].paid)}` : ''), m.total_paid, m.total_due, Math.max(0, num(m.total_due) - num(m.total_paid))]),
          total: ['الإجمالي', ...Array(12).fill(''), sum(r, 'total_paid'), sum(r, 'total_due'), r.reduce((a, m) => a + Math.max(0, num(m.total_due) - num(m.total_paid)), 0)] },
        matrix('سداد القروض لكل شهر', 'سداد القروض', x => num(x.repay)),
        matrix('القروض المصروفة لكل شهر', 'القروض المصروفة', x => num(x.loans)),
        matrix('الودائع لكل شهر (إيداع − سحب)', 'الودائع', x => num(x.dep) - num(x.wd)),
      ] };
    }
    case 'deposits': {
      const r: any[] = await q(sb().from('v_member_balances').select('*').order('member_no'));
      return { title: 'تقرير ودائع الأعضاء', subtitle: `كما في ${date(today())}`, sections: [{
        title: 'أرصدة الودائع', header: ['رقم العضو', 'العضو', 'إجمالي الإيداعات', 'السحوبات', 'الرصيد', 'قيد السحب', 'المتاح'], money: [2, 3, 4, 5, 6],
        rows: r.map(b => [b.member_no, b.full_name, b.deposits_total, b.withdrawals_paid, b.deposit_balance, b.withdrawals_pending, b.available_to_withdraw]),
        total: ['', 'الإجمالي', sum(r, 'deposits_total'), sum(r, 'withdrawals_paid'), sum(r, 'deposit_balance'), sum(r, 'withdrawals_pending'), sum(r, 'available_to_withdraw')] }] };
    }
    case 'loans': case 'outstanding': {
      let r: any[] = await q(sb().from('v_loan_summary').select('*').order('request_date', { ascending: false }));
      if (key === 'outstanding') r = r.filter(l => ['disbursed', 'active', 'overdue'].includes(l.status));
      return { title: key === 'loans' ? 'تقرير محفظة القروض' : 'تقرير القروض القائمة', subtitle: `كما في ${date(today())}`,
        kpis: [['عدد القروض', String(r.length)], ['إجمالي المصروف', sar(sum(r.filter(l => l.disbursement_tx_id), 'approved_amount'))], ['الرصيد القائم', sar(sum(r, 'outstanding'))], ['المتأخرات', sar(sum(r, 'overdue_amount'))]],
        sections: [{ title: 'القروض', header: ['الرقم', 'العضو', 'الحالة', 'تاريخ الطلب', 'تاريخ الصرف', 'المعتمد', 'المسدد', 'المتبقي', 'متأخرات', 'الأقساط', 'الدورية'], money: [5, 6, 7, 8],
          rows: r.map(l => [l.loan_no, l.member_name, st(l.status), l.request_date, l.disbursed_on, l.approved_amount ?? l.requested_amount, l.amount_repaid, l.outstanding, l.overdue_amount, l.installments_count ? `${l.paid_count}/${l.installments_count}` : '', frequencyLabels[l.frequency] ?? '']),
          total: ['', 'الإجمالي', '', '', '', sum(r, 'approved_amount'), sum(r, 'amount_repaid'), sum(r, 'outstanding'), sum(r, 'overdue_amount'), '', ''] }] };
    }
    case 'overdue': {
      const [inst, loans] = await Promise.all([
        q(sb().from('v_installment_status').select('*').eq('status', 'overdue').order('due_date')),
        q(sb().from('v_loan_summary').select('id, loan_no, member_name, status')),
      ]);
      const lm = new Map((loans as any[]).map(l => [l.id, l]));
      const rows = (inst as any[]).filter(i => ['disbursed', 'active', 'overdue'].includes(lm.get(i.loan_id)?.status));
      const days = (d: string) => Math.floor((Date.parse(today()) - Date.parse(d)) / 86400000);
      return { title: 'تقرير الأقساط المتأخرة', subtitle: `كما في ${date(today())} (بعد مهلة ${s.loan_grace_days} أيام)`, sections: [{
        title: 'الأقساط المتأخرة', header: ['القرض', 'العضو', 'القسط', 'تاريخ الاستحقاق', 'أيام التأخير', 'المبلغ', 'المسدد', 'المتبقي'], money: [5, 6, 7],
        rows: rows.map(i => [lm.get(i.loan_id)?.loan_no, lm.get(i.loan_id)?.member_name, i.seq, i.due_date, days(i.due_date), i.amount_due, i.amount_paid, i.amount_remaining]),
        total: ['', 'الإجمالي', '', '', '', sum(rows, 'amount_due'), sum(rows, 'amount_paid'), sum(rows, 'amount_remaining')] }] };
    }
    case 'investments': {
      const r: any[] = await q(sb().from('v_investment_positions').select('*').order('investment_date'));
      return { title: 'تقرير أداء الاستثمارات', subtitle: `كما في ${date(today())}`, note: 'الأرباح غير المحققة تقديرية بناءً على آخر تقييم، ولا تُعد نقداً أو دخلاً محققاً.',
        kpis: [['القيمة الحالية', sar(sum(r, 'current_value'))], ['التكلفة القائمة', sar(sum(r, 'cost_basis'))], ['غير محقق', sar(sum(r, 'unrealized_pl'), { sign: true })], ['محقق', sar(sum(r, 'realized_pl'), { sign: true })]],
        sections: [{ title: 'الاستثمارات', header: ['الاستثمار', 'الفئة', 'الحالة', 'التاريخ', 'الاستحقاق', 'المستثمر', 'المسترد', 'التكلفة', 'القيمة الحالية', 'غير محقق', 'محقق', 'العائد الكلي %'], money: [5, 6, 7, 8, 9, 10],
          rows: r.map(i => [i.name, categoryLabel(s, i.category), st(i.status), i.investment_date, i.maturity_date, i.total_invested, i.total_returned, i.cost_basis, i.current_value, i.unrealized_pl, i.realized_pl,
            num(i.total_invested) ? pct((num(i.realized_pl) + num(i.unrealized_pl)) / num(i.total_invested)) : '—']),
          total: ['الإجمالي', '', '', '', '', sum(r, 'total_invested'), sum(r, 'total_returned'), sum(r, 'cost_basis'), sum(r, 'current_value'), sum(r, 'unrealized_pl'), sum(r, 'realized_pl'), ''] }] };
    }
    case 'incomes': {
      const [inc, tx] = await Promise.all([
        q(sb().from('incomes').select('*').gte('income_date', p.from).lte('income_date', p.to).order('income_date')),
        q(sb().from('v_transactions').select('id, is_reversed').eq('tx_type', 'other_income')),
      ]);
      const rev = new Set((tx as any[]).filter(t => t.is_reversed).map(t => t.id));
      const live = (inc as any[]).filter(e => !rev.has(e.financial_transaction_id));
      const cats = Object.entries(live.reduce((m: Record<string, number>, e) => ({ ...m, [e.category]: (m[e.category] ?? 0) + num(e.amount) }), {}));
      return { title: 'تقرير الإيرادات الأخرى', subtitle: `${date(p.from)} — ${date(p.to)}`, sections: [
        { title: 'حسب الفئة', header: ['الفئة', 'المبلغ'], money: [1], rows: cats as Cell[][], total: ['الإجمالي', sum(live, 'amount')] },
        { title: 'التفاصيل', header: ['التاريخ', 'الفئة', 'البيان', 'الدافع / المصدر', 'المرجع', 'المبلغ'], money: [5], rows: live.map(e => [e.income_date, e.category, e.description, e.payer, e.reference, e.amount]) },
      ] };
    }
    case 'expenses': {
      const [ex, tx] = await Promise.all([
        q(sb().from('expenses').select('*').gte('expense_date', p.from).lte('expense_date', p.to).order('expense_date')),
        q(sb().from('v_transactions').select('id, is_reversed').eq('tx_type', 'expense')),
      ]);
      const rev = new Set((tx as any[]).filter(t => t.is_reversed).map(t => t.id));
      const live = (ex as any[]).filter(e => !rev.has(e.financial_transaction_id));
      const cats = Object.entries(live.reduce((m: Record<string, number>, e) => ({ ...m, [e.category]: (m[e.category] ?? 0) + num(e.amount) }), {}));
      return { title: 'تقرير المصروفات', subtitle: `${date(p.from)} — ${date(p.to)}`, sections: [
        { title: 'حسب الفئة', header: ['الفئة', 'المبلغ'], money: [1], rows: cats as Cell[][], total: ['الإجمالي', sum(live, 'amount')] },
        { title: 'التفاصيل', header: ['التاريخ', 'الفئة', 'البيان', 'المستفيد', 'المرجع', 'المبلغ'], money: [5], rows: live.map(e => [e.expense_date, e.category, e.description, e.payee, e.reference, e.amount]) },
      ] };
    }
  }
  throw new Error('تقرير غير معروف');
}

async function periodDoc(title: string, from: string, to: string): Promise<Doc> {
  const r = await rpc('report_period_summary', { p_from: from, p_to: to });
  const c = r.contributions, is = r.income_statement, cf = r.cash_flow, bs = r.balance_sheet;
  const act = Object.entries(r.activity ?? {}) as [string, any][];
  return {
    title, subtitle: `${date(from)} — ${date(to)}`,
    kpis: [
      ['صافي الفائض للفترة', sar(is.net_surplus, { sign: true })], ['صافي التغير في النقد', sar(cf.net_change, { sign: true })],
      ['إجمالي الأصول (نهاية الفترة)', sar(bs.total_assets)], ['الاشتراكات المحصلة', `${sar(c.collected)} من ${sar(c.due)}`],
      ['نسبة التحصيل', pct(num(c.due) ? num(c.collected) / num(c.due) : 0)], ['قروض جديدة / أعضاء جدد', `${r.new_loans} / ${r.new_members}`],
    ],
    note: is.note,
    sections: [
      { title: 'ملخص العمليات', header: ['نوع العملية', 'العدد', 'المبلغ'], money: [2], rows: act.map(([k, v]) => [txTypeLabels[k] ?? k, v.count, v.amount]) },
      ...plSections(is), cfSection(cf), ...bsSections(bs),
    ],
  };
}

function plSections(r: any): Section[] {
  const inc = r.accounts.filter((a: any) => a.type === 'income');
  const exp = r.accounts.filter((a: any) => a.type === 'expense');
  return [{
    title: 'قائمة الدخل', header: ['الحساب', 'البند', 'المبلغ'], money: [2],
    rows: [['', 'الإيرادات', null], ...inc.map((a: any) => [a.code, a.name, a.amount]), ['', 'إجمالي الإيرادات', r.total_income],
           ['', 'المصروفات والخسائر', null], ...exp.map((a: any) => [a.code, a.name, a.amount]), ['', 'إجمالي المصروفات', r.total_expense]],
    styles: ['section', ...inc.map(() => undefined), 'subtotal', 'section', ...exp.map(() => undefined), 'subtotal'],
    total: ['', 'صافي الفائض (العجز)', r.net_surplus],
  }, { title: 'بنود خارج قائمة الدخل', header: ['البند', 'المبلغ'], money: [1], rows: [['تغير الأرباح/الخسائر غير المحققة (حقوق الملكية)', r.unrealized_change]] }];
}

function bsSections(r: any): Section[] {
  const by = (t: string) => r.accounts.filter((a: any) => a.type === t && num(a.balance) !== 0);
  return [
    { title: 'الأصول', header: ['الحساب', 'البند', 'الرصيد'], money: [2], rows: by('asset').map((a: any) => [a.code, a.name, a.balance]), total: ['', 'إجمالي الأصول', r.total_assets] },
    { title: 'الالتزامات وحقوق الملكية', header: ['الحساب', 'البند', 'الرصيد'], money: [2],
      rows: [['', accountTypeLabels.liability, null], ...by('liability').map((a: any) => [a.code, a.name, a.balance]), ['', 'إجمالي الالتزامات', r.total_liabilities],
             ['', accountTypeLabels.equity, null], ...by('equity').map((a: any) => [a.code, a.name, a.balance]), ['', 'الفائض المتراكم (غير مقفل)', r.current_surplus], ['', 'إجمالي حقوق الملكية', r.total_equity]],
      styles: ['section', ...by('liability').map(() => undefined), 'subtotal', 'section', ...by('equity').map(() => undefined), undefined, 'subtotal'],
      total: ['', 'إجمالي الالتزامات وحقوق الملكية', num(r.total_liabilities) + num(r.total_equity)] },
  ];
}

function cfSection(r: any): Section {
  return {
    title: 'التدفقات النقدية', header: ['البند', 'داخل', 'خارج', 'الصافي'], money: [1, 2, 3],
    styles: ['subtotal'],
    rows: [['رصيد النقد أول المدة', null, null, r.opening_cash], ...r.lines.map((l: any) => [txTypeLabels[l.category] ?? l.category, l.inflow, l.outflow, l.net])],
    total: ['رصيد النقد آخر المدة', null, null, r.closing_cash],
  };
}
