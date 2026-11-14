'use client';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { monthLabel, num, pct, plain, sar } from '@/lib/format';

const C = { brand: '#4a2a5a', brandSoft: '#d6bc8c', clay: '#a8654a', gold: '#b8925a', grid: '#ece4d6', axis: '#736a74' };
const shortMonth = (v: string) => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { month: 'short' }).format(new Date(`${v.slice(0, 7)}-01T12:00:00`));

function Tip({ active, payload, label, money = true, isPct }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div dir="rtl" className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{monthLabel(label)}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{p.name}:</span>
          <span className="num font-medium">{isPct ? pct(p.value) : money ? sar(p.value) : plain(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** RTL time axis: newest on the left, like reading direction. */
export function CashFlowChart({ data }: { data: { month: string; inflow: any; outflow: any }[] }) {
  const rows = data.map(d => ({ month: d.month, inflow: num(d.inflow), outflow: num(d.outflow) }));
  return (
    <div dir="ltr" className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="month" reversed tickFormatter={shortMonth} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} />
          <YAxis orientation="right" tickFormatter={v => plain(v)} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<Tip />} cursor={{ fill: '#f3ece0' }} />
          <Legend formatter={(v) => <span className="text-xs text-ink-2">{v}</span>} iconType="circle" iconSize={8} />
          <Bar dataKey="inflow" name="تدفقات داخلة" fill={C.brand} radius={[3, 3, 0, 0]} maxBarSize={22} />
          <Bar dataKey="outflow" name="تدفقات خارجة" fill={C.clay} radius={[3, 3, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RateChart({ data }: { data: { period: string; rate: any }[] }) {
  const rows = data.map(d => ({ period: d.period, rate: num(d.rate) }));
  return (
    <div dir="ltr" className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="period" reversed tickFormatter={shortMonth} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} />
          <YAxis orientation="right" domain={[0, 1]} tickFormatter={v => pct(v, 0)} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<Tip isPct />} />
          <Line type="monotone" dataKey="rate" name="نسبة التحصيل" stroke={C.brand} strokeWidth={2} dot={{ r: 3, fill: C.brand }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ContributionBars({ data }: { data: { period: string; due: any; paid: any }[] }) {
  const rows = data.map(d => ({ period: d.period, due: num(d.due), paid: num(d.paid) }));
  return (
    <div dir="ltr" className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="period" reversed tickFormatter={shortMonth} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} />
          <YAxis orientation="right" tickFormatter={v => plain(v)} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<Tip />} cursor={{ fill: '#f3ece0' }} />
          <Bar dataKey="due" name="المستحق" fill={C.brandSoft} radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="paid" name="المسدد" fill={C.brand} radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal share bars (no pie charts — easier to compare). */
export function ShareBars({ items }: { items: { label: string; value: any }[] }) {
  const total = items.reduce((a, i) => a + num(i.value), 0) || 1;
  const sorted = [...items].sort((a, b) => num(b.value) - num(a.value));
  return (
    <div className="space-y-3">
      {sorted.map(i => (
        <div key={i.label}>
          <div className="mb-1 flex justify-between text-[13px]"><span className="text-ink-2">{i.label}</span><span className="num font-medium">{sar(i.value)}</span></div>
          <div className="h-2 rounded-full bg-line"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${(num(i.value) / total) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export function PerformanceBars({ data }: { data: { name: string; cost: number; value: number }[] }) {
  return (
    <div dir="ltr" className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barGap={2}>
          <CartesianGrid horizontal={false} stroke={C.grid} />
          <XAxis type="number" reversed tickFormatter={v => plain(v)} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" orientation="right" width={130} tick={{ fontSize: 11, fill: '#3d4a46' }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v: any) => sar(v)} labelStyle={{ direction: 'rtl' }} />
          <Legend formatter={(v) => <span className="text-xs text-ink-2">{v}</span>} iconType="circle" iconSize={8} />
          <Bar dataKey="cost" name="التكلفة" fill={C.brandSoft} radius={[0, 3, 3, 0]} maxBarSize={14} />
          <Bar dataKey="value" name="القيمة الحالية" fill={C.brand} radius={[0, 3, 3, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
