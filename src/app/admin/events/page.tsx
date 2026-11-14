'use client';
import { useMemo, useState } from 'react';
import { CalendarPlus, Pencil, Users, XCircle } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { formatEventDate, THEMES, type EventKind } from '@/lib/invitation';
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Tabs, Tag, Textarea } from '@/components/ui';
import { countdown, InvitationCanvas, isPast, kindLabel, rsvpLabels, ShareBar, ThemePicker, toInvitation, type EventRow } from '@/components/events';

type Draft = {
  kind: EventKind; title: string; message: string; event_date: string; start_time: string; location: string;
  location_url: string; host: string; rsvp_enabled: boolean; notify: boolean;
};
const blank = (k: EventKind = 'eid'): Draft => ({
  kind: k, title: THEMES[k].title, message: THEMES[k].message, event_date: '', start_time: '', location: '', location_url: '', host: '', rsvp_enabled: true, notify: true,
});

export default function EventsAdmin() {
  const { fund } = useAuth();
  const list = useData<EventRow[]>(() => q(supabase().from('v_event_summary').select('*').order('event_date', { ascending: false })));
  const [tab, setTab] = useState('upcoming');
  const [edit, setEdit] = useState<{ id?: string; d: Draft } | null>(null);
  const [view, setView] = useState<EventRow | null>(null);

  const groups = useMemo(() => {
    const all = list.data ?? [];
    const upcoming = all.filter(e => e.status === 'active' && !isPast(e.event_date)).sort((a, b) => a.event_date.localeCompare(b.event_date));
    const past = all.filter(e => e.status === 'cancelled' || isPast(e.event_date));
    return { upcoming, past };
  }, [list.data]);

  if (edit) return <Editor init={edit} fundName={fund?.fund_name} onClose={saved => { setEdit(null); if (saved) list.reload(); }} />;

  const shown = tab === 'upcoming' ? groups.upcoming : groups.past;
  return (
    <>
      <PageHeader title="المناسبات والدعوات" subtitle="صمّم دعوة للعيد أو رمضان أو طلعة بحرية أو برية، وتابع ردود الأعضاء"
        actions={<Button icon={<CalendarPlus className="size-4" />} onClick={() => setEdit({ d: blank() })}>دعوة جديدة</Button>} />
      <ErrorBox>{list.error}</ErrorBox>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'upcoming', label: 'القادمة', count: groups.upcoming.length }, { key: 'past', label: 'السابقة والملغاة', count: groups.past.length }]} />
      {list.loading && !list.data ? <Loading /> : shown.length === 0 ? (
        <Card><Empty>{tab === 'upcoming' ? 'لا توجد مناسبات قادمة — ابدأ بتصميم دعوة جديدة' : 'لا توجد مناسبات سابقة'}</Empty></Card>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(e => <EventCard key={e.id} e={e} fundName={fund?.fund_name} onOpen={() => setView(e)} />)}
        </div>
      )}
      {view && <Detail e={view} fundName={fund?.fund_name} onClose={() => setView(null)} onChanged={() => { setView(null); list.reload(); }}
        onEdit={() => { const e = view; setView(null); setEdit({ id: e.id, d: { kind: e.kind, title: e.title, message: e.message ?? '', event_date: e.event_date, start_time: e.start_time ?? '', location: e.location ?? '', location_url: e.location_url ?? '', host: e.host ?? '', rsvp_enabled: e.rsvp_enabled, notify: false } }); }} />}
    </>
  );
}

function EventCard({ e, fundName, onOpen }: { e: EventRow; fundName?: string | null; onOpen: () => void }) {
  const { greg } = formatEventDate(e.event_date);
  const past = isPast(e.event_date);
  return (
    <button onClick={onOpen} className="group overflow-hidden rounded-xl border border-line bg-surface text-start transition hover:border-gold-500 hover:shadow-md">
      <div className="relative bg-canvas p-3"><InvitationCanvas data={toInvitation(e, fundName)} className="shadow-none" /></div>
      <div className="space-y-2 border-t border-line px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-semibold text-ink">{e.title}</h3>
          {e.status === 'cancelled' ? <Tag tone="red">ملغاة</Tag> : past ? <Tag>انتهت</Tag> : <Tag tone="violet">{countdown(e.event_date)}</Tag>}
        </div>
        <div className="text-xs text-muted">{kindLabel(e.kind)} · {greg}</div>
        {e.rsvp_enabled && (
          <div className="flex gap-3 text-xs">
            <span className="text-pos">سأحضر <b className="num">{e.yes_count}</b></span>
            <span className="text-gold-700">ربما <b className="num">{e.maybe_count}</b></span>
            <span className="text-muted">أعتذر <b className="num">{e.no_count}</b></span>
            <span className="ms-auto inline-flex items-center gap-1 text-ink-2"><Users className="size-3.5" />الحضور المتوقع <b className="num">{e.expected_attendance}</b></span>
          </div>
        )}
      </div>
    </button>
  );
}

function Editor({ init, fundName, onClose }: { init: { id?: string; d: Draft }; fundName?: string | null; onClose: (saved: boolean) => void }) {
  const a = useAction();
  const [d, setD] = useState<Draft>(init.d);
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const pickKind = (k: EventKind) => {
    // swap the template wording only if the manager hasn't customised it
    const t = THEMES[d.kind];
    set({ kind: k, title: d.title === t.title || !d.title ? THEMES[k].title : d.title, message: d.message === t.message || !d.message ? THEMES[k].message : d.message });
  };
  const save = async () => {
    const p = { ...d };
    const ok = await a.run(() => (init.id ? rpc('update_event', { p_id: init.id, p }) : rpc('create_event', { p })).then(() => true),
      init.id ? 'تم تحديث الدعوة' : d.notify ? 'تم نشر الدعوة وإشعار جميع الأعضاء' : 'تم حفظ الدعوة');
    if (ok) onClose(true);
  };
  return (
    <>
      <PageHeader title={init.id ? 'تعديل الدعوة' : 'دعوة جديدة'} subtitle="اختر القالب وعدّل النص — المعاينة تتحدث مباشرة"
        actions={<><Button variant="secondary" onClick={() => onClose(false)}>إلغاء</Button><Button onClick={save} loading={a.busy} disabled={!d.title.trim() || !d.event_date}>{init.id ? 'حفظ التعديلات' : 'نشر الدعوة'}</Button></>} />
      <ErrorBox>{a.error}</ErrorBox>
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Card title="نوع المناسبة"><ThemePicker value={d.kind} onChange={pickKind} /></Card>
          <Card title="تفاصيل الدعوة">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="عنوان الدعوة" className="sm:col-span-2"><Input value={d.title} maxLength={80} onChange={e => set({ title: e.target.value })} /></Field>
              <Field label="نص الدعوة" className="sm:col-span-2" hint={`${d.message.length}/400`}><Textarea rows={3} maxLength={400} value={d.message} onChange={e => set({ message: e.target.value })} /></Field>
              <Field label="التاريخ"><Input type="date" dir="ltr" value={d.event_date} onChange={e => set({ event_date: e.target.value })} /></Field>
              <Field label="الوقت" hint="مثال: بعد صلاة العصر · ٧:٣٠ مساءً"><Input value={d.start_time} maxLength={40} onChange={e => set({ start_time: e.target.value })} /></Field>
              <Field label="المكان"><Input value={d.location} maxLength={120} placeholder="استراحة العائلة — الحريق" onChange={e => set({ location: e.target.value })} /></Field>
              <Field label="رابط الموقع (اختياري)"><Input dir="ltr" value={d.location_url} placeholder="https://maps.app.goo.gl/…" onChange={e => set({ location_url: e.target.value })} /></Field>
              <Field label="الداعي (اختياري)"><Input value={d.host} maxLength={80} placeholder="أبناء فلان النجدي" onChange={e => set({ host: e.target.value })} /></Field>
              <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand-600" checked={d.rsvp_enabled} onChange={e => set({ rsvp_enabled: e.target.checked })} />طلب تأكيد الحضور من الأعضاء</label>
                {!init.id && <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand-600" checked={d.notify} onChange={e => set({ notify: e.target.checked })} />إرسال إشعار لجميع الأعضاء</label>}
              </div>
            </div>
          </Card>
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 text-xs font-medium text-muted">المعاينة</div>
          <InvitationCanvas data={toInvitation({ ...d, event_date: d.event_date || new Date().toISOString().slice(0, 10) }, fundName)} />
          {!d.event_date && <p className="mt-2 text-xs text-muted">حدد التاريخ — المعاينة تعرض تاريخ اليوم مؤقتاً</p>}
        </div>
      </div>
    </>
  );
}

type Rsvp = { id: string; member_id: string; response: string; guests: number; note: string | null; updated_at: string; members: { full_name: string; member_no: string } | null };

function Detail({ e, fundName, onClose, onEdit, onChanged }: { e: EventRow; fundName?: string | null; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const a = useAction();
  const rs = useData<Rsvp[]>(() => q(supabase().from('event_rsvps').select('*, members(full_name, member_no)').eq('event_id', e.id).order('updated_at', { ascending: false })), [e.id]);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const { greg, hijri } = formatEventDate(e.event_date);
  const editable = e.status === 'active' && !isPast(e.event_date);
  const cancel = async () => { if (await a.run(() => rpc('cancel_event', { p_id: e.id, p_note: note }).then(() => true), 'تم إلغاء المناسبة وإشعار الأعضاء')) onChanged(); };
  return (
    <Modal open wide onClose={onClose} title={e.title}
      footer={editable ? (confirm ? (
        <div className="flex w-full flex-wrap items-center gap-2">
          <Input className="min-w-0 flex-1" placeholder="سبب الإلغاء (يُرسل للأعضاء)" value={note} onChange={x => setNote(x.target.value)} />
          <Button variant="danger" loading={a.busy} onClick={cancel}>تأكيد الإلغاء</Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>تراجع</Button>
        </div>
      ) : (<>
        <Button icon={<Pencil className="size-4" />} onClick={onEdit}>تعديل</Button>
        <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setConfirm(true)}>إلغاء المناسبة</Button>
      </>)) : undefined}>
      <ErrorBox>{a.error}</ErrorBox>
      <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
        <InvitationCanvas data={toInvitation(e, fundName)} />
        <div className="min-w-0 space-y-3 text-sm">
          <div className="text-muted">{kindLabel(e.kind)} · {greg}{hijri ? ` · ${hijri}` : ''}{e.start_time ? ` · ${e.start_time}` : ''}</div>
          {e.location && <div>📍 {e.location}</div>}
          <ShareBar e={e} fundName={fundName} />
          {e.rsvp_enabled && (
            <div className="grid grid-cols-4 gap-2 rounded-lg bg-canvas p-3 text-center">
              {[['سأحضر', e.yes_count, 'text-pos'], ['ربما', e.maybe_count, 'text-gold-700'], ['أعتذر', e.no_count, 'text-muted'], ['مرافقين', e.guests_count, 'text-ink']].map(([l, v, c]) => (
                <div key={l as string}><div className={`text-xl font-semibold num ${c}`}>{v as number}</div><div className="text-[11px] text-muted">{l as string}</div></div>
              ))}
            </div>
          )}
        </div>
      </div>
      {e.rsvp_enabled && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">ردود الأعضاء <span className="font-normal text-muted">· الحضور المتوقع <span className="num">{e.expected_attendance}</span></span></h4>
          {rs.loading && !rs.data ? <Loading /> : !rs.data?.length ? <p className="text-sm text-muted">لم يرد أحد بعد</p> : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {rs.data.map(r => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{r.members?.full_name ?? '—'}{r.note && <span className="block truncate text-xs text-muted">{r.note}</span>}</span>
                  {r.response === 'yes' && r.guests > 0 && <span className="text-xs text-muted">+<span className="num">{r.guests}</span> مرافق</span>}
                  <Tag tone={r.response === 'yes' ? 'green' : r.response === 'maybe' ? 'amber' : 'neutral'}>{rsvpLabels[r.response]}</Tag>
                  <span className="hidden text-xs text-muted sm:inline">{dateTime(r.updated_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
