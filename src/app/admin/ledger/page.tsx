'use client';
import { Fragment, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { rpc, newKey, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, sar, today } from '@/lib/format';
import { accountTypeLabels, txTypeLabels } from '@/lib/labels';
import { exportXlsx, n2 } from '@/lib/export';
import { Button, Card, DataTable, ErrorBox, Field, Input, Modal, MoneyInput, Notice, PageHeader, Select, Tabs, Tag } from '@/components/ui';
import { ReverseModal } from '@/components/ops';
import { TransactionsTable } from '@/components/member-views';

const LOCKED = new Set(['2000', '1100', '1200', '1210', '3000', '2300', '3200']);

export default function LedgerPage() {
  const [tab, setTab] = useState('journal');
  const [rev, setRev] = useState<any>(null);
  const [manual, setManual] = useState(false);
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const sb = supabase();
  const journal = useData<any[]>(() => q(sb.from('v_journal').select('*').gte('entry_date', from).lte('entry_date', to)
    .order('entry_no', { ascending: false }).order('line_id').limit(3000)), [from, to]);
  const balances = useData<any[]>(() => q(sb.from('v_account_balances').select('*').order('code')));
  const txs = useData<any[]>(() => q(sb.from('v_transactions').select('*').gte('tx_date', from).lte('tx_date', to).order('tx_date', { ascending: false }).order('tx_no', { ascending: false }).limit(2000)), [from, to]);
  const integrity = useData<any>(() => rpc('integrity_check'));
  const reload = () => { journal.reload(); balances.reload(); txs.reload(); integrity.reload(); };

  const entries = groupEntries(journal.data ?? []);
  const totD = (balances.data ?? []).reduce((s, a) => s + Number(a.total_debit), 0);
  const totC = (balances.data ?? []).reduce((s, a) => s + Number(a.total_credit), 0);

  const exportJournal = () => exportXlsx(`دفتر-اليومية-${from}-${to}`, [{
    name: 'اليومية', header: ['رقم القيد', 'التاريخ', 'رقم العملية', 'البيان', 'الحساب', 'اسم الحساب', 'العضو', 'مدين', 'دائن'],
    rows: (journal.data ?? []).map(l => [l.entry_no, l.entry_date, l.tx_no, l.description, l.account_code, l.account_name, l.member_name, n2(l.debit), n2(l.credit)]),
  }, {
    name: 'أرصدة الحسابات', header: ['الرمز', 'الحساب', 'النوع', 'إجمالي المدين', 'إجمالي الدائن', 'الرصيد'],
    rows: (balances.data ?? []).map(a => [a.code, a.name_ar, accountTypeLabels[a.type], n2(a.total_debit), n2(a.total_credit), n2(a.balance)]),
  }]);

  return (
    <>
      <PageHeader title="دفتر الأستاذ العام" subtitle="قيد مزدوج — كل عملية مالية لها قيد متوازن، ولا يُعدّل أو يُحذف أي قيد معتمد"
        actions={<>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportJournal}>Excel</Button>
          <Button icon={<Plus className="size-4" />} onClick={() => setManual(true)}>قيد يدوي / تصحيحي</Button>
        </>} />
      {integrity.data && (
        <div className="mb-4 flex flex-wrap gap-2">
          {integrity.data.checks.map((c: any) => (
            <Tag key={c.check} tone={c.ok ? 'green' : 'red'}>{checkLabels[c.check] ?? c.check}: {c.ok ? 'سليم' : `خلل (${c.detail})`}</Tag>
          ))}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'journal', label: 'دفتر اليومية' }, { key: 'accounts', label: 'أرصدة الحسابات' }, { key: 'tx', label: 'العمليات المالية' }]} />
      {tab !== 'accounts' && <div className="mb-4 flex flex-wrap gap-3">
        <Field label="من"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="إلى"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      </div>}

      {tab === 'journal' && <Card pad={false}>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line bg-canvas/60 text-xs text-muted">
              <th className="px-4 py-2.5 text-right font-medium">القيد</th><th className="px-4 py-2.5 text-right font-medium">الحساب</th>
              <th className="px-4 py-2.5 text-right font-medium">العضو</th>
              <th className="px-4 py-2.5 text-left font-medium">مدين</th><th className="px-4 py-2.5 text-left font-medium">دائن</th>
            </tr></thead>
            <tbody>
              {entries.slice(0, 300).map(e => (
                <Fragment key={e.entry_id}>
                  <tr className="border-t-2 border-line bg-canvas/40">
                    <td colSpan={5} className="px-4 py-2 text-[13px]">
                      <span className="num ml-3 font-semibold">#{e.entry_no}</span>
                      <span className="ml-3 text-muted">{date(e.entry_date)}</span>
                      <span className="ml-3 num text-xs text-muted">{e.tx_no}</span>
                      <span className="ml-2">{e.description}</span>
                      <Tag tone={e.tx_type === 'reversal' ? 'red' : 'neutral'}>{txTypeLabels[e.tx_type]}</Tag>
                    </td>
                  </tr>
                  {e.lines.map((l: any) => (
                    <tr key={l.line_id} className="border-b border-line/60">
                      <td />
                      <td className={`px-4 py-1.5 ${Number(l.credit) > 0 ? 'pr-10' : ''}`}><span className="num ml-2 text-xs text-muted">{l.account_code}</span>{l.account_name}</td>
                      <td className="px-4 py-1.5 text-xs text-muted">{l.member_name ?? ''}</td>
                      <td className="px-4 py-1.5 text-left num-cell">{Number(l.debit) ? sar(l.debit) : ''}</td>
                      <td className="px-4 py-1.5 text-left num-cell">{Number(l.credit) ? sar(l.credit) : ''}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && !journal.loading && <p className="p-8 text-center text-sm text-muted">لا توجد قيود في هذه الفترة</p>}
          {entries.length > 300 && <p className="p-3 text-center text-xs text-muted">يُعرض أحدث 300 قيد — صدّر إلى Excel للاطلاع على الكل</p>}
        </div>
      </Card>}

      {tab === 'accounts' && <Card pad={false}>
        <DataTable rows={balances.data} loading={balances.loading} pageSize={50}
          footer={<tfoot><tr className="border-t-2 border-line font-semibold"><td className="px-4 py-3" colSpan={3}>الإجمالي</td>
            <td className="px-4 py-3 text-left num-cell">{sar(totD)}</td><td className="px-4 py-3 text-left num-cell">{sar(totC)}</td>
            <td className="px-4 py-3">{Math.abs(totD - totC) < 0.005 ? <Tag tone="green">متوازن</Tag> : <Tag tone="red">غير متوازن</Tag>}</td></tr></tfoot>}
          columns={[
            { key: 'code', header: 'الرمز', render: r => <span className="num">{r.code}</span> },
            { key: 'name_ar', header: 'الحساب' },
            { key: 'type', header: 'النوع', render: r => accountTypeLabels[r.type] },
            { key: 'total_debit', header: 'إجمالي المدين', align: 'end', render: r => sar(r.total_debit) },
            { key: 'total_credit', header: 'إجمالي الدائن', align: 'end', render: r => sar(r.total_credit) },
            { key: 'balance', header: 'الرصيد', align: 'end', render: r => <span className="font-semibold">{sar(r.balance)}</span> },
          ]} />
      </Card>}

      {tab === 'tx' && <Card pad={false}><TransactionsTable rows={txs.data} loading={txs.loading} onReverse={setRev} showMember /></Card>}

      <ReverseModal tx={rev} onClose={() => setRev(null)} onDone={reload} />
      <ManualJournal open={manual} accounts={balances.data ?? []} onClose={() => setManual(false)} onDone={reload} />
    </>
  );
}

const checkLabels: Record<string, string> = {
  journal_balanced: 'توازن القيود', member_deposits_reconcile: 'مطابقة الودائع', loans_reconcile: 'مطابقة القروض',
  investments_reconcile: 'مطابقة الاستثمارات', contributions_reconcile: 'مطابقة الاشتراكات', every_tx_has_entry: 'لكل عملية قيد',
  balance_sheet_equation: 'معادلة الميزانية',
};

function groupEntries(lines: any[]) {
  const m = new Map<string, any>();
  for (const l of lines) {
    if (!m.has(l.entry_id)) m.set(l.entry_id, { ...l, lines: [] });
    m.get(l.entry_id).lines.push(l);
  }
  return [...m.values()].map(e => ({ ...e, lines: e.lines.sort((a: any, b: any) => Number(b.debit) - Number(a.debit)) }));
}

function ManualJournal({ open, accounts, onClose, onDone }: { open: boolean; accounts: any[]; onClose: () => void; onDone: () => void }) {
  const a = useAction();
  const [key, setKey] = useState(newKey);
  const [desc, setDesc] = useState('');
  const [d, setD] = useState(today());
  const [ref, setRef] = useState('');
  const [lines, setLines] = useState([{ code: '', dr: '', cr: '' }, { code: '', dr: '', cr: '' }]);
  const opts = accounts.filter(x => !LOCKED.has(x.code)).map(x => ({ value: x.code, label: `${x.code} — ${x.name_ar}` }));
  const td = lines.reduce((s, l) => s + Number(l.dr || 0), 0);
  const tc = lines.reduce((s, l) => s + Number(l.cr || 0), 0);
  const balanced = td > 0 && Math.abs(td - tc) < 0.005;
  const submit = async () => {
    const payload = lines.filter(l => l.code && (Number(l.dr) || Number(l.cr))).map(l => ({ code: l.code, dr: l.dr || '0', cr: l.cr || '0' }));
    const r = await a.run(() => rpc('post_manual_journal', { p_date: d, p_description: desc, p_lines: payload, p_reference: ref || null, p_key: key }), 'تم ترحيل القيد');
    if (r) { setKey(newKey()); setDesc(''); setRef(''); setLines([{ code: '', dr: '', cr: '' }, { code: '', dr: '', cr: '' }]); onDone(); onClose(); }
  };
  return (
    <Modal wide open={open} onClose={onClose} title="قيد يدوي / تصحيحي"
      footer={<><Button onClick={submit} loading={a.busy} disabled={!balanced || desc.trim().length < 3}>ترحيل القيد</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <Notice tone="gold">للأرصدة الافتتاحية والتسويات فقط. حسابات الأعضاء والقروض والاستثمارات والاشتراكات مقفلة هنا — تُعدّل فقط عبر عملياتها المخصصة حتى تبقى السجلات التفصيلية متطابقة.</Notice>
      <div className="grid grid-cols-2 gap-3">
        <Field label="البيان" className="col-span-2"><Input value={desc} onChange={e => setDesc(e.target.value)} /></Field>
        <Field label="التاريخ"><Input type="date" max={today()} value={d} onChange={e => setD(e.target.value)} /></Field>
        <Field label="المرجع"><Input value={ref} onChange={e => setRef(e.target.value)} /></Field>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_120px_120px_32px] gap-2">
            <Select value={l.code} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, code: e.target.value } : x))} placeholder="الحساب…" options={opts} />
            <MoneyInput placeholder="مدين" value={l.dr} onChange={v => setLines(lines.map((x, j) => j === i ? { ...x, dr: v, cr: v ? '' : x.cr } : x))} />
            <MoneyInput placeholder="دائن" value={l.cr} onChange={v => setLines(lines.map((x, j) => j === i ? { ...x, cr: v, dr: v ? '' : x.dr } : x))} />
            <button className="text-muted hover:text-neg disabled:opacity-30" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setLines([...lines, { code: '', dr: '', cr: '' }])}>سطر</Button>
      </div>
      <div className="flex justify-between rounded-lg bg-canvas px-3 py-2 text-sm">
        <span>مدين <span className="num font-semibold">{sar(td)}</span></span>
        <span>دائن <span className="num font-semibold">{sar(tc)}</span></span>
        {balanced ? <Tag tone="green">متوازن</Tag> : <Tag tone="red">غير متوازن</Tag>}
      </div>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}
