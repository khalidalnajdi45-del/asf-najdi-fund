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
import clsx from 'clsx';
import { Building2, CalendarClock, Landmark, LineChart, PiggyBank } from 'lucide-react';
import { Band, BandStat, SegBar } from '@/components/admin-viz';

const CAT_COLOR: Record<string, string> = { bank_deposit: '#2f6f7a', equity: '#B8925A', fund: '#7a4f8c', sukuk: '#3f8a6e', real_estate: '#a8654a', other: '#8e6c8a' };
const CAT_ICON: Record<string, React.ReactNode> = { bank_deposit: <Landmark className="size-4" />, equity: <LineChart className="size-4" />, fund: <PiggyBank className="size-4" />, real_estate: <Building2 className="size-4" /> };
const catColor = (k: string) => CAT_COLOR[k] ?? '#8e6c8a';

export default function InvestmentsPage() {
  const [tab, setTab] = useState('active');
  const [open, setOpen] = useState(false);
  const { data: s } = useSettings();
  const d = useData<any[]>(() => q(supabase().from('v_investment_positions').select('*').order('investment_date', { ascending: false })));
  const rows = d.data ?? [];
  const active = rows.filter(r => r.status !== 'exited');
  const sum = (xs: any[], k: string) => xs.reduce((a, r) => a + num(r[k]), 0);
  const list = tab === 'active' ? active : rows.filter(r => r.status === 'exited');
  const value = sum(active, 'current_value'), cost = sum(active, 'cost_basis'), upl = sum(active, 'unrealized_pl');
  const byCat = Object.entries(active.reduce((m: Record<string, number>, r) => ({ ...m, [r.category]: (m[r.category] ?? 0) + num(r.current_value) }), {}));
  const t0 = today();
  const maturing = active.filter(r => r.maturity_date && r.maturity_date >= t0).sort((a, b) => a.maturity_date.localeCompare(b.maturity_date)).slice(0, 4);
  const daysTo = (d: string) => Math.max(0, Math.round((Date.parse(d) - Date.parse(t0)) / 86400000));

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
      <Band>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="col-span-2 sm:col-span-3"><BandStat big label="قيمة المحفظة اليوم" value={sar(value)} tone="gold" sub={`${active.length} استثمار قائم`} /></div>
              <BandStat label="غير محقق" value={sar(upl, { sign: true })} tone={upl >= 0 ? 'pos' : 'neg'} sub={cost ? `${upl >= 0 ? '+' : ''}${((upl / cost) * 100).toFixed(1)}% على التكلفة` : undefined} />
              <BandStat label="محقق منذ البداية" value={sar(sum(rows, 'realized_pl'), { sign: true })} tone={sum(rows, 'realized_pl') >= 0 ? 'pos' : 'neg'} sub="عوائد + تخارجات" />
            </div>
            {byCat.length > 0 && <div><div className="mb-2 text-xs text-brand-200">توزيع الأصول</div>
              <SegBar dark height={14} parts={byCat.map(([k, v]) => ({ label: categoryLabel(s, k), value: Number(v), color: catColor(k) === '#2f6f7a' ? '#6fb3bb' : catColor(k) === '#4A2A5A' ? '#9c7bb0' : catColor(k) }))} /></div>}
          </div>
          <div className="lg:border-s lg:border-white/10 lg:ps-6">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-brand-200"><CalendarClock className="size-3.5" />الاستحقاقات القادمة</div>
            {maturing.length === 0 ? <div className="text-sm text-brand-200">لا توجد استحقاقات قادمة</div> :
              <ol className="relative space-y-3 border-s border-white/15 ps-4">
                {maturing.map(r => <li key={r.id} className="relative">
                  <span className="absolute -start-[21px] top-1.5 size-2.5 rounded-full bg-gold-300 ring-4 ring-brand-900" />
                  <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate">{r.name}</span><span className="shrink-0 font-semibold num-cell">{sar(r.current_value)}</span></div>
                  <div className="text-[11px] text-brand-200">{date(r.maturity_date)} · بعد <span className="num">{daysTo(r.maturity_date)}</span> يوم</div>
                </li>)}
              </ol>}
          </div>
        </div>
      </Band>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'active', label: 'القائمة', count: active.length }, { key: 'exited', label: 'منتهية / متخارج منها' }]} />
      {tab === 'active' ? (active.length === 0 ? <Card><p className="py-8 text-center text-sm text-muted">{d.loading ? 'جاري التحميل…' : 'لا توجد استثمارات قائمة'}</p></Card> :
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {active.map(r => {
            const c = num(r.cost_basis), v = num(r.current_value), plp = c ? ((v - c) / c) * 100 : 0, col = catColor(r.category);
            const span = r.maturity_date ? Date.parse(r.maturity_date) - Date.parse(r.investment_date) : 0;
            const elapsed = span > 0 ? Math.min(100, Math.max(0, ((Date.parse(t0) - Date.parse(r.investment_date)) / span) * 100)) : null;
            return (
              <button key={r.id} onClick={() => go(`/admin/investments/view/?id=${r.id}`)} className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface text-start transition hover:border-gold-500 hover:shadow-md">
                <div className="flex items-center gap-2.5 px-4 py-3 text-white" style={{ background: `linear-gradient(120deg, ${col}, ${col}cc)` }}>
                  <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">{CAT_ICON[r.category] ?? <PiggyBank className="size-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.name}</span><span className="block truncate text-[11px] text-white/75">{categoryLabel(s, r.category)}{r.provider ? ` · ${r.provider}` : ''}</span></span>
                </div>
                <div className="w-full space-y-3 p-4">
                  <div className="flex items-end justify-between gap-2">
                    <div><div className="text-[11px] text-muted">القيمة الحالية</div><div className="font-display text-2xl font-semibold num-cell">{sar(v)}</div></div>
                    <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold num', plp >= 0 ? 'bg-[#eaf3ec] text-pos' : 'bg-clay/10 text-neg')}>{plp >= 0 ? '▲' : '▼'} {Math.abs(plp).toFixed(1)}%</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-canvas p-2.5 text-center text-[11px]">
                    <div><div className="text-muted">التكلفة</div><div className="font-medium num-cell">{sar(c)}</div></div>
                    <div><div className="text-muted">عوائد مستلمة</div><div className="font-medium num-cell">{sar(r.income_received ?? 0)}</div></div>
                    <div><div className="text-muted">منذ</div><div className="font-medium num-cell">{date(r.investment_date)}</div></div>
                  </div>
                  {elapsed !== null && <div>
                    <div className="mb-1 flex justify-between text-[11px] text-muted"><span>المدة حتى الاستحقاق</span><span className="num-cell">{date(r.maturity_date)}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full" style={{ width: `${elapsed}%`, background: col }} /></div>
                  </div>}
                </div>
              </button>);
          })}
        </div>) : <Card pad={false}>
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
      </Card>}
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
