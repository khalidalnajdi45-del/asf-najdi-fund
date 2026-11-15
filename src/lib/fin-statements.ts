'use client';
import { rpc, supabase } from './supabase';
import { q } from './hooks';
import { date, num, today } from './format';
import { categoryLabel, type Settings } from './settings';
import type { Cell, Doc, RowStyle, Section } from '@/components/report-doc';

/**
 * Full annual financial statements package (IFRS for SMEs presentation, as endorsed by SOCPA):
 * cover · financial position · comprehensive income · changes in members' equity · cash flows · notes · approval.
 * Every figure comes from the ledger RPCs; current year is compared with the prior year.
 */
export async function buildFinancialStatements(year: number, s: Settings, fundName: string): Promise<Doc> {
  const t = today();
  const end = `${year}-12-31` < t ? `${year}-12-31` : t;
  const isPartial = end !== `${year}-12-31`;
  const pEnd = `${year - 1}-12-31`, ppEnd = `${year - 2}-12-31`;
  const from = `${year}-01-01`, pFrom = `${year - 1}-01-01`;
  const sb = supabase();

  const [bs, bsP, bsPP, is, isP, cf, cfP, matrix, inv, loans, bal, members, inc, exp, txs] = await Promise.all([
    rpc('report_balance_sheet', { p_as_of: end }), rpc('report_balance_sheet', { p_as_of: pEnd }), rpc('report_balance_sheet', { p_as_of: ppEnd }),
    rpc('report_income_statement', { p_from: from, p_to: end }), rpc('report_income_statement', { p_from: pFrom, p_to: pEnd }),
    rpc('report_cash_flow', { p_from: from, p_to: end }), rpc('report_cash_flow', { p_from: pFrom, p_to: pEnd }),
    rpc('report_contribution_matrix', { p_year: year }),
    q(sb.from('v_investment_positions').select('*').order('investment_date')),
    q(sb.from('v_loan_summary').select('*')),
    q(sb.from('v_member_balances').select('*').order('member_no')),
    q(sb.from('members').select('id, status')),
    q(sb.from('incomes').select('*').gte('income_date', from).lte('income_date', end)),
    q(sb.from('expenses').select('*').gte('expense_date', from).lte('expense_date', end)),
    q(sb.from('v_transactions').select('id, is_reversed').in('tx_type', ['other_income', 'expense'])),
  ]) as any[];

  const A = (r: any, code: string) => num(r.accounts.find((a: any) => a.code === code)?.balance);
  const I = (r: any, code: string) => num(r.accounts.find((a: any) => a.code === code)?.amount);
  const cy = `${isPartial ? date(end) : `31 ديسمبر ${year}`}`, py = `31 ديسمبر ${year - 1}`;
  const surplusOf = (r: any) => A(r, '3100') + A(r, '3900') + num(r.current_surplus);
  const has = (code: string) => A(bs, code) !== 0 || A(bsP, code) !== 0;

  // ---------------------------------------------------------------- 1. financial position
  const fpRows: [Cell[], RowStyle][] = [
    [['الأصول', '', null, null], 'section'],
    [['النقد وما في حكمه', '4', A(bs, '1000'), A(bsP, '1000')], undefined],
    [['قروض الأعضاء', '5', A(bs, '1100'), A(bsP, '1100')], undefined],
    [['الاستثمارات', '6', A(bs, '1200') + A(bs, '1210'), A(bsP, '1200') + A(bsP, '1210')], undefined],
    [['إجمالي الأصول', '', num(bs.total_assets), num(bsP.total_assets)], 'total'],
    [['الالتزامات', '', null, null], 'section'],
    [['ودائع الأعضاء', '7', A(bs, '2000'), A(bsP, '2000')], undefined],
    ...(has('2300') ? [[['اشتراكات قابلة للاسترداد', '8', A(bs, '2300'), A(bsP, '2300')], undefined] as [Cell[], RowStyle]] : []),
    ...(has('2100') ? [[['التزامات أخرى', '', A(bs, '2100'), A(bsP, '2100')], undefined] as [Cell[], RowStyle]] : []),
    [['إجمالي الالتزامات', '', num(bs.total_liabilities), num(bsP.total_liabilities)], 'subtotal'],
    [['حقوق الأعضاء', '', null, null], 'section'],
    ...(has('3000') ? [[['رأس مال الاشتراكات', '8', A(bs, '3000'), A(bsP, '3000')], undefined] as [Cell[], RowStyle]] : []),
    [['الفائض المتراكم', '', surplusOf(bs), surplusOf(bsP)], undefined],
    [['احتياطي القيمة العادلة للاستثمارات', '6', A(bs, '3200'), A(bsP, '3200')], undefined],
    [['إجمالي حقوق الأعضاء', '', num(bs.total_equity), num(bsP.total_equity)], 'subtotal'],
  ];
  const fp: Section = {
    title: 'قائمة المركز المالي', sheet: 'المركز المالي', breakBefore: true,
    header: ['البند', 'إيضاح', cy, py], money: [2, 3],
    rows: fpRows.map(r => r[0]), styles: fpRows.map(r => r[1]),
    total: ['إجمالي الالتزامات وحقوق الأعضاء', '', num(bs.total_liabilities) + num(bs.total_equity), num(bsP.total_liabilities) + num(bsP.total_equity)],
  };

  // ---------------------------------------------------------------- 2. comprehensive income
  const tci = num(is.net_surplus) + num(is.unrealized_change), tciP = num(isP.net_surplus) + num(isP.unrealized_change);
  const ciRows: [Cell[], RowStyle][] = [
    [['الإيرادات', '', null, null], 'section'],
    [['إيرادات الاستثمار المحققة', '6', I(is, '4000'), I(isP, '4000')], undefined],
    [['رسوم إدارية على قروض الأعضاء', '5', I(is, '4100'), I(isP, '4100')], undefined],
    [['إيرادات أخرى', '9', I(is, '4900'), I(isP, '4900')], undefined],
    [['إجمالي الإيرادات', '', num(is.total_income), num(isP.total_income)], 'subtotal'],
    [['المصروفات', '', null, null], 'section'],
    [['مصروفات تشغيلية', '10', -I(is, '5000'), -I(isP, '5000')], undefined],
    [['خسائر استثمار محققة', '6', -I(is, '5100'), -I(isP, '5100')], undefined],
    [['إجمالي المصروفات', '', -num(is.total_expense), -num(isP.total_expense)], 'subtotal'],
    [['صافي فائض (عجز) السنة', '', num(is.net_surplus), num(isP.net_surplus)], 'total'],
    [['الدخل الشامل الآخر', '', null, null], 'section'],
    [['صافي التغير في القيمة العادلة للاستثمارات (غير محقق)', '6', num(is.unrealized_change), num(isP.unrealized_change)], undefined],
  ];
  const ci: Section = {
    title: 'قائمة الدخل الشامل', sheet: 'الدخل الشامل', breakBefore: true,
    header: ['البند', 'إيضاح', isPartial ? `من ${date(from)} إلى ${date(end)}` : `السنة المنتهية في ${cy}`, `السنة المنتهية في ${py}`], money: [2, 3],
    rows: ciRows.map(r => r[0]), styles: ciRows.map(r => r[1]), total: ['إجمالي الدخل الشامل للسنة', '', tci, tciP],
  };

  // ---------------------------------------------------------------- 3. changes in members' equity
  const eqRow = (label: string, r: any): Cell[] => [label, A(r, '3000'), surplusOf(r), A(r, '3200'), num(r.total_equity)];
  const mv = (label: string, a: number, b: number, c: number): Cell[] => [label, a, b, c, a + b + c];
  const adj = (r1: any, r0: any) => (A(r1, '3100') + A(r1, '3900')) - (A(r0, '3100') + A(r0, '3900'));
  const eqRows: [Cell[], RowStyle][] = [
    [eqRow(`الرصيد في ${date(ppEnd)}`, bsPP), 'subtotal'],
    [mv('اشتراكات الأعضاء خلال السنة', A(bsP, '3000') - A(bsPP, '3000'), 0, 0), undefined],
    [mv('صافي فائض السنة', 0, num(isP.net_surplus), 0), undefined],
    [mv('الدخل الشامل الآخر', 0, 0, num(isP.unrealized_change)), undefined],
    ...(adj(bsP, bsPP) ? [[mv('أرصدة افتتاحية وتسويات', 0, adj(bsP, bsPP), 0), undefined] as [Cell[], RowStyle]] : []),
    [eqRow(`الرصيد في ${date(pEnd)}`, bsP), 'total'],
    [mv('اشتراكات الأعضاء خلال السنة', A(bs, '3000') - A(bsP, '3000'), 0, 0), undefined],
    [mv('صافي فائض السنة', 0, num(is.net_surplus), 0), undefined],
    [mv('الدخل الشامل الآخر', 0, 0, num(is.unrealized_change)), undefined],
    ...(adj(bs, bsP) ? [[mv('أرصدة افتتاحية وتسويات', 0, adj(bs, bsP), 0), undefined] as [Cell[], RowStyle]] : []),
  ];
  const eq: Section = {
    title: 'قائمة التغيرات في حقوق الأعضاء', sheet: 'حقوق الأعضاء', breakBefore: true,
    header: ['البند', 'رأس مال الاشتراكات', 'الفائض المتراكم', 'احتياطي القيمة العادلة', 'الإجمالي'], money: [1, 2, 3, 4],
    rows: eqRows.map(r => r[0]), styles: eqRows.map(r => r[1]), total: eqRow(`الرصيد في ${date(end)}`, bs),
  };

  // ---------------------------------------------------------------- 4. cash flows (direct method)
  const GROUPS: { title: string; net: string; items: [string, string][] }[] = [
    { title: 'التدفقات النقدية من الأنشطة التشغيلية', net: 'صافي النقد من الأنشطة التشغيلية', items: [
      ['other_income', 'متحصلات إيرادات أخرى'], ['expense', 'مدفوعات مصروفات تشغيلية'],
      ['loan_disbursement', 'قروض مصروفة للأعضاء'], ['loan_repayment', 'متحصلات سداد قروض الأعضاء'], ['manual_journal', 'قيود تسوية نقدية']] },
    { title: 'التدفقات النقدية من الأنشطة الاستثمارية', net: 'صافي النقد من الأنشطة الاستثمارية', items: [
      ['investment_capital', 'مدفوعات لشراء استثمارات'], ['investment_income', 'عوائد استثمار مقبوضة'], ['investment_exit', 'متحصلات التخارج من استثمارات']] },
    { title: 'التدفقات النقدية من الأنشطة التمويلية', net: 'صافي النقد من الأنشطة التمويلية', items: [
      ['contribution_payment', 'اشتراكات الأعضاء المحصلة'], ['deposit', 'ودائع مستلمة من الأعضاء'], ['withdrawal_payment', 'ودائع مسددة للأعضاء']] },
  ];
  const cfNet = (r: any, k: string) => num(r.lines.find((l: any) => l.category === k)?.net);
  const known = new Set(GROUPS.flatMap(g => g.items.map(i => i[0])));
  const other = (r: any) => r.lines.filter((l: any) => !known.has(l.category)).reduce((a: number, l: any) => a + num(l.net), 0);
  const cfRows: [Cell[], RowStyle][] = [];
  for (const g of GROUPS) {
    cfRows.push([[g.title, null, null], 'section']);
    for (const [k, label] of g.items) {
      if (cfNet(cf, k) || cfNet(cfP, k)) cfRows.push([[label, cfNet(cf, k), cfNet(cfP, k)], undefined]);
    }
    const tot = (r: any) => g.items.reduce((a, [k]) => a + cfNet(r, k), 0) + (g === GROUPS[0] ? other(r) : 0);
    cfRows.push([[g.net, tot(cf), tot(cfP)], 'subtotal']);
  }
  cfRows.push([['صافي التغير في النقد وما في حكمه', num(cf.net_change), num(cfP.net_change)], 'total']);
  cfRows.push([['النقد وما في حكمه في بداية السنة', num(cf.opening_cash), num(cfP.opening_cash)], undefined]);
  const cfs: Section = {
    title: 'قائمة التدفقات النقدية', sheet: 'التدفقات النقدية', breakBefore: true,
    header: ['البند', isPartial ? `حتى ${date(end)}` : `السنة المنتهية في ${cy}`, `السنة المنتهية في ${py}`], money: [1, 2],
    rows: cfRows.map(r => r[0]), styles: cfRows.map(r => r[1]), total: ['النقد وما في حكمه في نهاية السنة', num(cf.closing_cash), num(cfP.closing_cash)],
  };

  // ---------------------------------------------------------------- 5. notes
  const active = (members as any[]).filter(m => m.status === 'active').length;
  const rev = new Set((txs as any[]).filter(x => x.is_reversed).map(x => x.id));
  const byCat = (rows: any[]): [string, number][] => Object.entries<number>(rows.filter(r => !rev.has(r.financial_transaction_id))
    .reduce((m: Record<string, number>, r) => ({ ...m, [r.category]: (m[r.category] ?? 0) + num(r.amount) }), {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);
  const incCats = byCat(inc), expCats = byCat(exp);
  const openLoans = (loans as any[]).filter(l => ['disbursed', 'active', 'overdue'].includes(l.status));
  const loanBy = Object.values(openLoans.reduce((m: Record<string, any>, l) => {
    const k = l.member_name; m[k] ??= { name: k, n: 0, out: 0, od: 0 }; m[k].n++; m[k].out += num(l.outstanding); m[k].od += num(l.overdue_amount); return m;
  }, {})) as any[];
  const invLive = (inv as any[]).filter(i => i.status !== 'exited' || num(i.realized_pl) !== 0);
  const snapNote = isPartial ? undefined : `التفاصيل حسب العضو/الاستثمار معروضة كما في تاريخ إعداد القوائم (${date(t)})، والأرصدة الإجمالية مطابقة لدفتر الأستاذ في ${cy}.`;
  const treat = s.contribution_treatment === 'liability_refundable';

  const notes: Section[] = [
    { title: 'إيضاح 1 — معلومات عامة عن الصندوق', sheet: 'الإيضاحات', breakBefore: true, header: [], rows: [], paras: [
      `${fundName} صندوق ادخاري عائلي غير هادف للربح، يهدف إلى تنمية مدخرات أفراد العائلة وتقديم قروض حسنة لهم واستثمار الفائض في أوعية منخفضة إلى متوسطة المخاطر.`,
      `بلغ عدد الأعضاء النشطين ${active} عضواً في تاريخ إعداد القوائم، والاشتراك الشهري المعتمد ${num(s.monthly_contribution).toLocaleString('en-US')} ريال للعضو.`,
      `تغطي هذه القوائم الفترة ${isPartial ? `من ${date(from)} حتى ${date(end)} (فترة جزئية)` : `من 1 يناير حتى 31 ديسمبر ${year}`} مع أرقام مقارنة للسنة السابقة.`,
    ] },
    { title: 'إيضاح 2 — أسس الإعداد', sheet: 'الإيضاحات', header: [], rows: [], paras: [
      'أُعدت القوائم المالية وفقاً للمعيار الدولي للتقرير المالي للمنشآت الصغيرة والمتوسطة المعتمد في المملكة العربية السعودية، بقدر ما يتناسب مع طبيعة الصندوق العائلي.',
      'أُعدت القوائم على أساس الاستحقاق ومبدأ التكلفة التاريخية، باستثناء الاستثمارات المدرجة التي تقاس بالقيمة العادلة.',
      'العملة الوظيفية وعملة العرض هي الريال السعودي، وتُقرب المبالغ لأقرب هللة.',
    ] },
    { title: 'إيضاح 3 — السياسات المحاسبية الهامة', sheet: 'الإيضاحات', header: [], rows: [], paras: [
      treat ? 'الاشتراكات الشهرية: تُثبت كالتزام قابل للاسترداد للأعضاء عند تحصيلها.' : 'الاشتراكات الشهرية: تُثبت ضمن حقوق الأعضاء (رأس مال الاشتراكات) عند تحصيلها، ولا تُعد إيراداً.',
      'ودائع الأعضاء الاختيارية: تُثبت كالتزام على الصندوق قابل للسحب وفق سياسة السحب المعتمدة.',
      'قروض الأعضاء: قروض حسنة تُقاس بالمبلغ الأصلي ناقصاً المسدد، وتُصنف المتأخرات بعد انقضاء مهلة السداد المعتمدة. تُثبت الرسوم الإدارية — إن وجدت — كإيراد عند تحصيلها.',
      'الاستثمارات: تُثبت بالتكلفة ثم يُعاد قياسها بالقيمة العادلة في تاريخ التقرير، ويُثبت التغير غير المحقق في احتياطي القيمة العادلة ضمن الدخل الشامل الآخر، ويُحوَّل الربح أو الخسارة إلى قائمة الدخل عند التحقق (البيع/التخارج).',
      'الإيرادات الأخرى والمصروفات: تُثبت عند تحققها، وأي تصحيح يتم بقيد عكسي موثق دون تعديل القيود الأصلية.',
    ] },
    { title: 'إيضاح 4 — النقد وما في حكمه', sheet: 'الإيضاحات', header: ['البند', cy, py], money: [1, 2],
      rows: [['النقد لدى البنوك والصندوق', A(bs, '1000'), A(bsP, '1000')]], total: ['الإجمالي', A(bs, '1000'), A(bsP, '1000')] },
    { title: 'إيضاح 5 — قروض الأعضاء', sheet: 'الإيضاحات', header: ['العضو', 'عدد القروض القائمة', 'الرصيد القائم', 'منها متأخرات'], money: [2, 3], compact: true,
      rows: loanBy.map(l => [l.name, l.n, l.out, l.od]), total: ['الإجمالي حسب السجل التفصيلي', openLoans.length, loanBy.reduce((a, l) => a + l.out, 0), loanBy.reduce((a, l) => a + l.od, 0)],
      paras: [`رصيد قروض الأعضاء في دفتر الأستاذ: ${fmt(A(bs, '1100'))} ريال في ${cy} مقابل ${fmt(A(bsP, '1100'))} ريال في ${py}. جميع القروض حسنة بدون عائد.`], note: snapNote },
    { title: 'إيضاح 6 — الاستثمارات', sheet: 'الإيضاحات', header: ['الاستثمار', 'الفئة', 'التكلفة', 'القيمة العادلة', 'ربح/خسارة غير محقق', 'محقق'], money: [2, 3, 4, 5], compact: true,
      rows: invLive.map(i => [i.name, categoryLabel(s, i.category), num(i.cost_basis), num(i.current_value), num(i.unrealized_pl), num(i.realized_pl)]),
      total: ['الإجمالي', '', invLive.reduce((a, i) => a + num(i.cost_basis), 0), invLive.reduce((a, i) => a + num(i.current_value), 0), invLive.reduce((a, i) => a + num(i.unrealized_pl), 0), invLive.reduce((a, i) => a + num(i.realized_pl), 0)],
      paras: [`القيمة الدفترية للاستثمارات: ${fmt(A(bs, '1200') + A(bs, '1210'))} ريال (التكلفة ${fmt(A(bs, '1200'))} + فروق التقييم ${fmt(A(bs, '1210'))}). الأسهم المدرجة تُقيَّم بأسعار السوق المالية السعودية (تداول) عند آخر ترحيل شهري.`], note: snapNote },
    { title: 'إيضاح 7 — ودائع الأعضاء', sheet: 'الإيضاحات', header: ['العضو', 'إجمالي الإيداعات', 'السحوبات', 'الرصيد'], money: [1, 2, 3], compact: true,
      rows: (bal as any[]).filter(b => num(b.deposit_balance) || num(b.deposits_total)).map(b => [b.full_name, num(b.deposits_total), num(b.withdrawals_paid), num(b.deposit_balance)]),
      total: ['الإجمالي', null, null, (bal as any[]).reduce((a, b) => a + num(b.deposit_balance), 0)],
      paras: [`رصيد ودائع الأعضاء في دفتر الأستاذ: ${fmt(A(bs, '2000'))} ريال في ${cy} مقابل ${fmt(A(bsP, '2000'))} ريال في ${py}.`], note: snapNote },
    { title: `إيضاح 8 — ${treat ? 'الاشتراكات القابلة للاسترداد' : 'رأس مال الاشتراكات'} (المحصل خلال ${year})`, sheet: 'الإيضاحات', header: ['العضو', 'المستحق', 'المسدد', 'المتأخر'], money: [1, 2, 3], compact: true,
      rows: (matrix as any[]).map(m => [m.name, num(m.total_due), num(m.total_paid), Math.max(0, num(m.total_due) - num(m.total_paid))]),
      total: ['الإجمالي', (matrix as any[]).reduce((a, m) => a + num(m.total_due), 0), (matrix as any[]).reduce((a, m) => a + num(m.total_paid), 0), (matrix as any[]).reduce((a, m) => a + Math.max(0, num(m.total_due) - num(m.total_paid)), 0)] },
    { title: 'إيضاح 9 — الإيرادات الأخرى', sheet: 'الإيضاحات', header: ['الفئة', 'المبلغ'], money: [1],
      rows: incCats as Cell[][], total: ['الإجمالي', incCats.reduce((a, c) => a + c[1], 0)],
      note: 'تشمل الهبات والتبرعات والأرباح البنكية غير المرتبطة باستثمار والرسوم والغرامات.' },
    { title: 'إيضاح 10 — المصروفات التشغيلية', sheet: 'الإيضاحات', header: ['الفئة', 'المبلغ'], money: [1],
      rows: expCats as Cell[][], total: ['الإجمالي', expCats.reduce((a, c) => a + c[1], 0)] },
    { title: 'إيضاح 11 — اعتماد القوائم المالية', sheet: 'الإيضاحات', header: [], rows: [], paras: [
      'لا توجد أحداث لاحقة جوهرية بعد تاريخ القوائم تتطلب تعديلاً أو إفصاحاً، ما لم يُذكر خلاف ذلك.',
      'اعتمدت إدارة الصندوق هذه القوائم المالية بتاريخ التوقيع أدناه.',
    ] },
  ];

  return {
    title: `القوائم المالية — ${year}`,
    subtitle: isPartial ? `للفترة من ${date(from)} حتى ${date(end)} مع أرقام المقارنة لسنة ${year - 1}` : `للسنة المنتهية في 31 ديسمبر ${year} مع أرقام المقارنة لسنة ${year - 1}`,
    cover: { kicker: 'FINANCIAL STATEMENTS', title: 'القوائم المالية', year: String(year), period: isPartial ? `للفترة المنتهية في ${date(end)}` : `للسنة المنتهية في 31 ديسمبر ${year}` },
    contents: ['قائمة المركز المالي', 'قائمة الدخل الشامل', 'قائمة التغيرات في حقوق الأعضاء', 'قائمة التدفقات النقدية', 'الإيضاحات المتممة'],
    kpis: [
      ['إجمالي الأصول', fmtS(num(bs.total_assets))], ['حقوق الأعضاء', fmtS(num(bs.total_equity))], ['صافي فائض السنة', fmtS(num(is.net_surplus))],
      ['إجمالي الدخل الشامل', fmtS(tci)], ['النقد في نهاية الفترة', fmtS(num(cf.closing_cash))], ['معادلة الميزانية', Math.abs(num(bs.total_assets) - num(bs.total_liabilities) - num(bs.total_equity)) < 0.01 ? 'متوازنة ✓' : 'غير متوازنة'],
    ],
    note: 'تُقرأ القوائم مع الإيضاحات المتممة لها. الأرقام بين قوسين سالبة.',
    sections: [fp, ci, eq, cfs, ...notes],
    signatures: ['مدير الصندوق', 'المدير المالي', 'عضو مراجع'],
  };
}

const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtS = (v: number) => `${fmt(v)} ر.س`;
