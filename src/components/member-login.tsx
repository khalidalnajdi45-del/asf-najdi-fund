'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Mail, MessageCircle } from 'lucide-react';
import { sendCredentials } from '@/lib/report-mail';
import { cleanError } from '@/lib/supabase';
import { rpc } from '@/lib/supabase';
import { useAction } from '@/lib/action';
import { Button, ErrorBox, Field, Input, Modal, Notice } from './ui';

/** Readable temporary password, e.g. Asf-4827-Kmtq (member must change it on first login). */
export function tempPassword() {
  const L = 'abcdefghjkmnpqrstuvwxyz', a = new Uint32Array(8); crypto.getRandomValues(a);
  const digits = Array.from(a.slice(0, 4), x => x % 10).join('');
  const letters = Array.from(a.slice(4), x => L[x % L.length]).join('');
  return `Asf-${digits}-${letters[0].toUpperCase()}${letters.slice(1)}`;
}
export const USERNAME_RE = /^[a-z][a-z0-9._-]{2,19}$/;

export function siteUrl() {
  if (typeof location === 'undefined') return '';
  return `${location.origin}${location.pathname}`;
}

/** Credentials card shown once to the manager, with copy / WhatsApp share. */
export function CredentialsCard({ name, username, password, onClose, memberId, email }: { name: string; username: string; password: string; onClose?: () => void; memberId?: string; email?: string | null }) {
  const [copied, setCopied] = useState(false);
  const [mail, setMail] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  const doMail = async () => {
    if (!memberId) return;
    setMail({ busy: true });
    try { const r = await sendCredentials(memberId, username, password); setMail({ ok: r.demo ? 'النسخة التجريبية لا ترسل بريداً فعلياً' : `أُرسلت إلى ${r.to}` }); }
    catch (e: any) { setMail({ err: cleanError(e.message) }); }
  };
  const text = `السلام عليكم ${name}\nحسابك في منصة صندوق النجدي الادخاري:\nالرابط: ${siteUrl()}\nاسم المستخدم: ${username}\nكلمة المرور المؤقتة: ${password}\n(سيُطلب منك تغييرها عند أول دخول)`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* user can select manually */ }
  };
  return (
    <div className="rounded-xl border border-gold-300 bg-gold-100/50 p-4">
      <div className="mb-3 text-sm font-semibold text-brand-700">بيانات دخول {name} — تظهر مرة واحدة فقط</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-surface p-3"><div className="text-xs text-muted">اسم المستخدم</div><div dir="ltr" className="num select-all text-right text-lg font-semibold">{username}</div></div>
        <div className="rounded-lg bg-surface p-3"><div className="text-xs text-muted">كلمة المرور المؤقتة</div><div dir="ltr" className="num select-all text-right text-lg font-semibold">{password}</div></div>
      </div>
      <p className="mt-2 text-xs text-muted">سيُطلب من العضو تغيير كلمة المرور عند أول دخول. أرسلها له مباشرة (واتساب/رسالة خاصة).</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>{copied ? 'تم النسخ' : 'نسخ الرسالة'}</Button>
        <a className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-canvas" target="_blank" rel="noreferrer"
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}><MessageCircle className="size-4" /> إرسال واتساب</a>
        {memberId && <Button size="sm" variant="gold" icon={<Mail className="size-4" />} loading={mail.busy} disabled={!email || !!mail.ok} onClick={doMail}
          title={email ? undefined : 'أضف البريد الشخصي للعضو أولاً'}>{mail.ok ? 'تم الإرسال' : 'إرسال بالإيميل'}</Button>}
        {onClose && <Button size="sm" variant="ghost" onClick={onClose}>إخفاء</Button>}
      </div>
      {memberId && !email && <p className="mt-2 text-xs text-muted">لا يوجد بريد شخصي لهذا العضو — أضفه من «تعديل» لتتمكن من الإرسال بالإيميل.</p>}
      {mail.ok && <p className="mt-2 text-xs text-pos">{mail.ok}</p>}
      {mail.err && <p className="mt-2 text-xs text-neg">{mail.err}</p>}
    </div>
  );
}

/** Create a username login for a member, or reset an existing one's password. */
export function MemberLoginModal({ open, member, onClose, onDone }: { open: boolean; member: any; onClose: () => void; onDone: () => void }) {
  const has = !!member?.user_id;
  const a = useAction();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(tempPassword());
  const [done, setDone] = useState<{ username: string; password: string; email: string | null } | null>(null);

  useEffect(() => {
    if (open) { setUsername(member?.username ?? ''); setEmail(member?.email && !/@members\.najdi-fund\.app$/.test(member.email) ? member.email : ''); setPassword(tempPassword()); setDone(null); }
  }, [open, member?.id]);

  const u = username.trim().toLowerCase();
  const submit = async () => {
    const r = has
      ? await a.run(() => rpc('admin_reset_password', { p_member: member.id, p_password: password }).then(() => member.username ?? '—'), 'تم تعيين كلمة مرور مؤقتة جديدة')
      : await a.run(() => rpc<string>('admin_create_member_login', { p_member: member.id, p_username: u, p_password: password, p_email: email.trim() || null }), 'تم إنشاء حساب الدخول');
    if (r) {
      const personal = member?.email && !/@members\.najdi-fund\.app$/.test(member.email) ? member.email : null;
      setDone({ username: String(r), password, email: has ? personal : (email.trim() || personal) });
      onDone();
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={has ? `إعادة تعيين كلمة المرور — ${member?.full_name}` : `إنشاء حساب دخول — ${member?.full_name}`}
      footer={done ? <Button variant="secondary" onClick={onClose}>تم</Button> : <>
        <Button onClick={submit} loading={a.busy} icon={<KeyRound className="size-4" />} disabled={!has && !USERNAME_RE.test(u) || password.length < 8}>{has ? 'تعيين كلمة مؤقتة' : 'إنشاء الدخول'}</Button>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button></>}>
      {done ? <CredentialsCard name={member.full_name} username={done.username} password={done.password} memberId={member.id} email={done.email} /> : <>
        {has
          ? <Notice>اسم المستخدم الحالي: <span dir="ltr" className="num font-semibold">{member.username ?? '—'}</span>. ستُعيَّن كلمة مرور مؤقتة ويُطلب من العضو تغييرها عند الدخول.</Notice>
          : <>
            <Field label="اسم المستخدم" hint="حروف إنجليزية صغيرة/أرقام، 3–20 خانة، يبدأ بحرف — مثال: khalid">
              <Input dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="khalid" />
            </Field>
            <Field label="البريد الشخصي (للتقارير الشهرية والرسائل — اختياري)">
              <Input type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@gmail.com" />
            </Field>
          </>}
        <Field label="كلمة المرور المؤقتة">
          <div className="flex gap-1"><Input dir="ltr" value={password} onChange={e => setPassword(e.target.value)} />
            <Button variant="secondary" size="sm" className="h-10" onClick={() => setPassword(tempPassword())}>توليد</Button></div>
        </Field>
        <ErrorBox>{a.error}</ErrorBox>
      </>}
    </Modal>
  );
}
