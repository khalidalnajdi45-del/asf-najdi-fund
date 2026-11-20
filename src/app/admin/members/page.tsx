'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { Download, UserPlus } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, sar, today } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Modal, PageHeader, Textarea } from '@/components/ui';
import { CredentialsCard, tempPassword as genPassword, USERNAME_RE } from '@/components/member-login';


export default function MembersPage() {
  const { data, loading, error, reload } = useData<any[]>(async () => {
    const [bal, mem] = await Promise.all([q(supabase().from('v_member_balances').select('*').order('member_no')), q(supabase().from('members').select('id, username'))]);
    const u = new Map((mem as any[]).map(m => [m.id, m.username]));
    return (bal as any[]).map(b => ({ ...b, username: u.get(b.member_id) ?? null }));
  });
  const [open, setOpen] = useState(false);
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
      <Card pad={false}>
        <DataTable rows={data} loading={loading} searchable={r => `${r.full_name} ${r.member_no}`}
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
      </Card>

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
