'use client';
import { useMemo, useState } from 'react';
import { Copy, Eye, FileText, Mail, MailCheck, MessageCircle, Send, Settings2 } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { Band } from '@/components/admin-viz';
import { useAction } from '@/lib/action';
import { useSettings } from '@/lib/settings';
import { dateTime, firstOfMonth, monthLabel, num, sar } from '@/lib/format';
import { Button, Card, DataTable, ErrorBox, Field, Input, Modal, Notice, PageHeader, Stat, Tag, Textarea, useToast } from '@/components/ui';
import { MonthlyReportView, reportText, waLink, type ReportRow } from '@/components/monthly-report';
import { buildReportEmail } from '@/lib/report-email';
import { EMAIL_BANNER_DATA_URI } from '@/lib/email-banner';
import { mailSummary, sendReportEmails } from '@/lib/report-mail';

type M = { id: string; full_name: string; member_no: string; phone: string | null; email: string | null; join_date: string };

export default function MonthlyReportsAdmin() {
  const toast = useToast();
  const settings = useSettings();
  const [period, setPeriod] = useState(firstOfMonth(-1));
  const members = useData<M[]>(() => q(supabase().from('members').select('id, full_name, member_no, phone, email, join_date').eq('status', 'active').order('member_no')));
  const reports = useData<ReportRow[]>(() => q(supabase().from('monthly_reports').select('*').eq('period', period)), [period]);
  const history = useData<{ period: string }[]>(() => q(supabase().from('monthly_reports').select('period').order('period', { ascending: false })));
  const [issue, setIssue] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const [view, setView] = useState<ReportRow | null>(null);
  const [preview, setPreview] = useState<{ r: ReportRow; name: string; email: string | null } | null>(null);
  const [mailing, setMailing] = useState<string | null>(null);

  const byMember = useMemo(() => new Map((reports.data ?? []).map(r => [r.member_id, r])), [reports.data]);
  const periodEnd = useMemo(() => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }, [period]);
  const rows = (members.data ?? []).filter(m => m.join_date <= periodEnd).map(m => ({ ...m, r: byMember.get(m.id) }));
  const issued = rows.filter(x => x.r).length, read = rows.filter(x => x.r?.read_at).length;
  const arrears = rows.filter(x => num(x.r?.report.contribution?.arrears_months) > 0).length;
  const months = useMemo(() => Array.from(new Set((history.data ?? []).map(h => h.period))).slice(0, 12), [history.data]);
  const thisMonth = firstOfMonth(0);
  const emailed = rows.filter(x => x.r?.emailed_at).length;
  const pendingMail = rows.filter(x => x.r && !x.r.emailed_at).length;

  const mail = async (key: string, body: { period?: string; ids?: string[]; resend?: boolean }) => {
    setMailing(key);
    try { toast.ok(mailSummary(await sendReportEmails(body))); reports.reload(); }
    catch (e: any) { toast.err(e?.message ?? 'تعذر الإرسال'); }
    finally { setMailing(null); }
  };

  const copy = (r: ReportRow) => navigator.clipboard.writeText(reportText(r)).then(() => toast.ok('تم نسخ نص التقرير'), () => toast.err('تعذر النسخ'));

  return (
    <>
      <PageHeader title="التقارير الشهرية للأعضاء" subtitle="ملخص حساب لكل عضو يصل إلى بريده الإلكتروني الشخصي وإلى البوابة مع إشعار، ويمكن إرساله واتساب"
        actions={<>
          <Button variant="secondary" icon={<Settings2 className="size-4" />} onClick={() => setPrefs(true)}>الإصدار التلقائي</Button>
          {issued > 0 && <Button variant="secondary" icon={<Mail className="size-4" />} loading={mailing === 'all'} disabled={!pendingMail}
            onClick={() => mail('all', { period })}>{pendingMail ? `إرسال البريد (${pendingMail})` : 'أُرسل البريد للجميع'}</Button>}
          <Button icon={<Send className="size-4" />} onClick={() => setIssue(true)}>{issued ? 'إعادة إصدار الشهر' : 'إصدار تقارير الشهر'}</Button>
        </>} />
      <ErrorBox>{members.error ?? reports.error}</ErrorBox>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="الشهر"><Input type="month" dir="ltr" value={period.slice(0, 7)} max={thisMonth.slice(0, 7)} onChange={e => e.target.value && setPeriod(`${e.target.value}-01`)} /></Field>
        <div className="flex flex-wrap gap-1.5 pb-1">
          {months.map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`rounded-full border px-3 py-1 text-xs ${p === period ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-muted hover:border-line-strong'}`}>{monthLabel(p)}</button>
          ))}
        </div>
      </div>

      {settings.data && (
        <div className="mb-4">
          <Notice tone={settings.data.monthly_report_auto ? 'brand' : 'gold'}>
            {settings.data.monthly_report_auto
              ? `الإصدار التلقائي مفعّل: تصدر تقارير الشهر المنتهي صباح يوم 1 من كل شهر، ويصل كل عضو إشعار${settings.data.monthly_report_email ? ' ونسخة على بريده الإلكتروني' : ' (الإرسال بالبريد متوقف)'}.`
              : 'الإصدار التلقائي متوقف — أصدر التقارير يدوياً من زر «إصدار تقارير الشهر».'}
          </Notice>
        </div>
      )}

      <Band>
        <div className="mb-3 text-xs text-brand-200">رحلة تقرير {monthLabel(period)} — من الإصدار إلى القراءة</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'الأعضاء المشمولون', v: rows.length, of: rows.length, icon: <FileText className="size-4" /> },
            { label: 'صدر لهم التقرير', v: issued, of: rows.length, icon: <Send className="size-4" /> },
            { label: 'وصلهم بالبريد', v: emailed, of: rows.length, icon: <MailCheck className="size-4" /> },
            { label: 'قرأوه في البوابة', v: read, of: rows.length, icon: <FileText className="size-4" /> },
          ].map((st, i) => <div key={st.label} className="relative rounded-xl bg-white/5 p-3">
            <div className="flex items-center gap-1.5 text-xs text-brand-200">{st.icon}{st.label}</div>
            <div className="mt-1 text-2xl font-semibold num-cell">{st.v}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gold-300" style={{ width: `${st.of ? (st.v / st.of) * 100 : 0}%` }} /></div>
            {i < 3 && <span className="absolute -start-2.5 top-1/2 hidden -translate-y-1/2 text-gold-300 sm:block">‹</span>}
          </div>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {pendingMail > 0 && <span className="rounded-full bg-white/10 px-3 py-1">{pendingMail} بانتظار الإرسال بالبريد</span>}
          <span className={`rounded-full px-3 py-1 ${arrears ? 'bg-[#f0b59c]/20 text-[#f0b59c]' : 'bg-white/10'}`}>لديهم متأخرات: <b className="num">{arrears}</b></span>
        </div>
      </Band>

      <Card pad={false}>
        <DataTable rows={rows} loading={members.loading || reports.loading} rowKey={r => r.id} searchable={r => `${r.full_name} ${r.member_no}`}
          empty={`لا يوجد أعضاء نشطون في ${monthLabel(period)}`}
          columns={[
            { key: 'member_no', header: 'رقم العضو', render: r => <span className="num text-xs text-muted">{r.member_no}</span> },
            { key: 'full_name', header: 'العضو', render: r => <span className="font-medium">{r.full_name}</span> },
            { key: 'status', header: 'التقرير', render: r => !r.r ? <Tag>لم يصدر</Tag> : r.r.read_at ? <Tag tone="green">قُرئ</Tag> : <Tag tone="amber">لم يُقرأ</Tag> },
            { key: 'email', header: 'البريد', render: r => !r.r ? '—' : r.r.emailed_at
                ? <span title={`${r.r.email_to ?? ''} · ${dateTime(r.r.emailed_at)}`}><Tag tone="green">وصل</Tag></span>
                : r.r.email_error ? <span title={r.r.email_error}><Tag tone="red">تعذر</Tag></span> : <Tag>لم يُرسل</Tag> },
            { key: 'month', header: 'اشتراك الشهر', render: r => r.r?.report.contribution?.month ? <span className="text-xs">{num(r.r.report.contribution.month.outstanding) > 0 ? <span className="text-neg">متبقي {sar(r.r.report.contribution.month.outstanding)}</span> : <span className="text-pos">مسدد</span>}</span> : '—' },
            { key: 'net', header: 'صافي المركز', align: 'end', render: r => r.r ? sar(r.r.report.net_position) : '—', sortValue: r => num(r.r?.report.net_position) },
            { key: 'when', header: 'آخر إصدار', render: r => r.r ? <span className="text-xs text-muted">{dateTime(r.r.created_at)}</span> : '—' },
            { key: 'act', header: '', render: r => r.r && (
              <div className="flex justify-end gap-1">
                <IconBtn label="عرض التقرير" onClick={() => setView(r.r!)}><Eye className="size-4" /></IconBtn>
                <IconBtn label="معاينة البريد" onClick={() => setPreview({ r: r.r!, name: r.full_name, email: r.email })}><Mail className="size-4" /></IconBtn>
                <IconBtn label={r.r.emailed_at ? 'إعادة الإرسال بالبريد' : 'إرسال بالبريد'} onClick={() => mail(r.r!.id, { ids: [r.r!.id], resend: true })}>
                  {mailing === r.r.id ? <span className="block size-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> : <Send className="size-4" />}</IconBtn>
                <IconBtn label="نسخ النص" onClick={() => copy(r.r!)}><Copy className="size-4" /></IconBtn>
                {(() => { const href = waLink(r.phone, reportText(r.r!)); return href
                  ? <a href={href} target="_blank" rel="noreferrer" title="إرسال واتساب" aria-label="إرسال واتساب" className="rounded-md p-1.5 text-[#1f8a4c] hover:bg-[#e8f5ee]"><MessageCircle className="size-4" /></a>
                  : <span title="لا يوجد رقم جوال" className="p-1.5 text-line-strong"><MessageCircle className="size-4" /></span>; })()}
              </div>) },
          ]} />
      </Card>

      {preview && <EmailPreview row={preview.r} name={preview.name} email={preview.email} onClose={() => setPreview(null)} />}
      {issue && <IssueModal email={!!settings.data?.monthly_report_email} period={period} already={issued} defaultNote={(reports.data ?? []).find(r => r.note)?.note ?? settings.data?.monthly_report_note ?? ''} onClose={done => { setIssue(false); if (done) { reports.reload(); history.reload(); } }} />}
      {prefs && settings.data && <PrefsModal email={settings.data.monthly_report_email} auto={settings.data.monthly_report_auto} note={settings.data.monthly_report_note ?? ''} onClose={done => { setPrefs(false); if (done) settings.reload(); }} />}
      {view && (
        <Modal open wide onClose={() => setView(null)} title={`تقرير ${view.report.member?.full_name}`}
          footer={<Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => copy(view)}>نسخ نص واتساب</Button>}>
          <MonthlyReportView row={view} />
        </Modal>
      )}
    </>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button title={label} aria-label={label} onClick={onClick} className="rounded-md p-1.5 text-muted hover:bg-brand-50 hover:text-brand-700">{children}</button>;
}

function IssueModal({ period, already, defaultNote, email, onClose }: { period: string; already: number; defaultNote: string; email: boolean; onClose: (done: boolean) => void }) {
  const a = useAction();
  const toast = useToast();
  const [note, setNote] = useState(defaultNote);
  const [notify, setNotify] = useState(true);
  const [mail, setMail] = useState(email);
  const run = async () => {
    const n = await a.run(() => rpc('issue_monthly_reports', { p_period: period, p_note: note, p_notify: notify }), 'تم إصدار التقارير');
    if (n === undefined || n === null) return;
    if (mail) {
      try { toast.ok(mailSummary(await sendReportEmails({ period, resend: already > 0 }))); }
      catch (e: any) { toast.err(`صدرت التقارير لكن تعذر إرسال البريد: ${e?.message ?? ''}`); }
    }
    onClose(true);
  };
  return (
    <Modal open onClose={() => onClose(false)} title={`إصدار تقارير ${monthLabel(period)}`}
      footer={<><Button onClick={run} loading={a.busy} icon={<Send className="size-4" />}>إصدار الآن</Button><Button variant="ghost" onClick={() => onClose(false)}>إلغاء</Button></>}>
      <ErrorBox>{a.error}</ErrorBox>
      {already > 0 && <Notice tone="gold">صدر <span className="num">{already}</span> تقرير لهذا الشهر سابقاً — إعادة الإصدار تحدّث الأرقام والملاحظة دون تكرار الإشعار.</Notice>}
      <p className="text-sm text-ink-2">يُنشأ تقرير لكل عضو نشط بأرصدته حتى نهاية الشهر وحركاته خلاله، ويظهر في صفحة «تقاريري الشهرية».</p>
      <Field label="كلمة للأعضاء (اختياري)" hint="تظهر أسفل كل تقرير"><Textarea rows={3} maxLength={600} value={note} onChange={e => setNote(e.target.value)} placeholder="شكراً لالتزامكم…" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={notify} onChange={e => setNotify(e.target.checked)} />إرسال إشعار لكل عضو في البوابة</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={mail} onChange={e => setMail(e.target.checked)} />إرسال التقرير إلى البريد الإلكتروني الشخصي لكل عضو{already > 0 ? ' (يُعاد الإرسال لمن وصله)' : ''}</label>
    </Modal>
  );
}

function PrefsModal({ auto, note, email, onClose }: { auto: boolean; note: string; email: boolean; onClose: (done: boolean) => void }) {
  const a = useAction();
  const [v, setV] = useState(auto);
  const [m, setM] = useState(email);
  const [n, setN] = useState(note);
  const save = async () => { if (await a.run(() => rpc('set_monthly_report_prefs', { p_auto: v, p_note: n, p_email: m }).then(() => true), 'تم حفظ الإعدادات')) onClose(true); };
  return (
    <Modal open onClose={() => onClose(false)} title="الإصدار التلقائي"
      footer={<><Button onClick={save} loading={a.busy}>حفظ</Button><Button variant="ghost" onClick={() => onClose(false)}>إلغاء</Button></>}>
      <ErrorBox>{a.error}</ErrorBox>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={v} onChange={e => setV(e.target.checked)} />إصدار تقارير الشهر المنتهي تلقائياً يوم 1 من كل شهر (7 صباحاً)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={m} onChange={e => setM(e.target.checked)} />إرسال كل تقرير إلى البريد الإلكتروني الشخصي للعضو</label>
      <Field label="الكلمة الافتراضية في التقارير التلقائية"><Textarea rows={3} maxLength={600} value={n} onChange={e => setN(e.target.value)} /></Field>
    </Modal>
  );
}

function EmailPreview({ row, name, email, onClose }: { row: ReportRow; name: string; email: string | null; onClose: () => void }) {
  const m = useMemo(() => buildReportEmail({
    id: row.id, report: row.report, note: row.note, member_name: name, banner_src: EMAIL_BANNER_DATA_URI,
    portal_url: typeof location !== 'undefined' ? location.href.split('#')[0] : '',
  }), [row, name]);
  return (
    <Modal open wide onClose={onClose} title="معاينة البريد">
      <div className="space-y-1 rounded-lg bg-canvas px-3 py-2 text-sm">
        <div><span className="text-muted">إلى: </span><span dir="ltr">{row.email_to ?? email ?? 'لا يوجد بريد مسجل'}</span></div>
        <div><span className="text-muted">الموضوع: </span>{m.subject}</div>
        {row.emailed_at && <div className="text-xs text-pos">وصل في {dateTime(row.emailed_at)}</div>}
        {row.email_error && <div className="text-xs text-neg">آخر محاولة: {row.email_error}</div>}
      </div>
      <iframe title="معاينة البريد" srcDoc={m.html} sandbox="" className="h-[70vh] w-full rounded-lg border border-line bg-white" />
    </Modal>
  );
}
