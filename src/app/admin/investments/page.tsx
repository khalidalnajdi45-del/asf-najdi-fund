'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { rpc, newKey, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, num, sar, today } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { categoryLabel, useSettings } from '@/lib/settings';
import { statusLabels } from '@/lib/labels';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, isMoney, Modal, MoneyInput, Notice, PageHeader, PL, Select, Stat, Tabs, Textarea } from '@/components/ui';
import { PerformanceBars, ShareBars } from '@/components/charts';

export default function InvestmentsPage() {
  const [tab, setTab] = useState('active');
  const [open, setOpen] = useState(false);
  const { data: s } = useSettings();
  const d = useData<any[]>(() => q(supabase().from('v_investment_positions').select('*').order('investment_date', { ascending: false })));
  const rows = d.data ?? [];
  const active = rows.filter(r => r.status !== 'exited');
  const sum = (xs: any[], k: string) => xs.reduce((a, r) => a + num(r[k]), 0);
  const list = tab === 'active' ? active : rows.filter(r => r.status === 'exited');

  const exportList = () => exportXlsx('أداء-الاستثمارات', [{
    name: 'الاستثمارات', header: ['الاستثمار', 'الفئة', 'الجهة', 'تاريخ الاستثمار', 'الاستحقاق', 'رأس المال المستثمر', 'التكلفة الحالية', 'القيمة الحالية', 'غير محقق', 'محقق', 'الحالة'],
    rows: rows.map(r => [r.name, categoryLabel(s, r.category), r.provider, r.investment_date, r.maturity_date, n2(r.total_invested), n2(r.cost_basis), n2(r.current_value), n2(r.unrealized_pl), n2(r.realized_pl), statusLabels[r.status]?.[0]]),
  }]);

  return (
    <>
      <PageHeader title="الاستثمارات" subtitle="محفظة الصندوق — الأرباح غير المحققة لا تُعامل كنقد أو دخل"
        actions={<>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportList}>Excel</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>استثمار جديد</Button>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat emphasize label="القيمة الحالية للمحفظة" value={sar(sum(active, 'current_value'))} hint={`${active.length} استثمار قائم`} />
        <Stat label="رأس المال (التكلفة)" value={sar(sum(active, 'cost_basis'))} />
        <Stat label="أرباح/خسائر غير محققة" value={sar(sum(active, 'unrealized_pl'), { sign: true })} tone={sum(active, 'unrealized_pl') >= 0 ? 'pos' : 'neg'} />
        <Stat label="أرباح محققة (منذ البداية)" value={sar(sum(rows, 'realized_pl'), { sign: true })} tone={sum(rows, 'realized_pl') >= 0 ? 'pos' : 'neg'} hint="عوائد + أرباح/خسائر تخارج" />
      </div>
      {active.length > 0 && <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="التكلفة مقابل القيمة الحالية" className="lg:col-span-2">
          <PerformanceBars data={active.map(r => ({ name: r.name, cost: num(r.cost_basis), value: num(r.current_value) }))} />
        </Card>
        <Card title="التوزيع حسب الفئة">
          <ShareBars items={Object.entries(active.reduce((m: Record<string, number>, r) => ({ ...m, [r.category]: (m[r.category] ?? 0) + num(r.current_value) }), {}))
            .map(([k, v]) => ({ label: categoryLabel(s, k), value: v }))} />
        </Card>
      </div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'active', label: 'القائمة', count: active.length }, { key: 'exited', label: 'منتهية / متخارج منها' }]} />
      <Card pad={false}>
        <DataTable rows={list} loading={d.loading} onRowClick={r => (go(`/admin/investments/view/?id=${r.id}`))} empty="لا توجد استثمارات"
          columns={[
            { key: 'name', header: 'الاستثمار', render: r => <span className="font-medium">{r.name}</span> },
            { key: 'category', header: 'الفئة', render: r => categoryLabel(s, r.category) },
            { key: 'provider', header: 'الجهة' },
            { key: 'investment_date', header: 'التاريخ', render: r => date(r.investment_date) },
            { key: 'maturity_date', header: 'الاستحقاق', render: r => date(r.maturity_date) },
            { key: 'cost_basis', header: 'التكلفة', align: 'end', render: r => sar(r.cost_basis) },
            { key: 'current_value', header: 'القيمة الحالية', align: 'end', render: r => sar(r.current_value) },
            { key: 'unrealized_pl', header: 'غير محقق', align: 'end', render: r => <PL v={r.unrealized_pl} /> },
            { key: 'realized_pl', header: 'محقق', align: 'end', render: r => <PL v={r.realized_pl} /> },
            { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
          ]} />
      </Card>
      <NewInvestment open={open} onClose={() => setOpen(false)} onDone={d.reload} />
    </>
  );
}

function NewInvestment({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const { data: s } = useSettings();
  const [key, setKey] = useState(newKey);
  const blank = { name: '', category: '', description: '', provider: '', date: today(), maturity: '', capital: '', notes: '', ref: '' };
  const [f, setF] = useState(blank);
  const submit = async () => {
    const id = await a.run(() => rpc<string>('create_investment', {
      p_name: f.name, p_category: f.category, p_description: f.description || null, p_provider: f.provider || null, p_date: f.date,
      p_maturity: f.maturity || null, p_capital: f.capital, p_notes: f.notes || null, p_reference: f.ref || null, p_key: key,
    }), 'تم تسجيل الاستثمار');
    if (id) { setF(blank); setKey(newKey()); onDone(); onClose(); go(`/admin/investments/view/?id=${id}`); }
  };
  return (
    <Modal wide open={open} onClose={onClose} title="تسجيل استثمار جديد"
      footer={<><Button onClick={submit} loading={a.busy} disabled={f.name.trim().length < 2 || !f.category || !isMoney(f.capital)}>تسجيل</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <Notice>سيُخصم رأس المال من النقد ويُسجل كأصل استثماري بالتكلفة (مدين الاستثمارات / دائن النقد).</Notice>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="اسم الاستثمار"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="الفئة"><Select value={f.category} onChange={e => setF({ ...f, category: e.target.value })} placeholder="اختر…" options={(s?.investment_categories ?? []).map(c => ({ value: c.key, label: c.label }))} /></Field>
        <Field label="الجهة / المؤسسة"><Input value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })} /></Field>
        <Field label="رأس المال الأولي"><MoneyInput value={f.capital} onChange={v => setF({ ...f, capital: v })} /></Field>
        <Field label="تاريخ الاستثمار"><Input type="date" max={today()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="تاريخ الاستحقاق المتوقع"><Input type="date" value={f.maturity} onChange={e => setF({ ...f, maturity: e.target.value })} /></Field>
        <Field label="المرجع"><Input value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
      </div>
      <Field label="الوصف"><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="ملاحظات"><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
