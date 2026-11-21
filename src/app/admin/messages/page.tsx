'use client';
import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Bell, CheckSquare, Mail, RotateCcw, Send, Square } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { Band, BandStat, Ring } from '@/components/admin-viz';
import { dateTime, num, sar, isLoginAlias } from '@/lib/format';
import { buildMessageEmail, MERGE_FIELDS, mergeText } from '@/lib/report-email';
import { EMAIL_BANNER_DATA_URI } from '@/lib/email-banner';
import { mailSummary, sendMemberMessage } from '@/lib/report-mail';
import { useAuth } from '@/lib/auth';
import { Button, Card, DataTable, ErrorBox, Field, Input, Modal, PageHeader, Tabs, Tag, Textarea, useToast } from '@/components/ui';

type M = { id: string; full_name: string; member_no: string; email: string | null; user_id: string | null; contribution_exempt: boolean };
type Bal = { member_id: string; contributions_overdue: string; contributions_overdue_months: number; loan_outstanding: string };
type Kind = 'custom' | 'contribution_reminder' | 'loan_reminder';
type Aud = 'all' | 'arrears' | 'loans' | 'pick';

const TEMPLATES: Record<Kind, { label: string; subject: string; body: string; aud: Aud }> = {
  custom: { label: 'رسالة عامة', aud: 'all', subject: '', body: 'السلام عليكم {الاسم}،\n\n\n\nإدارة الصندوق' },
  contribution_reminder: {
    label: 'تذكير بالاشتراك', aud: 'arrears', subject: 'تذكير بسداد الاشتراك الشهري',
    body: 'السلام عليكم {الاسم}،\n\nنود تذكيرك بأن عليك متأخرات في الاشتراك الشهري بمبلغ {المتأخرات} عن {أشهر_التأخير} شهر.\n\nنأمل المبادرة بالسداد في أقرب وقت، وشاكرين لك التزامك.\n\nإدارة الصندوق',
  },
  loan_reminder: {
    label: 'تذكير بسداد القرض', aud: 'loans', subject: 'تذكير بسداد القرض',
    body: 'السلام عليكم {الاسم}،\n\nنود تذكيرك بأن المتبقي عليك من القروض {المتبقي_من_القرض}.\n\nنأمل الاستمرار في السداد حسب المتفق عليه، وجزاك الله خيراً.\n\nإدارة الصندوق',
  },
};

export default function Messages() {
  const [tab, setTab] = useState('new');
  const hist = useData<any[]>(() => q(supabase().from('v_member_messages').select('*').order('created_at', { ascending: false }).limit(100)));
  return (
    <>
      <PageHeader title="مراسلة الأعضاء" subtitle="أرسل بريداً لعضو أو لمجموعة أو للجميع — مع تذكيرات جاهزة بالاشتراك والقروض" />
      {(() => { const h = hist.data ?? []; const S = (k: string) => h.reduce((a, m) => a + Number(m[k] ?? 0), 0); const sent = S('sent'), rc = S('recipients');
        const m30 = h.filter(m => Date.now() - Date.parse(m.created_at) < 30 * 86400000).length;
        return <Band>
          <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
            <Ring pct={rc ? (sent / rc) * 100 : 100} size={104} stroke={9} color="#D6BC8C" track="rgba(255,255,255,0.12)">
              <span className="flex flex-col items-center leading-tight"><span className="text-lg font-semibold num-cell">{rc ? Math.round((sent / rc) * 100) : 0}%</span><span className="text-[10px] text-brand-200">نسبة الوصول</span></span></Ring>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <BandStat big label="رسائل مرسلة" value={h.length} tone="gold" sub={`${m30} خلال 30 يوماً`} />
              <BandStat label="وصلت" value={sent} tone="pos" />
              <BandStat label="تعذّرت" value={S('failed')} tone={S('failed') ? 'neg' : undefined} />
              <BandStat label="بدون بريد" value={S('no_email')} sub="أضف بريد العضو من صفحته" />
            </div>
          </div>
        </Band>; })()}
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'new', label: 'رسالة جديدة' }, { key: 'log', label: 'الرسائل المرسلة', count: hist.data?.length }]} />
      <div className="mt-4">{tab === 'new' ? <Composer onSent={() => { hist.reload(); setTab('log'); }} /> : <History h={hist} />}</div>
    </>
  );
}

function Composer({ onSent }: { onSent: () => void }) {
  const toast = useToast();
  const { fund } = useAuth();
  const sb = supabase();
  const members = useData<M[]>(() => q(sb.from('members').select('id, full_name, member_no, email, user_id, contribution_exempt').eq('status', 'active').order('member_no')));
  const users = useData<{ id: string; email: string }[]>(() => q(sb.from('app_users').select('id, email')));
  const bals = useData<Bal[]>(() => q(sb.from('v_member_balances').select('member_id, contributions_overdue, contributions_overdue_months, loan_outstanding')));
  const [kind, setKind] = useState<Kind>('custom');
  const [aud, setAud] = useState<Aud>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(TEMPLATES.custom.body);
  const [notify, setNotify] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const bmap = useMemo(() => new Map((bals.data ?? []).map(b => [b.member_id, b])), [bals.data]);
  const umap = useMemo(() => new Map((users.data ?? []).filter(u => !isLoginAlias(u.email)).map(u => [u.id, u.email])), [users.data]);
  const list = (members.data ?? []).map(m => ({ ...m, mail: (isLoginAlias(m.email) ? null : m.email) || (m.user_id ? umap.get(m.user_id) : null) || null, b: bmap.get(m.id) }));
  const inAud = (m: typeof list[number]) =>
    aud === 'all' ? true : aud === 'arrears' ? num(m.b?.contributions_overdue) > 0 : aud === 'loans' ? num(m.b?.loan_outstanding) > 0 : picked.has(m.id);
  const recipients = list.filter(inAud);
  const withMail = recipients.filter(r => r.mail).length;
  const preview = recipients.find(r => r.id === previewId) ?? recipients[0];
  const fields = (m?: typeof list[number]): Record<string, unknown> => !m ? {} : {
    'الاسم': m.full_name.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0], 'الاسم_الكامل': m.full_name,
    'المتأخرات': m.b?.contributions_overdue ?? 0, 'أشهر_التأخير': m.b?.contributions_overdue_months ?? 0,
    'المتبقي_من_القرض': m.b?.loan_outstanding ?? 0, 'القسط_القادم': null, 'تاريخ_القسط': null, 'الاشتراك_الشهري': fund?.monthly_contribution ?? 200,
  };
  const email = useMemo(() => preview ? buildMessageEmail({ subject: subject || '(بدون عنوان)', body, fields: fields(preview), fund_name: fund?.fund_name ?? 'صندوق النجدي الادخاري',
    portal_url: typeof location !== 'undefined' ? location.href.split('#')[0] : '', banner_src: EMAIL_BANNER_DATA_URI }) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview?.id, subject, body, fund?.fund_name]);

  const useTemplate = (k: Kind) => { setKind(k); setSubject(TEMPLATES[k].subject); setBody(TEMPLATES[k].body); setAud(TEMPLATES[k].aud); };
  const insert = (key: string) => {
    const el = bodyRef.current; const tok = `{${key}}`;
    if (!el) { setBody(body + tok); return; }
    const s = el.selectionStart ?? body.length, e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + tok + body.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + tok.length, s + tok.length); });
  };
  const toggle = (id: string) => { const n = new Set(picked); n.has(id) ? n.delete(id) : n.add(id); setPicked(n); };

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const id = await rpc<string>('create_member_message', { p_kind: kind, p_subject: subject, p_body: body, p_members: recipients.map(r => r.id), p_notify: notify });
      try { toast.ok(mailSummary(await sendMemberMessage(id))); }
      catch (e: any) { toast.err(`حُفظت الرسالة لكن تعذر الإرسال: ${e?.message ?? ''}`); }
      setConfirm(false); onSent();
    } catch (e: any) { setErr(e?.message ?? 'تعذر الإرسال'); }
    finally { setBusy(false); }
  };
  const valid = subject.trim().length >= 2 && body.trim().length >= 2 && recipients.length > 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-4">
        <Card title="نوع الرسالة">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TEMPLATES) as Kind[]).map(k => (
              <button key={k} onClick={() => useTemplate(k)} className={clsx('rounded-full border px-4 py-2 text-sm transition', kind === k ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line hover:border-line-strong')}>{TEMPLATES[k].label}</button>
            ))}
          </div>
        </Card>

        <Card title="المستلمون" subtitle={`${recipients.length} عضو · ${withMail} لديهم بريد${recipients.length > withMail ? ` · ${recipients.length - withMail} بدون بريد (يصلهم إشعار في البوابة فقط)` : ''}`}>
          <div className="mb-3 flex flex-wrap gap-2">
            {([['all', 'الجميع'], ['arrears', 'المتأخرون في الاشتراك'], ['loans', 'عليهم قروض'], ['pick', 'اختيار يدوي']] as [Aud, string][]).map(([k, l]) => (
              <button key={k} onClick={() => { setAud(k); if (k === 'pick' && !picked.size) setPicked(new Set(recipients.map(r => r.id))); }}
                className={clsx('rounded-lg border px-3 py-1.5 text-sm', aud === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-ink-2 hover:border-line-strong')}>{l}</button>
            ))}
          </div>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {list.map(m => {
              const on = inAud(m);
              return (
                <li key={m.id}>
                  <button type="button" disabled={aud !== 'pick'} onClick={() => toggle(m.id)}
                    className={clsx('flex w-full items-center gap-3 px-3 py-2 text-start text-sm', aud === 'pick' && 'hover:bg-canvas', !on && 'opacity-45')}>
                    {on ? <CheckSquare className="size-4 shrink-0 text-brand-600" /> : <Square className="size-4 shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.full_name}</span>
                      <span className="block truncate text-xs text-muted" dir="ltr">{m.mail ?? 'لا يوجد بريد'}</span>
                    </span>
                    {num(m.b?.contributions_overdue) > 0 && <Tag tone="red">متأخرات {sar(m.b?.contributions_overdue)}</Tag>}
                    {num(m.b?.loan_outstanding) > 0 && <span className="hidden sm:inline"><Tag tone="violet">قرض {sar(m.b?.loan_outstanding)}</Tag></span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="نص الرسالة">
          <div className="space-y-3">
            <Field label="العنوان"><Input value={subject} maxLength={150} onChange={e => setSubject(e.target.value)} placeholder="مثال: اجتماع الجمعية العمومية" /></Field>
            <Field label="المحتوى" hint="اترك سطراً فارغاً بين الفقرات">
              <Textarea ref={bodyRef} rows={9} maxLength={5000} value={body} onChange={e => setBody(e.target.value)} />
            </Field>
            <div>
              <div className="mb-1.5 text-xs text-muted">إدراج بيانات العضو (تُستبدل تلقائياً لكل مستلم):</div>
              <div className="flex flex-wrap gap-1.5">
                {MERGE_FIELDS.filter(f => !['القسط_القادم', 'تاريخ_القسط'].includes(f.key)).map(f => (
                  <button key={f.key} type="button" onClick={() => insert(f.key)} className="rounded-md border border-dashed border-line-strong px-2 py-1 text-xs text-ink-2 hover:border-brand-600 hover:text-brand-700">{f.label}</button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={notify} onChange={e => setNotify(e.target.checked)} /><Bell className="size-4 text-muted" />إرسال إشعار في البوابة أيضاً</label>
          </div>
        </Card>
      </div>

      <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <Card title="معاينة" subtitle={preview ? `كما تصل إلى ${preview.full_name}` : 'اختر مستلماً'} pad={false}
          actions={recipients.length > 1 && (
            <select className="max-w-40 rounded-md border border-line bg-surface px-2 py-1 text-xs" value={preview?.id} onChange={e => setPreviewId(e.target.value)}>
              {recipients.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </select>
          )}>
          {email ? <iframe title="معاينة الرسالة" srcDoc={email.html} sandbox="" className="h-[520px] w-full bg-white" /> : <div className="p-6 text-sm text-muted">لا يوجد مستلمون</div>}
          <div className="border-t border-line p-3">
            <ErrorBox>{err}</ErrorBox>
            <Button className="w-full" icon={<Send className="size-4" />} disabled={!valid} onClick={() => setConfirm(true)}>إرسال إلى {recipients.length} عضو</Button>
          </div>
        </Card>
      </div>

      {confirm && (
        <Modal open onClose={() => setConfirm(false)} title="تأكيد الإرسال"
          footer={<><Button loading={busy} icon={<Send className="size-4" />} onClick={send}>إرسال الآن</Button><Button variant="secondary" onClick={() => setConfirm(false)}>إلغاء</Button></>}>
          <p className="text-sm">سيتم إرسال «<b>{subject}</b>» إلى <b className="num">{recipients.length}</b> عضو ({withMail} بالبريد{notify ? ' + إشعار في البوابة' : ''}).</p>
          <ErrorBox>{err}</ErrorBox>
        </Modal>
      )}
    </div>
  );
}

function History({ h }: { h: ReturnType<typeof useData<any[]>> }) {
  const [open, setOpen] = useState<any>(null);
  return (
    <Card pad={false}>
      <ErrorBox>{h.error}</ErrorBox>
      <DataTable rows={h.data ?? []} loading={h.loading} rowKey={r => r.id} empty="لم تُرسل رسائل بعد" onRowClick={setOpen}
        columns={[
          { key: 'created_at', header: 'التاريخ', render: r => <span className="whitespace-nowrap text-xs text-muted">{dateTime(r.created_at)}</span> },
          { key: 'subject', header: 'العنوان', render: r => <span className="font-medium">{r.subject}</span> },
          { key: 'kind', header: 'النوع', render: r => TEMPLATES[r.kind as Kind]?.label ?? 'إعلان' },
          { key: 'recipients', header: 'المستلمون', align: 'end', render: r => <span className="num">{r.recipients}</span> },
          { key: 'st', header: 'البريد', render: r => <span className="flex flex-wrap gap-1">
              {num(r.sent) > 0 && <Tag tone="green">وصل {r.sent}</Tag>}{num(r.failed) > 0 && <Tag tone="red">تعذر {r.failed}</Tag>}
              {num(r.pending) > 0 && <Tag tone="amber">بانتظار {r.pending}</Tag>}{num(r.no_email) > 0 && <Tag>بلا بريد {r.no_email}</Tag>}</span> },
        ]} />
      {open && <Recipients msg={open} onClose={() => { setOpen(null); h.reload(); }} />}
    </Card>
  );
}

function Recipients({ msg, onClose }: { msg: any; onClose: () => void }) {
  const toast = useToast();
  const r = useData<any[]>(() => q(supabase().from('member_message_recipients').select('*, members(full_name)').eq('message_id', msg.id)), [msg.id]);
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try { toast.ok(mailSummary(await sendMemberMessage(msg.id, true))); r.reload(); } catch (e: any) { toast.err(e?.message ?? 'تعذر الإرسال'); } finally { setBusy(false); }
  };
  const tone: Record<string, any> = { sent: 'green', failed: 'red', pending: 'amber', no_email: 'neutral' };
  const lbl: Record<string, string> = { sent: 'وصل', failed: 'تعذر', pending: 'بانتظار الإرسال', no_email: 'لا يوجد بريد' };
  return (
    <Modal open wide onClose={onClose} title={msg.subject}
      footer={(num(msg.failed) > 0 || num(msg.pending) > 0) ? <Button icon={<RotateCcw className="size-4" />} loading={busy} onClick={retry}>إعادة المحاولة لمن لم يصله</Button> : undefined}>
      <p className="whitespace-pre-line rounded-lg bg-canvas p-3 text-sm text-ink-2">{msg.body}</p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {(r.data ?? []).map(x => (
          <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <Mail className="size-4 text-muted" />
            <span className="min-w-0 flex-1 truncate">{x.members?.full_name} <span className="text-xs text-muted" dir="ltr">{x.email}</span></span>
            <span title={x.error ?? ''}><Tag tone={tone[x.status]}>{lbl[x.status]}</Tag></span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
