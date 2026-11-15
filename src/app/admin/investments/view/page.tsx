'use client';
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { rpc, newKey, supabase } from '@/lib/supabase';
import { q, useData, useParam } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, num, sar, today } from '@/lib/format';
import { categoryLabel, useSettings } from '@/lib/settings';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, isMoney, KV, Loading, Modal, MoneyInput, Notice, PageHeader, PL, Select, Stat, Tag, Textarea } from '@/components/ui';
import { DocumentList, DocumentUpload, ReverseModal } from '@/components/ops';
import { PortfolioCard } from '@/components/portfolio';

const kindLabels: Record<string, string> = { capital_in: 'ضخ رأس مال', income: 'عائد محقق', revaluation: 'إعادة تقييم', exit: 'تخارج' };
type Op = 'capital' | 'income' | 'revalue' | 'exit' | 'edit' | null;

export default function InvestmentDetail() {
  const id = useParam('id');
  const sb = supabase();
  const { data: s } = useSettings();
  const [op, setOp] = useState<Op>(null);
  const [rev, setRev] = useState<any>(null);
  const d = useData<any>(async () => {
    if (!id) return null;
    const [p, txs, docs] = await Promise.all([
      q(sb.from('v_investment_positions').select('*').eq('id', id).single()),
      q(sb.from('investment_transactions').select('*').eq('investment_id', id).order('tx_date').order('created_at')),
      q(sb.from('documents').select('*').eq('entity_type', 'investment').eq('entity_id', id).order('created_at', { ascending: false })),
    ]);
    const ids = (txs as any[]).map(t => t.financial_transaction_id);
    const fts = ids.length ? await q(sb.from('v_transactions').select('id, tx_no, is_reversed, amount, description, reference').in('id', ids)) : [];
    const fm = new Map((fts as any[]).map(t => [t.id, t]));
    return { p, txs: (txs as any[]).map(t => ({ ...t, ft: fm.get(t.financial_transaction_id) })), docs };
  }, [id]);
  if (d.error) return <ErrorBox>{d.error}</ErrorBox>;
  if (!id || !d.data) return <Loading />;
  const { p, txs, docs } = d.data!;
  const live = p.status !== 'exited';

  return (
    <>
      <PageHeader back={{ href: '/admin/investments/', label: 'الاستثمارات' }}
        title={<span className="flex items-center gap-3">{p.name} <Badge status={p.status} /></span>}
        subtitle={`${categoryLabel(s, p.category)}${p.provider ? ' · ' + p.provider : ''}`}
        actions={live && <>
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setOp('edit')}>تعديل البيانات</Button>
          <Button variant="secondary" onClick={() => setOp('revalue')}>إعادة تقييم</Button>
          <Button variant="secondary" onClick={() => setOp('income')}>تسجيل عائد</Button>
          <Button variant="secondary" onClick={() => setOp('capital')}>ضخ رأس مال</Button>
          <Button onClick={() => setOp('exit')}>تخارج</Button>
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat emphasize label="القيمة الحالية" value={sar(p.current_value)} hint={p.last_valuation_date ? `آخر تقييم ${date(p.last_valuation_date)}` : 'بالتكلفة'} />
        <Stat label="التكلفة (رأس المال القائم)" value={sar(p.cost_basis)} hint={`إجمالي المستثمر ${sar(p.total_invested)}`} />
        <Stat label="ربح/خسارة غير محققة" value={sar(p.unrealized_pl, { sign: true })} tone={num(p.unrealized_pl) >= 0 ? 'pos' : 'neg'} hint="لا تدخل في النقد أو الدخل" />
        <Stat label="ربح/خسارة محققة" value={sar(p.realized_pl, { sign: true })} tone={num(p.realized_pl) >= 0 ? 'pos' : 'neg'} hint={`منها عوائد ${sar(p.income_received)}`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="بيانات الاستثمار" className="lg:col-span-2">
          <KV items={[['تاريخ الاستثمار', date(p.investment_date)], ['تاريخ الاستحقاق', date(p.maturity_date)], ['المبالغ المستردة', sar(p.total_returned)],
            ['الوصف', p.description], ['ملاحظات', p.notes]]} />
        </Card>
        <Card title="المستندات الداعمة">
          <DocumentList docs={docs} />
          <div className="mt-3"><DocumentUpload entityType="investment" entityId={p.id} onDone={d.reload} /></div>
        </Card>
      </div>
      {p.category === 'equity' && live && <PortfolioCard p={p} onBooked={d.reload} />}
      <Card className="mt-4" title="سجل عمليات الاستثمار" pad={false}>
        <DataTable rows={[...txs].reverse()} columns={[
          { key: 'tx_date', header: 'التاريخ', render: r => date(r.tx_date) },
          { key: 'kind', header: 'العملية', render: r => <span className="flex gap-1.5">{kindLabels[r.kind]}{r.ft?.is_reversed && <Tag tone="red">معكوسة</Tag>}</span> },
          { key: 'cash_amount', header: 'حركة النقد', align: 'end', render: r => num(r.cash_amount) ? <span className={r.kind === 'capital_in' ? 'text-neg' : 'text-pos'}>{r.kind === 'capital_in' ? '−' : '+'}{sar(r.cash_amount)}</span> : '—' },
          { key: 'unrealized_delta', header: 'تغير غير محقق', align: 'end', render: r => <PL v={r.unrealized_delta} /> },
          { key: 'realized_pl', header: 'محقق', align: 'end', render: r => <PL v={r.realized_pl} /> },
          { key: 'valuation_after', header: 'التقييم', align: 'end', render: r => r.valuation_after ? sar(r.valuation_after) : '—' },
          { key: 'note', header: 'ملاحظة', className: 'max-w-[200px] truncate' },
          { key: 'act', header: '', render: r => r.ft && !r.ft.is_reversed && <button className="text-xs text-neg hover:underline" onClick={() => setRev({ ...r.ft })}>عكس</button> },
        ]} />
      </Card>
      <InvestmentOp op={op} p={p} onClose={() => setOp(null)} onDone={d.reload} />
      <ReverseModal tx={rev} onClose={() => setRev(null)} onDone={d.reload} />
    </>
  );
}

function InvestmentOp({ op, p, onClose, onDone }: { op: Op; p: any; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const [key] = useState(newKey);
  const [f, setF] = useState({ amount: '', date: today(), note: '', ref: '', cost: '', full: true });
  const [e, setE] = useState({ name: p.name, description: p.description ?? '', provider: p.provider ?? '', maturity: p.maturity_date ?? '', notes: p.notes ?? '', status: p.status });
  const titles: Record<string, string> = { capital: 'ضخ رأس مال إضافي', income: 'تسجيل عائد محقق (نقدي)', revalue: 'إعادة تقييم (غير محقق)', exit: 'تخارج من الاستثمار', edit: 'تعديل بيانات الاستثمار' };
  const submit = async () => {
    const call = op === 'capital' ? rpc('add_investment_capital', { p_inv: p.id, p_amount: f.amount, p_date: f.date, p_note: f.note || null, p_reference: f.ref || null, p_key: key })
      : op === 'income' ? rpc('record_investment_income', { p_inv: p.id, p_amount: f.amount, p_date: f.date, p_note: f.note || null, p_reference: f.ref || null, p_key: key })
      : op === 'revalue' ? rpc('revalue_investment', { p_inv: p.id, p_valuation: f.amount, p_date: f.date, p_note: f.note || null })
      : op === 'exit' ? rpc('exit_investment', { p_inv: p.id, p_proceeds: f.amount || '0', p_date: f.date, p_cost_portion: f.full ? null : f.cost, p_note: f.note || null, p_reference: f.ref || null, p_key: key })
      : rpc('update_investment', { p_inv: p.id, p_name: e.name, p_description: e.description, p_provider: e.provider, p_maturity: e.maturity || null, p_notes: e.notes, p_status: e.status }).then(() => true);
    const r = await a.run(() => call, 'تم الحفظ');
    if (r) { setF({ ...f, amount: '', note: '', ref: '', cost: '' }); onDone(); onClose(); }
  };
  if (!op) return null;
  const valid = op === 'edit' ? e.name.trim().length > 1 : op === 'exit' ? /^\d+(\.\d{1,2})?$/.test(f.amount || '0') && (f.full || isMoney(f.cost)) : op === 'revalue' ? /^\d+(\.\d{1,2})?$/.test(f.amount) : isMoney(f.amount);
  return (
    <Modal open onClose={onClose} title={titles[op]}
      footer={<><Button onClick={submit} loading={a.busy} disabled={!valid}>حفظ</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      {op === 'edit' ? <>
        <Field label="الاسم"><Input value={e.name} onChange={x => setE({ ...e, name: x.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الجهة"><Input value={e.provider} onChange={x => setE({ ...e, provider: x.target.value })} /></Field>
          <Field label="الاستحقاق"><Input type="date" value={e.maturity} onChange={x => setE({ ...e, maturity: x.target.value })} /></Field>
          <Field label="الحالة"><Select value={e.status} onChange={x => setE({ ...e, status: x.target.value })} options={[{ value: 'active', label: 'نشط' }, { value: 'matured', label: 'مستحق' }]} /></Field>
        </div>
        <Field label="الوصف"><Textarea value={e.description} onChange={x => setE({ ...e, description: x.target.value })} /></Field>
        <Field label="ملاحظات"><Textarea value={e.notes} onChange={x => setE({ ...e, notes: x.target.value })} /></Field>
      </> : <>
        {op === 'revalue' && <Notice>التقييم الجديد يغير القيمة الدفترية فقط عبر احتياطي «غير محقق» ضمن حقوق الملكية — لا يؤثر على النقد أو الدخل. التكلفة الحالية {sar(p.cost_basis)}.</Notice>}
        {op === 'income' && <Notice>العائد النقدي المستلم (أرباح، توزيعات، عوائد ودائع) يُسجل دخلاً محققاً ويُضاف للنقد.</Notice>}
        {op === 'exit' && <Notice>الربح/الخسارة المحققة = المتحصلات − التكلفة المتخارج منها. يُحرر الاحتياطي غير المحقق المقابل تلقائياً.</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={op === 'revalue' ? 'القيمة السوقية الجديدة' : op === 'exit' ? 'المتحصلات النقدية' : 'المبلغ'}><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
          <Field label="التاريخ"><Input type="date" max={today()} value={f.date} onChange={x => setF({ ...f, date: x.target.value })} /></Field>
          {op === 'exit' && <Field label="نوع التخارج"><Select value={f.full ? 'full' : 'partial'} onChange={x => setF({ ...f, full: x.target.value === 'full' })} options={[{ value: 'full', label: 'كامل' }, { value: 'partial', label: 'جزئي' }]} /></Field>}
          {op === 'exit' && !f.full && <Field label="التكلفة المتخارج منها" hint={`من أصل ${sar(p.cost_basis)}`}><MoneyInput value={f.cost} onChange={v => setF({ ...f, cost: v })} /></Field>}
          {op !== 'revalue' && <Field label="المرجع"><Input value={f.ref} onChange={x => setF({ ...f, ref: x.target.value })} /></Field>}
        </div>
        <Field label="ملاحظة"><Textarea value={f.note} onChange={x => setF({ ...f, note: x.target.value })} /></Field>
      </>}
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
