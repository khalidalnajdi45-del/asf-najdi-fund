'use client';
import { useEffect, useMemo, useState } from 'react';
import { Gift, Mail, Send } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, num, sar, today } from '@/lib/format';
import { sendMemberMessage, mailSummary } from '@/lib/report-mail';
import { Button, Card, DataTable, ErrorBox, Field, Input, isMoney, Modal, MoneyInput, Notice, PageHeader, Select, Stat, Tag, Textarea } from '@/components/ui';

const BASIS = [
  { value: 'contributions', label: 'بالتناسب مع الاشتراكات المدفوعة' },
  { value: 'contributions_deposits', label: 'بالتناسب مع الاشتراكات + الودائع' },
  { value: 'equal', label: 'بالتساوي بين الأعضاء' },
];
const BODY = `السلام عليكم {الاسم}،

يسعدنا إبلاغك بتوزيع أرباح الصندوق ({عنوان_التوزيع}).

حصتك من التوزيع: {حصة_الأرباح}
{طريقة}

شاكرين ثقتك ومساهمتك في الصندوق.`;

export default function DistributionsPage() {
  const sb = supabase();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<any>(null);
  const avail = useData<number>(() => rpc<number>('distributable_surplus'));
  const hist = useData<any[]>(() => q(sb.from('v_profit_distributions').select('*').order('created_at', { ascending: false })));
  const total = (hist.data ?? []).reduce((a, r) => a + num(r.posted), 0);

  return (
    <>
      <PageHeader title="توزيع الأرباح" subtitle="توزيع الفائض المحقق على الأعضاء — يُضاف لرصيد ودائعهم أو يُصرف نقداً، ويصلهم إشعار وإيميل بحصصهم"
        actions={<Button icon={<Gift className="size-4" />} onClick={() => setOpen(true)} disabled={!(num(avail.data) > 0)}>توزيع جديد</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="الفائض المحقق المتاح للتوزيع" value={sar(avail.data ?? 0)} tone="brand" hint="الإيرادات المحققة − المصروفات − ما وُزّع سابقاً (لا يشمل الأرباح غير المحققة)" />
        <Stat label="إجمالي ما وُزّع" value={sar(total)} hint={`${hist.data?.length ?? 0} عملية توزيع`} />
      </div>
      <Card pad={false} title="سجل التوزيعات">
        <DataTable rows={hist.data} loading={hist.loading} empty="لم يتم أي توزيع بعد" onRowClick={setView} columns={[
          { key: 'dist_date', header: 'التاريخ', render: r => date(r.dist_date) },
          { key: 'title', header: 'العنوان' },
          { key: 'basis', header: 'الأساس', render: r => BASIS.find(b => b.value === r.basis)?.label },
          { key: 'method', header: 'الطريقة', render: r => r.method === 'deposit' ? <Tag tone="violet">لرصيد الودائع</Tag> : <Tag tone="amber">نقداً</Tag> },
          { key: 'members', header: 'الأعضاء', render: r => <span className="num">{r.members}</span> },
          { key: 'total', header: 'المبلغ', align: 'end', render: r => sar(r.total) },
        ]} />
      </Card>
      <NewDistribution open={open} onClose={() => setOpen(false)} available={num(avail.data)} onDone={() => { avail.reload(); hist.reload(); }} />
      <Lines dist={view} onClose={() => setView(null)} />
    </>
  );
}

function NewDistribution({ open, onClose, available, onDone }: { open: boolean; onClose: () => void; available: number; onDone: () => void }) {
  const a = useAction();
  const members = useData<any[]>(() => q(supabase().from('members').select('id, member_no, full_name, contribution_exempt').eq('status', 'active').order('member_no')));
  const year = today().slice(0, 4);
  const [f, setF] = useState({ title: `أرباح ${year}`, amount: '', basis: 'contributions', method: 'deposit', date: today(), note: '', email: true });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [prev, setPrev] = useState<any[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [mailMsg, setMailMsg] = useState<string | null>(null);

  useEffect(() => { if (open) { setConfirm(false); setMailMsg(null); } }, [open]);
  useEffect(() => { if (members.data && !picked) setPicked(new Set(members.data.map(m => m.id))); }, [members.data]); // eslint-disable-line
  const ids = useMemo(() => [...(picked ?? [])], [picked]);
  useEffect(() => {
    if (!open || !isMoney(f.amount) || !ids.length) { setPrev(null); return; }
    let alive = true;
    const t = setTimeout(() => rpc<any[]>('preview_profit_distribution', { p_amount: f.amount, p_basis: f.basis, p_members: ids })
      .then(r => alive && setPrev(r)).catch(() => alive && setPrev([])), 250);
    return () => { alive = false; clearTimeout(t); };
  }, [open, f.amount, f.basis, ids]);

  const over = num(f.amount) > available + 0.001;
  const submit = async () => {
    const id = await a.run(() => rpc<string>('post_profit_distribution', {
      p_title: f.title, p_amount: f.amount, p_basis: f.basis, p_method: f.method, p_date: f.date, p_members: ids, p_note: f.note || null,
    }), 'تم توزيع الأرباح وإشعار الأعضاء');
    if (!id) return;
    if (f.email && prev?.length) {
      try {
        const how = f.method === 'deposit' ? 'أُضيفت حصتك إلى رصيد ودائعك في الصندوق، وتقدر تشوفها في حسابك.' : 'ستُصرف لك حصتك نقداً من إدارة الصندوق.';
        const mid = await rpc<string>('create_member_message', {
          p_kind: 'announcement', p_subject: `توزيع أرباح الصندوق — ${f.title}`, p_body: BODY.replace('{طريقة}', how),
          p_members: prev.map(r => r.member_id), p_notify: false,
        });
        setMailMsg(mailSummary(await sendMemberMessage(mid)));
      } catch (e: any) { setMailMsg('تم التوزيع، لكن تعذر إرسال الإيميل: ' + e.message); }
    }
    onDone();
    if (!f.email) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="توزيع أرباح على الأعضاء"
      footer={mailMsg ? <Button variant="secondary" onClick={onClose}>تم</Button> : confirm ? <>
        <Button onClick={submit} loading={a.busy} icon={<Send className="size-4" />}>تأكيد التوزيع</Button>
        <Button variant="secondary" onClick={() => setConfirm(false)}>رجوع</Button></> : <>
        <Button onClick={() => setConfirm(true)} disabled={!prev?.length || over || f.title.trim().length < 3}>مراجعة وتأكيد</Button>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      {mailMsg ? <Notice>{mailMsg}</Notice> : <>
        <div className="grid grid-cols-2 gap-3">
          <Field label="عنوان التوزيع" className="col-span-2"><Input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="مثال: أرباح الربع الثالث 2026" /></Field>
          <Field label="المبلغ الإجمالي" hint={<button type="button" className="text-brand-600 underline" onClick={() => setF({ ...f, amount: available.toFixed(2) })}>المتاح {sar(available)}</button>} error={over ? 'أكبر من الفائض المتاح' : null}>
            <MoneyInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></Field>
          <Field label="تاريخ التوزيع"><Input type="date" max={today()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="أساس التوزيع"><Select value={f.basis} onChange={e => setF({ ...f, basis: e.target.value })} options={BASIS} /></Field>
          <Field label="طريقة التوزيع"><Select value={f.method} onChange={e => setF({ ...f, method: e.target.value })} options={[{ value: 'deposit', label: 'إضافة لرصيد ودائع العضو' }, { value: 'cash', label: 'صرف نقدي (يخصم من النقد)' }]} /></Field>
        </div>
        <div className="mt-3">
          <div className="mb-1.5 text-[13px] font-medium text-ink-2">الأعضاء المشمولون</div>
          <div className="flex flex-wrap gap-2">
            {(members.data ?? []).map(m => {
              const on = picked?.has(m.id);
              return <button key={m.id} type="button" onClick={() => setPicked(p => { const s = new Set(p ?? []); on ? s.delete(m.id) : s.add(m.id); return s; })}
                className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface text-muted'}`}>{m.full_name}</button>;
            })}
          </div>
        </div>
        {prev && <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {prev.map(r => <li key={r.member_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0"><span className="block truncate">{r.full_name}</span>
              {f.basis !== 'equal' && <span className="block text-[11px] text-muted num-cell">الأساس {sar(r.base_amount)}</span>}</span>
            <span className="shrink-0 text-end"><span className="block font-semibold num-cell">{sar(r.amount)}</span>
              <span className="block text-[11px] text-muted num-cell">{(num(r.share_pct) * 100).toFixed(2)}%</span></span>
          </li>)}
          {!prev.length && <li className="px-3 py-4 text-center text-sm text-muted">لا يوجد أعضاء مستحقون حسب هذا الأساس</li>}
        </ul>}
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={f.email} onChange={e => setF({ ...f, email: e.target.checked })} />
          <Mail className="size-4 text-muted" /> إرسال إيميل لكل عضو بحصته</label>
        <Field label="ملاحظة داخلية (اختياري)" className="mt-3"><Textarea rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
        {confirm && <Notice>سيتم توزيع <b className="num">{sar(f.amount)}</b> على <b className="num">{prev?.length}</b> عضو {f.method === 'deposit' ? 'بإضافتها لأرصدة ودائعهم' : 'نقداً'} بتاريخ {date(f.date)}. يمكن تصحيح أي حصة لاحقاً بقيد عكسي من دفتر الأستاذ.</Notice>}
        <ErrorBox>{a.error}</ErrorBox>
      </>}
    </Modal>
  );
}

function Lines({ dist, onClose }: { dist: any; onClose: () => void }) {
  const d = useData<any[]>(() => dist ? q(supabase().from('profit_distribution_lines').select('*, members(full_name, member_no)').eq('distribution_id', dist.id)) : Promise.resolve([]), [dist?.id]);
  return (
    <Modal open={!!dist} onClose={onClose} title={dist?.title ?? ''}>
      <div className="mb-3 text-sm text-muted">{dist && `${date(dist.dist_date)} · ${sar(dist.total)} · ${dist.method === 'deposit' ? 'لرصيد الودائع' : 'نقداً'}`}</div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {(d.data ?? []).map(l => <li key={l.id} className="flex justify-between px-3 py-2 text-sm"><span>{l.members?.full_name}</span>
          <span className="num"><span className="text-xs text-muted">{(num(l.share_pct) * 100).toFixed(2)}% · </span>{sar(l.amount)}</span></li>)}
      </ul>
    </Modal>
  );
}
