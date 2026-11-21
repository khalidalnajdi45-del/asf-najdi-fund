// نَجْد | NAJD AI — مستشارك المالي: AI advisor for the fund (Claude API + read-only tools).
// Every tool runs with the CALLER's own JWT, so Postgres RLS and the RPC role checks decide what it may read:
// a member only ever sees their own data; the manager sees the fund. The advisor never writes anything itself:
// it can PROPOSE an action (task, saving goal, loan / deposit / withdrawal request…) which the app shows as a card,
// and only the user's own tap runs it — with the user's own session.
// Secrets: ANTHROPIC_API_KEY (required), AI_MODEL (optional).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';
const MODEL = env('AI_MODEL') || 'claude-sonnet-5-5';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });

type Tool = { name: string; description: string; input_schema: any; run: (sb: any, i: any) => Promise<unknown> };
const obj = (props: Record<string, any> = {}, required: string[] = []) => ({ type: 'object', properties: props, required });
const D = { type: 'string', description: 'تاريخ YYYY-MM-DD' };
const data = async (p: any) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };

const PF_TOOL: Tool = { name: 'my_personal_finance', description: '«ماليتي» — المالية الشخصية الخاصة بالمستخدم نفسه لشهر معين: الدخل، المصروف، المصاريف حسب التصنيف مع الميزانيات، العمليات، المتكرر الشهري، الأهداف الادخارية، آخر 6 أشهر، والتزاماته للصندوق.', input_schema: obj({ month: { type: 'string', description: 'أي تاريخ داخل الشهر YYYY-MM-DD (افتراضي الشهر الحالي)' } }),
  run: (sb, i) => data(sb.rpc('pf_overview', { p_month: i.month ?? null })) };

const MEMBER_TOOLS: Tool[] = [
  { name: 'my_overview', description: 'ملخص حساب العضو: الاشتراكات، الودائع، القروض، المتأخرات، آخر العمليات، القرض الحالي.', input_schema: obj(),
    run: sb => data(sb.rpc('member_dashboard', { p_member: null })) },
  { name: 'my_net_and_loan_capacity', description: 'صافي رصيد العضو وأقصى مبلغ قرض يُعتمد تلقائياً، وفحص مبلغ معين.', input_schema: obj({ amount: { type: 'number' } }),
    run: (sb, i) => data(sb.rpc('loan_auto_check', { p_amount: String(i.amount ?? 0) })) },
  { name: 'my_loans', description: 'قروض العضو مع المتبقي والأقساط القادمة والمتأخرة.', input_schema: obj(),
    run: sb => data(sb.from('v_loan_summary').select('loan_no,status,approved_amount,total_repayable,amount_repaid,outstanding,next_due_date,next_due_amount,overdue_amount,installments_count,paid_count,purpose,disbursed_on').order('created_at', { ascending: false }).limit(20)) },
  { name: 'my_contributions', description: 'اشتراكات العضو الشهرية وحالتها (آخر 24 شهر).', input_schema: obj(),
    run: sb => data(sb.from('v_contribution_status').select('period,amount_due,amount_paid,amount_outstanding,status,is_overdue,due_date').order('period', { ascending: false }).limit(24)) },
  { name: 'my_transactions', description: 'آخر العمليات المالية على حساب العضو.', input_schema: obj({ limit: { type: 'number' } }),
    run: (sb, i) => data(sb.from('v_transactions').select('tx_no,tx_date,tx_type,amount,description,is_reversed').order('tx_date', { ascending: false }).limit(Math.min(100, i.limit ?? 40))) },
  { name: 'fund_investments', description: 'استثمارات الصندوق كما تُعرض للأعضاء (أسماء وأسعار وتغير يومي).', input_schema: obj(),
    run: sb => data(sb.rpc('member_investments')) },
  { name: 'my_calendar', description: 'مواعيد العضو: مهامه، مناسبات الصندوق، مواعيد الاشتراك والأقساط بين تاريخين.', input_schema: obj({ from: D, to: D }, ['from', 'to']),
    run: (sb, i) => data(sb.rpc('my_calendar', { p_from: i.from, p_to: i.to })) },
  PF_TOOL,
];

const MANAGER_TOOLS: Tool[] = [
  { name: 'fund_dashboard', description: 'لوحة المدير: صافي المركز، الأصول، الالتزامات، النقد، المتأخرات، الطلبات المعلقة.', input_schema: obj(),
    run: sb => data(sb.rpc('manager_dashboard')) },
  { name: 'liquidity', description: 'السيولة: النقد + الودائع البنكية، وودائع الأعضاء، والاحتياطي المطلوب لسياسة القروض.', input_schema: obj(),
    run: sb => data(sb.rpc('liquidity_report')) },
  { name: 'members_balances', description: 'أرصدة كل الأعضاء: اشتراكات، متأخرات، ودائع، قروض قائمة.', input_schema: obj(),
    run: async sb => (await data(sb.from('v_member_balances').select('member_no,full_name,status,contributions_total,contributions_overdue,contributions_overdue_months,deposit_balance,available_to_withdraw,loan_outstanding')))
      .map((m: any) => ({ ...m, net_position: Number(m.contributions_total) + Number(m.deposit_balance) - Number(m.loan_outstanding) })) },
  { name: 'loans', description: 'كل القروض مع حالتها والمتبقي والمتأخر.', input_schema: obj({ status: { type: 'string', description: 'اختياري: pending, approved, disbursed, active, overdue, fully_repaid' } }),
    run: (sb, i) => { let q = sb.from('v_loan_summary').select('loan_no,member_name,status,requested_amount,approved_amount,outstanding,overdue_amount,next_due_date,next_due_amount,purpose,request_date'); if (i.status) q = q.eq('status', i.status); return data(q.order('created_at', { ascending: false }).limit(100)); } },
  { name: 'loan_check', description: 'فحص القبول التلقائي لقرض بمبلغ معين لعضو معين (برقم العضوية).', input_schema: obj({ member_no: { type: 'string' }, amount: { type: 'number' } }, ['member_no', 'amount']),
    run: async (sb, i) => { const m = await data(sb.from('members').select('id').eq('member_no', i.member_no).maybeSingle()); if (!m) return { error: 'العضو غير موجود' }; return data(sb.rpc('loan_auto_check', { p_amount: String(i.amount), p_member: m.id })); } },
  { name: 'balance_sheet', description: 'قائمة المركز المالي في تاريخ.', input_schema: obj({ as_of: D }), run: (sb, i) => data(sb.rpc('report_balance_sheet', { p_as_of: i.as_of ?? today() })) },
  { name: 'income_statement', description: 'قائمة الدخل بين تاريخين.', input_schema: obj({ from: D, to: D }, ['from', 'to']), run: (sb, i) => data(sb.rpc('report_income_statement', { p_from: i.from, p_to: i.to })) },
  { name: 'cash_flow', description: 'التدفقات النقدية بين تاريخين.', input_schema: obj({ from: D, to: D }, ['from', 'to']), run: (sb, i) => data(sb.rpc('report_cash_flow', { p_from: i.from, p_to: i.to })) },
  { name: 'portfolio', description: 'محفظة الأسهم: الكميات، متوسط التكلفة، السعر الحالي، القيمة السوقية، الربح/الخسارة.', input_schema: obj(),
    run: sb => data(sb.from('v_portfolio_holdings').select('*')) },
  { name: 'investments', description: 'كل استثمارات الصندوق: التكلفة، القيمة الحالية، العوائد.', input_schema: obj(),
    run: sb => data(sb.from('v_investment_positions').select('name,category,provider,status,investment_date,cost_basis,current_value,unrealized_pl,realized_pl,income_received')) },
  { name: 'recent_transactions', description: 'آخر العمليات على مستوى الصندوق.', input_schema: obj({ limit: { type: 'number' } }),
    run: (sb, i) => data(sb.from('v_transactions').select('tx_no,tx_date,tx_type,amount,member_name,description,is_reversed').order('tx_date', { ascending: false }).limit(Math.min(150, i.limit ?? 50))) },
  PF_TOOL,
];

// ---------------------------------------------------------------- proposed actions (confirmed by the user in the app)
const ACTIONS_COMMON = ['task', 'goal', 'goal_save', 'pf_tx'];
const ACTIONS_MEMBER = [...ACTIONS_COMMON, 'loan_request', 'deposit_request', 'withdrawal_request', 'loan_reschedule'];
const actionTool = (kinds: string[]) => ({
  name: 'propose_action',
  description: `يجهّز إجراءً يظهر للمستخدم كبطاقة فيها زر «تأكيد» — لا يُنفّذ شيء إلا إذا ضغط المستخدم تأكيد. استخدمه عندما يطلب المستخدم صراحةً إضافة أو طلب شيء.
الأنواع وحقولها (params):
- task: {title, date (YYYY-MM-DD), time? (HH:MM), note?} — مهمة/تذكير في تقويمه
- goal: {title, target (رقم), date? (موعد الهدف)} — هدف ادخاري في «ماليتي»
- goal_save: {goal_title, amount} — إضافة مبلغ ادّخره لهدف موجود
- pf_tx: {kind: income|expense, amount, category? (اسم تصنيف من ماليتي), date?, note?} — تسجيل دخل/مصروف في ماليتي${kinds.includes('loan_request') ? `
- loan_request: {amount, purpose, mode: installments|lump, months? (عدد الأقساط), start? (لأقساط: أي تاريخ في شهر أول قسط؛ للدفعة الكاملة: تاريخها)} — طلب قرض من الصندوق
- deposit_request: {amount, method? (تحويل بنكي…), note?} — طلب إيداع في الصندوق
- withdrawal_request: {amount, reason?} — طلب سحب من ودائعه
- loan_reschedule: {loan_no, mode: installments|lump, start, count?, note?} — طلب إعادة جدولة قرض قائم (يحتاج موافقة المدير)` : ''}`,
  input_schema: obj({
    kind: { type: 'string', enum: kinds },
    summary: { type: 'string', description: 'سطر واحد يصف الإجراء للمستخدم' },
    params: { type: 'object' },
  }, ['kind', 'summary', 'params']),
});

function system(role: string, name: string, fund: string) {
  return `اسمك «نَجْد» (NAJD AI) — المستشار المالي في منصة ${fund}، وهو صندوق ادخاري عائلي سعودي (الاشتراك الشهري، ودائع اختيارية، قروض حسنة بدون فوائد، واستثمارات منخفضة إلى متوسطة المخاطر في السوق السعودية وودائع بنكية). عرّف بنفسك باسم «نَجْد — مستشارك المالي» إذا سُئلت عن هويتك.
تتحدث مع ${role === 'manager' ? `مدير الصندوق (${name})` : `العضو ${name}`}. اليوم ${today()} (توقيت الرياض). العملة ريال سعودي.

قواعد:
- أجب بالعربية بلهجة خليجية مهذبة وواضحة، باختصار ومباشرة، واستخدم الأرقام الفعلية من الأدوات — لا تخمّن رقماً؛ إذا احتجت بيانات استدعِ الأداة المناسبة.
- اعرض المبالغ بصيغة 12,345.67 ريال. اشرح الحسابات خطوة بخطوة عند الحاجة (أقساط، صافي الرصيد، نسب).
- لا تنفّذ أي عملية بنفسك. إذا طلب المستخدم إضافة مهمة أو هدف ادخاري أو تسجيل مصروف${role === 'manager' ? '' : ' أو تقديم طلب قرض/إيداع/سحب/إعادة جدولة'}، استدعِ propose_action بالحقول الصحيحة (تحقق من الأرقام بالأدوات أولاً، مثل قدرته على القرض)، ثم قل له باختصار إنك جهزت الطلب وإنه يضغط «تأكيد» تحته — لا تقل «تم». إذا نقصت معلومة أساسية (المبلغ أو التاريخ) اسأله أولاً.${role === 'manager' ? '\n- عمليات الصندوق نفسها (تسجيل اشتراك، صرف قرض، اعتماد…) تتم من صفحات المنصة — وضّح أين.' : '\n- طلبات القرض والإيداع والسحب وإعادة الجدولة تذهب لمدير الصندوق للموافقة. القسط يوم 28 من كل شهر، ومجموع أقساط العضو الشهرية لا يتجاوز 800 ريال (تزيد المدة تلقائياً).'}
- لا تقدم توصيات شراء/بيع لسهم بعينه كاستشارة استثمارية مرخصة؛ يمكنك التحليل والشرح (التركّز، المخاطر، الأداء) مع التنبيه بأن القرار للإدارة.
${role === 'manager' ? '- يمكنك صياغة رسائل تذكير للأعضاء بلطف، وتحليل السيولة قبل اعتماد القروض، وتلخيص الأداء.' : '- لا تكشف أي بيانات لأعضاء آخرين؛ الأدوات تعطيك بيانات هذا العضو فقط وأرقام الصندوق العامة.'}
- صافي رصيد العضو = اشتراكاته المدفوعة + رصيد ودائعه − قروضه القائمة. القرض يُعتمد تلقائياً إذا بقي الصافي موجباً بعد القرض وبقيت سيولة الصندوق فوق الاحتياطي؛ وإلا يراجعه المدير. الصرف دائماً يدوي من المدير.
- «ماليتي» (أداة my_personal_finance) هي المالية الشخصية الخاصة بالمستخدم نفسه فقط (دخله ومصاريفه وميزانيته وأهدافه) — ساعده يفهم أين يصرف، ويضع ميزانية واقعية، ويحسب كم يدخر شهرياً لأهدافه، واقترح الإيداع في الصندوق عند وجود فائض. لا تحكم عليه، وكن عملياً ولطيفاً.
- استخدم قوائم قصيرة أو جداول بسيطة عند الحاجة، وتجنب الإطالة.`;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'نَجْد غير مفعّل بعد — أضف ANTHROPIC_API_KEY في أسرار Edge Functions' }, 503);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null };
  if (!u?.user) return json({ error: 'سجّل الدخول أولاً' }, 401);
  const { data: au } = await admin.from('app_users').select('role, is_active, full_name').eq('id', u.user.id).maybeSingle();
  if (!au?.is_active) return json({ error: 'الحساب غير نشط' }, 403);
  const { data: st } = await admin.from('fund_settings').select('fund_name, ai_members_enabled').eq('id', 1).single();
  if (au.role !== 'manager' && !st?.ai_members_enabled) return json({ error: 'نَجْد | NAJD AI غير متاح للأعضاء حالياً' }, 403);

  const body = await req.json().catch(() => ({})) as { message?: string };
  const message = String(body.message ?? '').trim().slice(0, 2000);
  if (!message) return json({ error: 'اكتب سؤالك' }, 400);

  // per-user rate limit: 40 questions / day
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await admin.from('ai_messages').select('id', { count: 'exact', head: true }).eq('user_id', u.user.id).eq('role', 'user').gte('created_at', since);
  if ((count ?? 0) >= 40) return json({ error: 'وصلت للحد اليومي للأسئلة (40) — جرّب بكرة' }, 429);

  // caller-scoped client: RLS + RPC role checks apply to every tool
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const tools = au.role === 'manager' ? MANAGER_TOOLS : MEMBER_TOOLS;
  const kinds = au.role === 'manager' ? ACTIONS_COMMON : ACTIONS_MEMBER;
  const actions: { kind: string; summary: string; params: Record<string, unknown> }[] = [];

  const { data: hist } = await admin.from('ai_messages').select('role, content').eq('user_id', u.user.id).order('created_at', { ascending: false }).limit(16);
  const messages: any[] = (hist ?? []).reverse().map((m: any) => ({ role: m.role, content: m.content }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages.push({ role: 'user', content: message });

  let answer = '', tokens = 0;
  try {
    for (let step = 0; step < 6; step++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: system(au.role, au.full_name, st?.fund_name ?? 'الصندوق'),
          tools: [...tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })), actionTool(kinds)], messages }),
      });
      if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const res = await r.json();
      tokens += (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0);
      messages.push({ role: 'assistant', content: res.content });
      const calls = (res.content ?? []).filter((c: any) => c.type === 'tool_use');
      answer = (res.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
      if (res.stop_reason !== 'tool_use' || !calls.length) break;
      const results = [];
      for (const c of calls) {
        const t = tools.find(x => x.name === c.name);
        let out: unknown;
        if (c.name === 'propose_action') {
          const a = c.input ?? {};
          if (kinds.includes(a.kind) && actions.length < 5) {
            actions.push({ kind: a.kind, summary: String(a.summary ?? '').slice(0, 200), params: typeof a.params === 'object' && a.params ? a.params : {} });
            out = { ok: true, note: 'ظهرت للمستخدم بطاقة بزر «تأكيد» — لم يُنفّذ شيء بعد.' };
          } else out = { error: 'نوع إجراء غير متاح لهذا المستخدم' };
        } else {
          try { out = t ? await t.run(sb, c.input ?? {}) : { error: 'أداة غير معروفة' }; } catch (e) { out = { error: String((e as Error).message ?? e) }; }
        }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 60000) });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e).slice(0, 300) }, 502);
  }
  if (!answer) answer = 'ما قدرت أجهز إجابة الحين — جرّب تعيد صياغة السؤال.';
  const t0 = Date.now();
  await admin.from('ai_messages').insert([
    { user_id: u.user.id, role: 'user', content: message, created_at: new Date(t0).toISOString() },
    { user_id: u.user.id, role: 'assistant', content: answer, tokens, created_at: new Date(t0 + 5).toISOString() },
  ]);
  return json({ answer, actions });
});
