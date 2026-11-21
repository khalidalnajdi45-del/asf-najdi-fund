'use client';
import { useState } from 'react';
import { Pencil, XCircle } from 'lucide-react';
import { rpc } from '@/lib/supabase';
import { useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { dateTime } from '@/lib/format';
import { formatEventDate, THEMES, type EventKind } from '@/lib/invitation';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Tag, Textarea } from './ui';
import { InvitationCanvas, isPast, kindLabel, rsvpLabels, ShareBar, ThemePicker, toInvitation, type EventRow } from './events';

export type Draft = {
  kind: EventKind; title: string; message: string; event_date: string; start_time: string; location: string;
  location_url: string; host: string; rsvp_enabled: boolean; notify: boolean;
};
export const blank = (k: EventKind = 'eid'): Draft => ({
  kind: k, title: THEMES[k].title, message: THEMES[k].message, event_date: '', start_time: '', location: '', location_url: '', host: '', rsvp_enabled: true, notify: true,
});

export function EventEditor({ init, fundName, onClose, member }: { init: { id?: string; d: Draft }; fundName?: string | null; onClose: (saved: boolean) => void; member?: boolean }) {
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
      init.id ? 'تم تحديث الدعوة' : member || d.notify ? 'تم نشر الدعوة وإشعار الجميع' : 'تم حفظ الدعوة');
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
              <Field label="المكان"><Input value={d.location} maxLength={120} placeholder="استراحة العائلة" onChange={e => set({ location: e.target.value })} /></Field>
              <Field label="رابط الموقع (اختياري)"><Input dir="ltr" value={d.location_url} placeholder="https://maps.app.goo.gl/…" onChange={e => set({ location_url: e.target.value })} /></Field>
              <Field label="الداعي (اختياري)"><Input value={d.host} maxLength={80} placeholder="أبناء فلان النجدي" onChange={e => set({ host: e.target.value })} /></Field>
              <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand-600" checked={d.rsvp_enabled} onChange={e => set({ rsvp_enabled: e.target.checked })} />طلب تأكيد الحضور من الأعضاء</label>
                {!init.id && !member && <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand-600" checked={d.notify} onChange={e => set({ notify: e.target.checked })} />إرسال إشعار لجميع الأعضاء</label>}
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

type Rsvp = { id: string; member_name: string; response: string; guests: number; note: string | null; updated_at: string };

export function EventDetail({ e, fundName, onClose, onEdit, onChanged }: { e: EventRow; fundName?: string | null; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const a = useAction();
  const rs = useData<Rsvp[]>(() => rpc<Rsvp[]>('event_responses', { p_id: e.id }), [e.id]);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const { greg, hijri } = formatEventDate(e.event_date);
  const editable = e.status === 'active' && !isPast(e.event_date);
  const cancel = async () => { if (await a.run(() => rpc('cancel_event', { p_id: e.id, p_note: note }).then(() => true), 'تم إلغاء المناسبة وإشعار الجميع')) onChanged(); };
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
                  <span className="min-w-0 flex-1 truncate">{r.member_name ?? '—'}{r.note && <span className="block truncate text-xs text-muted">{r.note}</span>}</span>
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
