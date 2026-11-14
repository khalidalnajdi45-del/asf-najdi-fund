'use client';
import { useMemo, useState } from 'react';
import { Copy, Eye, FileText, MessageCircle, Send, Settings2 } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { useSettings } from '@/lib/settings';
import { dateTime, firstOfMonth, monthLabel, num, sar } from '@/lib/format';
import { Button, Card, DataTable, ErrorBox, Field, Input, Modal, Notice, PageHeader, Stat, Tag, Textarea, useToast } from '@/components/ui';
import { MonthlyReportView, reportText, waLink, type ReportRow } from '@/components/monthly-report';

type M = { id: string; full_name: string; member_no: string; phone: string | null; join_date: string };

export default function MonthlyReportsAdmin() {
  const toast = useToast();
  const settings = useSettings();
  const [period, setPeriod] = useState(firstOfMonth(-1));
  const members = useData<M[]>(() => q(supabase().from('members').select('id, full_name, member_no, phone, join_date').eq('status', 'active').order('member_no')));
  const reports = useData<ReportRow[]>(() => q(supabase().from('monthly_reports').select('*').eq('period', period)), [period]);
  const history = useData<{ period: string }[]>(() => q(supabase().from('monthly_reports').select('period').order('period', { ascending: false })));
  const [issue, setIssue] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const [view, setView] = useState<ReportRow | null>(null);

  const byMember = useMemo(() => new Map((reports.data ?? []).map(r => [r.member_id, r])), [reports.data]);
  const periodEnd = useMemo(() => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }, [period]);
  const rows = (members.data ?? []).filter(m => m.join_date <= periodEnd).map(m => ({ ...m, r: byMember.get(m.id) }));
  const issued = rows.filter(x => x.r).length, read = rows.filter(x => x.r?.read_at).length;
  const arrears = rows.filter(x => num(x.r?.report.contribution?.arrears_months) > 0).length;
  const months = useMemo(() => Array.from(new Set((history.data ?? []).map(h => h.period))).slice(0, 12), [history.data]);
  const thisMonth = firstOfMonth(0);

  const copy = (r: ReportRow) => navigator.clipboard.writeText(reportText(r)).then(() => toast.ok('تم نسخ نص التقرير'), () => toast.err('تعذر النسخ'));

  return (
    <>
      <PageHeader title="التقارير الشهرية للأعضاء" subtitle="ملخص حساب لكل عضو يصله في البوابة مع إشعار، ويمكن إرساله واتساب"
        actions={<>
          <Button variant="secondary" icon={<Settings2 className="size-4" />} onClick={() => setPrefs(true)}>الإصدار التلقائي</Button>
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
              ? 'الإصدار التلقائي مفعّل: تصدر تقارير الشهر المنتهي لجميع الأعضاء صباح يوم 1 من كل شهر، ويصل كل عضو إشعار.'
              : 'الإصدار التلقائي متوقف — أصدر التقارير يدوياً من زر «إصدار تقارير الشهر».'}
          </Notice>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="الأعضاء المشمولون" value={rows.length} icon={<FileText className="size-4" />} />
        <Stat label="صدر لهم تقرير" value={issued} tone="brand" />
        <Stat label="اطّلعوا عليه" value={read} hint={issued ? `${Math.round((read / issued) * 100)}% من المُصدر` : undefined} tone="pos" />
        <Stat label="لديهم متأخرات" value={arrears} tone={arrears ? 'neg' : 'neutral'} />
      </div>

      <Card pad={false}>
        <DataTable rows={rows} loading={members.loading || reports.loading} rowKey={r => r.id} searchable={r => `${r.full_name} ${r.member_no}`}
          empty={`لا يوجد أعضاء نشطون في ${monthLabel(period)}`}
          columns={[
            { key: 'member_no', header: 'رقم العضو', render: r => <span className="num text-xs text-muted">{r.member_no}</span> },
            { key: 'full_name', header: 'العضو', render: r => <span className="font-medium">{r.full_name}</span> },
            { key: 'status', header: 'التقرير', render: r => !r.r ? <Tag>لم يصدر</Tag> : r.r.read_at ? <Tag tone="green">قُرئ</Tag> : <Tag tone="amber">لم يُقرأ</Tag> },
            { key: 'month', header: 'اشتراك الشهر', render: r => r.r?.report.contribution?.month ? <span className="text-xs">{num(r.r.report.contribution.month.outstanding) > 0 ? <span className="text-neg">متبقي {sar(r.r.report.contribution.month.outstanding)}</span> : <span className="text-pos">مسدد</span>}</span> : '—' },
            { key: 'net', header: 'صافي المركز', align: 'end', render: r => r.r ? sar(r.r.report.net_position) : '—', sortValue: r => num(r.r?.report.net_position) },
            { key: 'when', header: 'آخر إصدار', render: r => r.r ? <span className="text-xs text-muted">{dateTime(r.r.created_at)}</span> : '—' },
            { key: 'act', header: '', render: r => r.r && (
              <div className="flex justify-end gap-1">
                <IconBtn label="عرض التقرير" onClick={() => setView(r.r!)}><Eye className="size-4" /></IconBtn>
                <IconBtn label="نسخ النص" onClick={() => copy(r.r!)}><Copy className="size-4" /></IconBtn>
                {(() => { const href = waLink(r.phone, reportText(r.r!)); return href
                  ? <a href={href} target="_blank" rel="noreferrer" title="إرسال واتساب" aria-label="إرسال واتساب" className="rounded-md p-1.5 text-[#1f8a4c] hover:bg-[#e8f5ee]"><MessageCircle className="size-4" /></a>
                  : <span title="لا يوجد رقم جوال" className="p-1.5 text-line-strong"><MessageCircle className="size-4" /></span>; })()}
              </div>) },
          ]} />
      </Card>

      {issue && <IssueModal period={period} already={issued} defaultNote={(reports.data ?? []).find(r => r.note)?.note ?? settings.data?.monthly_report_note ?? ''} onClose={done => { setIssue(false); if (done) { reports.reload(); history.reload(); } }} />}
      {prefs && settings.data && <PrefsModal auto={settings.data.monthly_report_auto} note={settings.data.monthly_report_note ?? ''} onClose={done => { setPrefs(false); if (done) settings.reload(); }} />}
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

function IssueModal({ period, already, defaultNote, onClose }: { period: string; already: number; defaultNote: string; onClose: (done: boolean) => void }) {
  const a = useAction();
  const [note, setNote] = useState(defaultNote);
  const [notify, setNotify] = useState(true);
  const run = async () => {
    const n = await a.run(() => rpc('issue_monthly_reports', { p_period: period, p_note: note, p_notify: notify }), 'تم إصدار التقارير');
    if (n !== undefined && n !== null) onClose(true);
  };
  return (
    <Modal open onClose={() => onClose(false)} title={`إصدار تقارير ${monthLabel(period)}`}
      footer={<><Button onClick={run} loading={a.busy} icon={<Send className="size-4" />}>إصدار الآن</Button><Button variant="ghost" onClick={() => onClose(false)}>إلغاء</Button></>}>
      <ErrorBox>{a.error}</ErrorBox>
      {already > 0 && <Notice tone="gold">صدر <span className="num">{already}</span> تقرير لهذا الشهر سابقاً — إعادة الإصدار تحدّث الأرقام والملاحظة دون تكرار الإشعار.</Notice>}
      <p className="text-sm text-ink-2">يُنشأ تقرير لكل عضو نشط بأرصدته حتى نهاية الشهر وحركاته خلاله، ويظهر في صفحة «تقاريري الشهرية».</p>
      <Field label="كلمة للأعضاء (اختياري)" hint="تظهر أسفل كل تقرير"><Textarea rows={3} maxLength={600} value={note} onChange={e => setNote(e.target.value)} placeholder="شكراً لالتزامكم…" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={notify} onChange={e => setNotify(e.target.checked)} />إرسال إشعار لكل عضو</label>
    </Modal>
  );
}

function PrefsModal({ auto, note, onClose }: { auto: boolean; note: string; onClose: (done: boolean) => void }) {
  const a = useAction();
  const [v, setV] = useState(auto);
  const [n, setN] = useState(note);
  const save = async () => { if (await a.run(() => rpc('set_monthly_report_prefs', { p_auto: v, p_note: n }).then(() => true), 'تم حفظ الإعدادات')) onClose(true); };
  return (
    <Modal open onClose={() => onClose(false)} title="الإصدار التلقائي"
      footer={<><Button onClick={save} loading={a.busy}>حفظ</Button><Button variant="ghost" onClick={() => onClose(false)}>إلغاء</Button></>}>
      <ErrorBox>{a.error}</ErrorBox>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={v} onChange={e => setV(e.target.checked)} />إصدار تقارير الشهر المنتهي تلقائياً يوم 1 من كل شهر (7 صباحاً)</label>
      <Field label="الكلمة الافتراضية في التقارير التلقائية"><Textarea rows={3} maxLength={600} value={n} onChange={e => setN(e.target.value)} /></Field>
    </Modal>
  );
}
