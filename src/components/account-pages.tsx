'use client';
import { isLoginAlias, loginName } from '@/lib/format';
import { go } from '@/lib/nav';
import { useEffect, useState } from 'react';
import { CheckCheck, Megaphone, ShieldCheck } from 'lucide-react';
import { rpc, supabase, cleanError } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { useAuth } from '@/lib/auth';
import { getArabicDigits, setArabicDigits } from '@/lib/format';
import { Button, Card, ErrorBox, Field, Input, KV, Modal, Notice, PageHeader, Tag, Textarea, useToast } from './ui';
import { NotificationList } from './member-views';

export function NotificationsPage({ admin }: { admin: boolean }) {
  const { profile } = useAuth();
  const [ann, setAnn] = useState(false);
  const d = useData<any[]>(() => q(supabase().from('notifications').select('*').eq('user_id', profile!.id).order('created_at', { ascending: false }).limit(200)), [profile?.id]);
  const changed = () => { d.reload(); window.dispatchEvent(new Event('notifications-changed')); };
  const open = async (n: any) => {
    if (!n.is_read) { await rpc('mark_notifications_read', { p_ids: [n.id] }); changed(); }
    if (n.link) go(toRoute(n.link));
  };
  const unread = (d.data ?? []).filter(n => !n.is_read).length;
  return (
    <>
      <PageHeader title="الإشعارات" subtitle={unread ? `${unread} إشعار غير مقروء` : 'لا توجد إشعارات جديدة'}
        actions={<>
          {unread > 0 && <Button variant="secondary" icon={<CheckCheck className="size-4" />} onClick={async () => { await rpc('mark_notifications_read', { p_ids: null }); changed(); }}>تعليم الكل كمقروء</Button>}
          {admin && <Button icon={<Megaphone className="size-4" />} onClick={() => setAnn(true)}>إعلان لجميع الأعضاء</Button>}
        </>} />
      <Card pad={false}><NotificationList rows={d.data} onOpen={open} /></Card>
      {admin && <Outbox />}
      {admin && <Announcement open={ann} onClose={() => setAnn(false)} />}
    </>
  );
}

function Outbox() {
  const d = useData<any[]>(() => q(supabase().from('notification_deliveries').select('*').order('created_at', { ascending: false }).limit(50)));
  return (
    <Card className="mt-4" title="قنوات الإرسال الخارجية" subtitle="البريد / SMS / واتساب — نقطة التكامل المستقبلية">
      <Notice>الإشعارات داخل المنصة تعمل الآن. عند تفعيل قناة خارجية من الإعدادات، تُضاف رسائلها إلى طابور الإرسال (notification_deliveries) لتلتقطها خدمة إرسال لاحقاً — راجع README.</Notice>
      <div className="mt-3 text-sm text-muted">{(d.data ?? []).length ? `${d.data!.filter(x => x.status === 'pending').length} رسالة بانتظار الإرسال` : 'لا توجد رسائل في الطابور (القنوات الخارجية غير مفعلة)'}</div>
    </Card>
  );
}

function Announcement({ open, onClose }: { open: boolean; onClose: () => void }) {
  const a = useAction();
  const [t, setT] = useState('');
  const [b, setB] = useState('');
  const send = async () => {
    const n = await a.run(() => rpc<number>('send_announcement', { p_title: t, p_body: b }));
    if (n !== undefined) { setT(''); setB(''); onClose(); window.dispatchEvent(new Event('notifications-changed')); }
  };
  return (
    <Modal open={open} onClose={onClose} title="إعلان مهم للصندوق"
      footer={<><Button onClick={send} loading={a.busy} disabled={t.trim().length < 3}>إرسال للجميع</Button><Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      <Field label="العنوان"><Input value={t} onChange={e => setT(e.target.value)} /></Field>
      <Field label="النص"><Textarea rows={5} value={b} onChange={e => setB(e.target.value)} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
    </Modal>
  );
}

export function ProfilePage() {
  const { profile, memberId, refresh } = useAuth();
  const toast = useToast();
  const a = useAction();
  const member = useData<any>(() => (memberId ? q(supabase().from('members').select('*').eq('id', memberId).single()) : Promise.resolve(null)), [memberId]);
  const [f, setF] = useState({ name: '', phone: '' });
  const [pw, setPw] = useState({ p1: '', p2: '' });
  const [arab, setArab] = useState(false);
  useEffect(() => { setF({ name: profile?.full_name ?? '', phone: member.data?.phone ?? '' }); }, [profile, member.data]);
  useEffect(() => { setArab(getArabicDigits()); }, []);

  const saveProfile = async () => {
    const r = await a.run(() => rpc('update_my_profile', { p_full_name: f.name, p_phone: f.phone }).then(() => true), 'تم حفظ البيانات');
    if (r) refresh();
  };
  const savePw = async () => {
    if (pw.p1.length < 8) return a.setError('كلمة المرور يجب ألا تقل عن 8 أحرف');
    if (pw.p1 !== pw.p2) return a.setError('كلمتا المرور غير متطابقتين');
    const r = await a.run(async () => { const { error } = await supabase().auth.updateUser({ password: pw.p1 }); if (error) throw error; return true; }, 'تم تغيير كلمة المرور');
    if (r) setPw({ p1: '', p2: '' });
  };
  const toggleDigits = (v: boolean) => {
    setArab(v); setArabicDigits(v);
    try { localStorage.setItem('najdi-fund-digits', v ? 'arab' : 'latn'); } catch {}
    toast.ok('تم الحفظ — يُطبق على الصفحات عند فتحها');
  };

  return (
    <>
      <PageHeader title="الملف الشخصي" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="البيانات الأساسية">
          <div className="space-y-3">
            <KV items={[[isLoginAlias(profile?.email) ? 'اسم المستخدم' : 'البريد الإلكتروني (اسم الدخول)', <span className="num" dir="ltr">{loginName(profile?.email)}</span>], ['نوع الحساب', profile?.role === 'manager' ? 'مدير الصندوق' : 'عضو'],
              ...(member.data ? [['رقم العضو', <span className="num">{member.data.member_no}</span>] as [string, any]] : [])]} />
            <Field label="الاسم الكامل"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
            {memberId && <Field label="رقم الجوال"><Input dir="ltr" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>}
            <Button onClick={saveProfile} loading={a.busy}>حفظ</Button>
          </div>
        </Card>
        <Card title="كلمة المرور">
          <div className="space-y-3">
            <Field label="كلمة المرور الجديدة"><Input type="password" dir="ltr" autoComplete="new-password" value={pw.p1} onChange={e => setPw({ ...pw, p1: e.target.value })} /></Field>
            <Field label="تأكيد كلمة المرور"><Input type="password" dir="ltr" autoComplete="new-password" value={pw.p2} onChange={e => setPw({ ...pw, p2: e.target.value })} /></Field>
            <Button onClick={savePw} loading={a.busy} disabled={!pw.p1}>تغيير كلمة المرور</Button>
          </div>
        </Card>
        <MfaCard />
        <Card title="عرض الأرقام">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-brand-600" checked={arab} onChange={e => toggleDigits(e.target.checked)} />
            استخدام الأرقام العربية الهندية (١٢٣) بدلاً من (123)
          </label>
        </Card>
      </div>
      <div className="mt-4"><ErrorBox>{a.error}</ErrorBox></div>
    </>
  );
}

function MfaCard() {
  const [factors, setFactors] = useState<any[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const load = async () => { const { data } = await supabase().auth.mfa.listFactors(); setFactors(data?.totp ?? []); };
  useEffect(() => { load(); }, []);
  const verified = factors.find(f => f.status === 'verified');

  const start = async () => {
    setErr(null);
    for (const f of factors.filter(x => x.status !== 'verified')) await supabase().auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase().auth.mfa.enroll({ factorType: 'totp', friendlyName: `najdi-${Date.now()}` });
    if (error) return setErr(cleanError(error.message));
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const confirm = async () => {
    const sb = supabase();
    const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId: enroll!.id });
    if (e1) return setErr(cleanError(e1.message));
    const { error } = await sb.auth.mfa.verify({ factorId: enroll!.id, challengeId: ch.id, code });
    if (error) return setErr('الرمز غير صحيح');
    setEnroll(null); setCode(''); toast.ok('تم تفعيل التحقق بخطوتين'); load();
  };
  const disable = async () => {
    const { error } = await supabase().auth.mfa.unenroll({ factorId: verified.id });
    if (error) return setErr(cleanError(error.message));
    toast.ok('تم إيقاف التحقق بخطوتين'); load();
  };
  return (
    <Card title="التحقق بخطوتين (اختياري)" actions={verified ? <Tag tone="green">مفعل</Tag> : <Tag>غير مفعل</Tag>}>
      {!enroll && <div className="space-y-3 text-sm text-muted">
        <p className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-brand-500" />يطلب رمزاً من تطبيق مصادقة (Google Authenticator / Microsoft Authenticator) عند كل دخول.</p>
        {verified ? <Button variant="danger" onClick={disable}>إيقاف</Button> : <Button onClick={start}>تفعيل</Button>}
      </div>}
      {enroll && <div className="space-y-3">
        <p className="text-sm text-muted">امسح الرمز بتطبيق المصادقة ثم أدخل الرمز المكون من 6 أرقام.</p>
        <img src={enroll.qr} alt="QR" className="size-44 rounded-lg border border-line bg-white p-2" />
        <div className="num text-xs text-muted break-all">{enroll.secret}</div>
        <Input dir="ltr" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} className="max-w-40 text-center tracking-widest" />
        <div className="flex gap-2"><Button onClick={confirm} disabled={code.length !== 6}>تأكيد</Button><Button variant="secondary" onClick={() => setEnroll(null)}>إلغاء</Button></div>
      </div>}
      {err && <div className="mt-3"><ErrorBox>{err}</ErrorBox></div>}
    </Card>
  );
}

/** DB links are written without trailing slashes; static hosting serves "/path/". */
export function toRoute(link: string) {
  const [path, query] = link.split('?');
  const p = path.endsWith('/') ? path : `${path}/`;
  return query ? `${p}?${query}` : p;
}
