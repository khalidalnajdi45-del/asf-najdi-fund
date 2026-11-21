'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { Download, LayoutGrid, List, UserPlus, Users } from 'lucide-react';
import clsx from 'clsx';
import { Avatar, Band, BandStat, SegBar } from '@/components/admin-viz';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, sar, today } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Modal, PageHeader, Tag, Textarea } from '@/components/ui';
import { CredentialsCard, tempPassword as genPassword, USERNAME_RE } from '@/components/member-login';


export default function MembersPage() {
  const { data, loading, error, reload } = useData<any[]>(async () => {
    const [bal, mem] = await Promise.all([q(supabase().from('v_member_balances').select('*').order('member_no')), q(supabase().from('members').select('id, username'))]);
    const u = new Map((mem as any[]).map(m => [m.id, m.username]));
    return (bal as any[]).map(b => ({ ...b, username: u.get(b.member_id) ?? null }));
  });
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'grid' | 'table'>(() => { try { return (localStorage.getItem('members-view') as any) || 'grid'; } catch { return 'grid'; } });
  const [qs, setQs] = useState('');
  const setV = (v: 'grid' | 'table') => { setView(v); try { localStorage.setItem('members-view', v); } catch { /* ignore */ } };
  const all = data ?? [];
  const netOf = (m: any) => Number(m.contributions_total) + Number(m.deposit_balance) - Number(m.loan_outstanding);
  const S = (k: string) => all.reduce((a, m) => a + Number(m[k] ?? 0), 0);
  const active = all.filter(m => m.status === 'active');
  const late = all.filter(m => Number(m.contributions_overdue) > 0);
  const noLogin = all.filter(m => !m.username).length;
  const shown = all.filter(m => !qs || `${m.full_name} ${m.member_no}`.includes(qs));
  const maxAbs = Math.max(1, ...all.map(m => Math.max(Number(m.contributions_total) + Number(m.deposit_balance), Number(m.loan_outstanding))));
  const [created, setCreated] = useState<{ name: string; username: string; password: string; memberId: string; email: string | null } | null>(null);
  const a = useAction();
  const blank = () => ({ name: '', username: '', email: '', phone: '', join: today(), password: genPassword(), notes: '' });
  const [f, setF] = useState(blank());

  const submit = async () => {
    const r = await a.run(() => rpc('admin_create_member_v2', {
      p_full_name: f.name, p_username: f.username.trim().toLowerCase(), p_password: f.password, p_email: f.email.trim() || null,
      p_phone: f.phone || null, p_join_date: f.join, p_notes: f.notes || null,
    }), 'تم إنشاء حساب العضو');
    if (r) { setCreated({ name: f.name.trim(), username: f.username.trim().toLowerCase(), password: f.password, memberId: String(r), email: f.email.trim() || null }); setOpen(false); reload(); setF(blank()); }
  };

  const exportList = () => exportXlsx('الأعضاء', [{
    name: 'الأعضاء',
    header: ['رقم العضو', 'الاسم', 'الحالة', 'تاريخ الانضمام', 'إجمالي الاشتراكات', 'اشتراكات متأخرة', 'رصيد الودائع', 'القروض القائمة', 'صافي الرصيد'],
    rows: (data ?? []).map(m => [m.member_no, m.full_name, m.status === 'active' ? 'نشط' : 'غير نشط', m.join_date,
      n2(m.contributions_total), n2(m.contributions_overdue), n2(m.deposit_balance), n2(m.loan_outstanding),
      n2(Number(m.contributions_total) + Number(m.deposit_balance) - Number(m.loan_outstanding))]),
  }]);

  return (
    <>
      <PageHeader title="الأعضاء" subtitle="إدارة حسابات الأعضاء وأرصدتهم"
        actions={<>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportList}>Excel</Button>
          <Button icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>عضو جديد</Button>
        </>} />
      {created && <div className="mb-4"><CredentialsCard {...created} onClose={() => setCreated(null)} /></div>}
      <ErrorBox>{error}</ErrorBox>
      <Band>
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex items-center gap-3"><span className="flex size-12 items-center justify-center rounded-2xl bg-white/10 text-gold-300"><Users className="size-6" /></span>
              <BandStat big label="أسرة الصندوق" value={`${active.length} عضو نشط`} tone="gold" sub={all.length > active.length ? `${all.length - active.length} غير نشط` : undefined} /></div>
            <BandStat label="صافي أرصدة الأعضاء" value={sar(all.reduce((a, m) => a + netOf(m), 0))} />
            <BandStat label="عليهم متأخرات" value={late.length} tone={late.length ? 'neg' : 'pos'} sub={late.length ? sar(S('contributions_overdue')) : 'الكل ملتزم ✓'} />
          </div>
          <div className="space-y-4 lg:border-s lg:border-white/10 lg:ps-6">
            <div><div className="mb-2 text-xs text-brand-200">تركيبة ما للأعضاء وما عليهم</div>
              <SegBar dark parts={[{ label: 'اشتراكات', value: S('contributions_total'), color: '#D6BC8C' }, { label: 'ودائع', value: S('deposit_balance'), color: '#9c7bb0' }, { label: 'قروض قائمة', value: S('loan_outstanding'), color: '#f0b59c' }]} /></div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white/10 px-3 py-1">لديهم قروض: <b className="num">{all.filter(m => Number(m.loan_outstanding) > 0).length}</b></span>
              <span className="rounded-full bg-white/10 px-3 py-1">مودعون: <b className="num">{all.filter(m => Number(m.deposit_balance) > 0).length}</b></span>
              <span className="rounded-full bg-white/10 px-3 py-1">بدون حساب دخول: <b className="num">{noLogin}</b></span>
            </div>
          </div>
        </div>
      </Band>
      <div className="mb-3 flex items-center gap-2">
        <input value={qs} onChange={e => setQs(e.target.value)} placeholder="بحث بالاسم أو الرقم…" className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-brand-400 sm:max-w-xs" />
        <div className="ms-auto flex rounded-xl border border-line bg-surface p-1">
          <button onClick={() => setV('grid')} className={clsx('rounded-lg p-1.5', view === 'grid' ? 'bg-brand-600 text-white' : 'text-muted')} aria-label="بطاقات"><LayoutGrid className="size-4" /></button>
          <button onClick={() => setV('table')} className={clsx('rounded-lg p-1.5', view === 'table' ? 'bg-brand-600 text-white' : 'text-muted')} aria-label="جدول"><List className="size-4" /></button>
        </div>
      </div>
      {view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(m => { const net = netOf(m), owe = Number(m.contributions_overdue) > 0;
            return (
              <button key={m.member_id} onClick={() => go(`/admin/members/view/?id=${m.member_id}`)}
                className={clsx('flex flex-col gap-3 rounded-2xl border bg-surface p-4 text-start transition hover:border-gold-500 hover:shadow-md', m.status !== 'active' && 'opacity-60', owe ? 'border-clay/40' : 'border-line')}>
                <div className="flex w-full items-center gap-3"><Avatar name={m.full_name} size={44} />
                  <div className="min-w-0 flex-1"><div className="truncate font-semibold">{m.full_name}</div>
                    <div className="text-xs text-muted"><span className="num">{m.member_no}</span>{m.username ? <> · <span dir="ltr" className="num">@{m.username}</span></> : ' · بدون حساب'}</div></div>
                  {owe ? <Tag tone="red">متأخر</Tag> : <Badge status={m.status} />}
                </div>
                <div className="w-full">
                  <div className="flex items-baseline justify-between"><span className="text-xs text-muted">صافي الرصيد</span>
                    <span className={clsx('font-display text-xl font-semibold num-cell', net < 0 ? 'text-neg' : 'text-brand-700')}>{sar(net)}</span></div>
                  <div className="mt-2 space-y-1">
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-canvas">
                      <span className="bg-gold-500" style={{ width: `${(Number(m.contributions_total) / maxAbs) * 100}%` }} />
                      <span className="bg-[#9c7bb0]" style={{ width: `${(Number(m.deposit_balance) / maxAbs) * 100}%` }} /></div>
                    {Number(m.loan_outstanding) > 0 && <div className="flex h-1.5 overflow-hidden rounded-full bg-canvas"><span className="bg-clay" style={{ width: `${(Number(m.loan_outstanding) / maxAbs) * 100}%` }} /></div>}
                  </div>
                </div>
                <div className="grid w-full grid-cols-3 gap-2 rounded-xl bg-canvas p-2 text-center text-[11px]">
                  <div><div className="text-muted">اشتراكات</div><div className="font-medium num-cell">{sar(m.contributions_total)}</div></div>
                  <div><div className="text-muted">ودائع</div><div className="font-medium num-cell">{sar(m.deposit_balance)}</div></div>
                  <div><div className="text-muted">قروض</div><div className={clsx('font-medium num-cell', Number(m.loan_outstanding) > 0 && 'text-neg')}>{Number(m.loan_outstanding) > 0 ? sar(m.loan_outstanding) : '—'}</div></div>
                </div>
                {owe && <div className="w-full text-xs text-neg">متأخرات اشتراك: <span className="num-cell">{sar(m.contributions_overdue)}</span></div>}
              </button>);
          })}
        </div>
      ) : <Card pad={false}>
        <DataTable rows={shown} loading={loading} searchable={r => `${r.full_name} ${r.member_no}`}
          onRowClick={r => (go(`/admin/members/view/?id=${r.member_id}`))} rowKey={r => r.member_id}
          columns={[
            { key: 'member_no', header: 'رقم العضو', render: r => <span className="num text-xs text-muted">{r.member_no}</span> },
            { key: 'full_name', header: 'الاسم', render: r => <span className="font-medium">{r.full_name}</span> },
            { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
            { key: 'username', header: 'الدخول', render: r => r.username ? <span dir="ltr" className="num text-xs">{r.username}</span> : <span className="text-xs text-muted">بدون حساب</span> },
            { key: 'join_date', header: 'الانضمام', render: r => date(r.join_date) },
            { key: 'contributions_total', header: 'الاشتراكات', align: 'end', render: r => sar(r.contributions_total) },
            { key: 'contributions_overdue', header: 'متأخرات', align: 'end', render: r => Number(r.contributions_overdue) > 0 ? <span className="text-neg">{sar(r.contributions_overdue)}</span> : '—' },
            { key: 'deposit_balance', header: 'رصيد الودائع', align: 'end', render: r => sar(r.deposit_balance) },
            { key: 'loan_outstanding', header: 'قروض قائمة', align: 'end', render: r => Number(r.loan_outstanding) > 0 ? sar(r.loan_outstanding) : '—' },
            { key: 'net', header: 'صافي الرصيد', align: 'end', render: r => { const v = Number(r.contributions_total) + Number(r.deposit_balance) - Number(r.loan_outstanding);
              return <span className={`font-semibold ${v < 0 ? 'text-neg' : 'text-brand-700'}`}>{sar(v)}</span>; } },
          ]} />
      </Card>}

      <Modal open={open} onClose={() => setOpen(false)} title="إضافة عضو جديد"
        footer={<><Button onClick={submit} loading={a.busy} disabled={f.name.trim().length < 2 || !USERNAME_RE.test(f.username.trim().toLowerCase()) || f.password.length < 8}>إنشاء الحساب</Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button></>}>
        <Field label="الاسم الكامل"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="اسم المستخدم (للدخول)" hint="حروف إنجليزية صغيرة/أرقام — مثال: khalid"><Input dir="ltr" autoCapitalize="none" value={f.username} onChange={e => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') })} /></Field>
          <Field label="البريد الشخصي (للتقارير — اختياري)"><Input type="email" dir="ltr" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="الجوال"><Input dir="ltr" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="05xxxxxxxx" /></Field>
          <Field label="تاريخ الانضمام" hint="تُنشأ الاشتراكات المستحقة من شهر الانضمام"><Input type="date" value={f.join} onChange={e => setF({ ...f, join: e.target.value })} /></Field>
          <Field label="كلمة مرور مؤقتة"><div className="flex gap-1"><Input dir="ltr" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
            <Button variant="secondary" size="sm" className="h-10" onClick={() => setF({ ...f, password: genPassword() })}>توليد</Button></div></Field>
        </div>
        <Field label="ملاحظات"><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <ErrorBox>{a.error}</ErrorBox>
      </Modal>
    </>
  );
}
