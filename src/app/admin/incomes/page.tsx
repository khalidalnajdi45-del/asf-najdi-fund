'use client';
import { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { rpc, newKey, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, sar, today } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { useSettings } from '@/lib/settings';
import { Button, Card, DataTable, ErrorBox, Field, Input, isMoney, Modal, MoneyInput, PageHeader, Select, Stat, Tag } from '@/components/ui';
import { DocumentUpload, ReverseModal } from '@/components/ops';
import { YearBand } from '@/components/admin-viz';

export default function IncomesPage() {
  const sb = supabase();
  const [open, setOpen] = useState(false);
  const [rev, setRev] = useState<any>(null);
  const [attach, setAttach] = useState<any>(null);
  const [year, setYear] = useState(today().slice(0, 4));
  const d = useData<any[]>(async () => {
    const [ex, tx, docs] = await Promise.all([
      q(sb.from('incomes').select('*').gte('income_date', `${year}-01-01`).lte('income_date', `${year}-12-31`).order('income_date', { ascending: false })),
      q(sb.from('v_transactions').select('id, tx_no, is_reversed, description, amount').eq('tx_type', 'other_income')),
      q(sb.from('documents').select('entity_id').eq('entity_type', 'income')),
    ]);
    const tm = new Map((tx as any[]).map(t => [t.id, t]));
    const dc = new Set((docs as any[]).map(x => x.entity_id));
    return (ex as any[]).map(e => ({ ...e, ft: tm.get(e.financial_transaction_id), has_doc: dc.has(e.id) }));
  }, [year]);
  const rows = d.data ?? [];
  const live = rows.filter(r => !r.ft?.is_reversed);
  const total = live.reduce((s, r) => s + Number(r.amount), 0);
  const byCat = Object.entries(live.reduce((m: Record<string, number>, r) => ({ ...m, [r.category]: (m[r.category] ?? 0) + Number(r.amount) }), {}));

  const exportList = () => exportXlsx(`الإيرادات-${year}`, [{
    name: year, header: ['التاريخ', 'الفئة', 'البيان', 'الدافع / المصدر', 'المبلغ', 'المرجع', 'رقم العملية', 'معكوس'],
    rows: rows.map(r => [r.income_date, r.category, r.description, r.payer, n2(r.amount), r.reference, r.ft?.tx_no, r.ft?.is_reversed ? 'نعم' : '']),
  }]);

  return (
    <>
      <PageHeader title="الإيرادات الأخرى" subtitle="كل إيراد يُضاف للنقد بقيد محاسبي (حساب 4900 إيرادات أخرى) ويمكن إرفاق مستند داعم"
        actions={<>
          <Input type="number" dir="ltr" value={year} onChange={e => setYear(e.target.value)} className="w-28" />
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportList}>Excel</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>إيراد جديد</Button>
        </>} />
      <YearBand label="إيرادات" year={year} total={total} count={live.length} color="#9fd3b4"
        rows={live.map(r => ({ date: r.income_date, amount: Number(r.amount), category: r.category }))} />
      <Card pad={false}>
        <DataTable rows={rows} loading={d.loading} searchable={r => `${r.description} ${r.payer ?? ''} ${r.category}`} columns={[
          { key: 'income_date', header: 'التاريخ', render: r => date(r.income_date) },
          { key: 'category', header: 'الفئة' },
          { key: 'description', header: 'البيان', render: r => <span className="flex gap-1.5">{r.description}{r.ft?.is_reversed && <Tag tone="red">معكوس</Tag>}</span> },
          { key: 'payer', header: 'الدافع / المصدر' },
          { key: 'reference', header: 'المرجع', render: r => r.reference ? <span className="num text-xs">{r.reference}</span> : '—' },
          { key: 'amount', header: 'المبلغ', align: 'end', render: r => sar(r.amount) },
          { key: 'doc', header: 'مستند', render: r => r.has_doc ? <Tag tone="green">مرفق</Tag> : <button className="text-xs text-brand-600 hover:underline" onClick={() => setAttach(r)}>إرفاق</button> },
          { key: 'act', header: '', render: r => r.ft && !r.ft.is_reversed && <button className="text-xs text-neg hover:underline" onClick={() => setRev(r.ft)}>عكس</button> },
        ]} />
      </Card>
      <NewIncome open={open} onClose={() => setOpen(false)} onDone={d.reload} />
      <ReverseModal tx={rev} onClose={() => setRev(null)} onDone={d.reload} />
      <Modal open={!!attach} onClose={() => setAttach(null)} title="إرفاق مستند للإيراد">
        {attach && <DocumentUpload entityType="income" entityId={attach.id} onDone={() => { setAttach(null); d.reload(); }} />}
      </Modal>
    </>
  );
}

function NewIncome({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const { data: s } = useSettings();
  const [key, setKey] = useState(newKey);
  const blank = { category: '', description: '', payer: '', amount: '', date: today(), ref: '' };
  const [f, setF] = useState(blank);
  const submit = async () => {
    const r = await a.run(() => rpc('record_income', { p_category: f.category, p_description: f.description, p_payer: f.payer || null, p_amount: f.amount, p_date: f.date, p_reference: f.ref || null, p_key: key }), 'تم تسجيل الإيراد');
    if (r) { setF(blank); setKey(newKey()); onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="تسجيل إيراد"
      footer={<><Button onClick={submit} loading={a.busy} disabled={!f.category || f.description.trim().length < 2 || !isMoney(f.amount)}>تسجيل</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="الفئة"><Select value={f.category} onChange={e => setF({ ...f, category: e.target.value })} placeholder="اختر…" options={(s?.income_categories ?? []).map(c => ({ value: c, label: c }))} /></Field>
        <Field label="المبلغ"><MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
        <Field label="البيان" className="col-span-2"><Input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="المستفيد"><Input value={f.payer} onChange={e => setF({ ...f, payer: e.target.value })} /></Field>
        <Field label="التاريخ"><Input type="date" max={today()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="المرجع / رقم الإيصال" className="col-span-2"><Input value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
      </div>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
