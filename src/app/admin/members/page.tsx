'use client';
import { go } from '@/lib/nav';
import { useState } from 'react';
import { Download, UserPlus } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { date, sar, today } from '@/lib/format';
import { exportXlsx, n2 } from '@/lib/export';
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Modal, Notice, PageHeader, Textarea } from '@/components/ui';

const genPassword = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  return Array.from(a, x => c[x % c.length]).join('') + '#7';
};

export default function MembersPage() {
  const { data, loading, error, reload } = useData<any[]>(() => q(supabase().from('v_member_balances').select('*').order('member_no')));
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const a = useAction();
  const [f, setF] = useState({ name: '', email: '', phone: '', join: today(), password: genPassword(), notes: '' });

  const submit = async () => {
    const r = await a.run(() => rpc('admin_create_member', {
      p_full_name: f.name, p_email: f.email, p_password: f.password, p_phone: f.phone || null, p_join_date: f.join, p_notes: f.notes || null,
    }), 'تم إنشاء حساب العضو');
    if (r) { setCreated({ email: f.email.trim().toLowerCase(), password: f.password }); setOpen(false); reload(); setF({ name: '', email: '', phone: '', join: today(), password: genPassword(), notes: '' }); }
  };

  const exportList = () => exportXlsx('الأعضاء', [{
    name: 'الأعضاء',
    header: ['رقم العضو', 'الاسم', 'الحالة', 'تاريخ الانضمام', 'إجمالي الاشتراكات', 'اشتراكات متأخرة', 'رصيد الودائع', 'القروض القائمة'],
    rows: (data ?? []).map(m => [m.member_no, m.full_name, m.status === 'active' ? 'نشط' : 'غير نشط', m.join_date,
      n2(m.contributions_total), n2(m.contributions_overdue), n2(m.deposit_balance), n2(m.loan_outstanding)]),
  }]);

  return (
    <>
      <PageHeader title="الأعضاء" subtitle="إدارة حسابات الأعضاء وأرصدتهم"
        actions={<>
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportList}>Excel</Button>
          <Button icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>عضو جديد</Button>
        </>} />
      {created && (
        <div className="mb-4"><Notice>
          تم إنشاء الحساب. بيانات الدخول (تظهر مرة واحدة — أرسلها للعضو بطريقة آمنة):
          <span className="mx-2 num font-semibold">{created.email}</span> / <span className="mx-2 num font-semibold">{created.password}</span>
          <button className="mr-3 text-xs underline" onClick={() => setCreated(null)}>إخفاء</button>
        </Notice></div>
      )}
      <ErrorBox>{error}</ErrorBox>
      <Card pad={false}>
        <DataTable rows={data} loading={loading} searchable={r => `${r.full_name} ${r.member_no}`}
          onRowClick={r => (go(`/admin/members/view/?id=${r.member_id}`))} rowKey={r => r.member_id}
          columns={[
            { key: 'member_no', header: 'رقم العضو', render: r => <span className="num text-xs text-muted">{r.member_no}</span> },
            { key: 'full_name', header: 'الاسم', render: r => <span className="font-medium">{r.full_name}</span> },
            { key: 'status', header: 'الحالة', render: r => <Badge status={r.status} /> },
            { key: 'join_date', header: 'الانضمام', render: r => date(r.join_date) },
            { key: 'contributions_total', header: 'الاشتراكات', align: 'end', render: r => sar(r.contributions_total) },
            { key: 'contributions_overdue', header: 'متأخرات', align: 'end', render: r => Number(r.contributions_overdue) > 0 ? <span className="text-neg">{sar(r.contributions_overdue)}</span> : '—' },
            { key: 'deposit_balance', header: 'رصيد الودائع', align: 'end', render: r => sar(r.deposit_balance) },
            { key: 'loan_outstanding', header: 'قروض قائمة', align: 'end', render: r => Number(r.loan_outstanding) > 0 ? sar(r.loan_outstanding) : '—' },
          ]} />
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="إضافة عضو جديد"
        footer={<><Button onClick={submit} loading={a.busy} disabled={f.name.trim().length < 2 || !f.email.includes('@') || f.password.length < 8}>إنشاء الحساب</Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>إلغاء</Button></>}>
        <Field label="الاسم الكامل"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="البريد الإلكتروني (اسم الدخول)"><Input type="email" dir="ltr" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
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
