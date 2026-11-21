'use client';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarPlus, Check, HelpCircle, Minus, Pencil, Plus, Users, X } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { useAuth } from '@/lib/auth';
import { formatEventDate } from '@/lib/invitation';
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Tag } from '@/components/ui';
import { countdown, InvitationCanvas, isPast, kindLabel, rsvpLabels, ShareBar, toInvitation, type EventRow } from '@/components/events';
import { blank, EventDetail, EventEditor, type Draft } from '@/components/event-editor';

type Mine = { event_id: string; response: 'yes' | 'no' | 'maybe'; guests: number; note: string | null };

export default function MemberEvents() {
  const { fund, memberId } = useAuth();
  const ev = useData<EventRow[]>(() => q(supabase().from('v_event_summary').select('*').order('event_date')));
  const mine = useData<Mine[]>(() => q(supabase().from('event_rsvps').select('event_id, response, guests, note').eq('member_id', memberId ?? '')), [memberId]);
  const { upcoming, past } = useMemo(() => {
    const all = ev.data ?? [];
    return {
      upcoming: all.filter(e => e.status === 'active' && !isPast(e.event_date)),
      past: all.filter(e => e.status === 'cancelled' || isPast(e.event_date)).reverse().slice(0, 6),
    };
  }, [ev.data]);
  const myMap = useMemo(() => new Map((mine.data ?? []).map(m => [m.event_id, m])), [mine.data]);
  const reload = () => { ev.reload(); mine.reload(); };
  const [edit, setEdit] = useState<{ id?: string; d: Draft } | null>(null);
  const [view, setView] = useState<EventRow | null>(null);
  if (edit) return <EventEditor member init={edit} fundName={fund?.fund_name} onClose={saved => { setEdit(null); if (saved) reload(); }} />;

  return (
    <>
      <PageHeader title="المناسبات" subtitle="دعوات العائلة — أكّد حضورك، أو ادعُ الجميع لمناسبتك"
        actions={<Button icon={<CalendarPlus className="size-4" />} onClick={() => setEdit({ d: { ...blank('gathering'), notify: true } })}>دعوة جديدة</Button>} />
      <ErrorBox>{ev.error ?? mine.error}</ErrorBox>
      {ev.loading && !ev.data ? <Loading /> : upcoming.length === 0 ? (
        <Card><Empty>لا توجد مناسبات قادمة — عندك طلعة أو عزيمة؟ اضغط «دعوة جديدة» وتوصل الدعوة للجميع</Empty></Card>
      ) : (
        <div className="space-y-6">
          {upcoming.map(e => <Invite key={e.id} e={e} mine={myMap.get(e.id)} fundName={fund?.fund_name} onDone={reload} onManage={() => setView(e)} />)}
        </div>
      )}
      {past.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-sm font-semibold text-muted">مناسبات سابقة</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {past.map(e => (
              <div key={e.id} className="opacity-80">
                <InvitationCanvas data={toInvitation(e, fund?.fund_name)} className="shadow-none" />
                <div className="mt-1 truncate text-xs text-muted">{e.title}</div>
              </div>
            ))}
          </div>
        </>
      )}
      {view && <EventDetail e={view} fundName={fund?.fund_name} onClose={() => setView(null)} onChanged={() => { setView(null); reload(); }}
        onEdit={() => { const e = view; setView(null); setEdit({ id: e.id, d: { kind: e.kind, title: e.title, message: e.message ?? '', event_date: e.event_date, start_time: e.start_time ?? '', location: e.location ?? '', location_url: e.location_url ?? '', host: e.host ?? '', rsvp_enabled: e.rsvp_enabled, notify: false } }); }} />}
    </>
  );
}

function Invite({ e, mine, fundName, onDone, onManage }: { e: EventRow; mine?: Mine; fundName?: string | null; onDone: () => void; onManage: () => void }) {
  const a = useAction();
  const [resp, setResp] = useState<Mine['response'] | null>(mine?.response ?? null);
  const [guests, setGuests] = useState(mine?.guests ?? 0);
  const [note, setNote] = useState(mine?.note ?? '');
  const { greg, hijri } = formatEventDate(e.event_date);
  const changed = resp && (resp !== mine?.response || guests !== (mine?.guests ?? 0) || note !== (mine?.note ?? ''));
  const send = async () => {
    if (!resp) return;
    if (await a.run(() => rpc('rsvp_event', { p_id: e.id, p_response: resp, p_guests: resp === 'yes' ? guests : 0, p_note: note }).then(() => true), 'تم تسجيل ردك — شكراً لك')) onDone();
  };
  const opts: { k: Mine['response']; icon: React.ReactNode; cls: string }[] = [
    { k: 'yes', icon: <Check className="size-4" />, cls: 'border-pos bg-[#eaf3ec] text-pos' },
    { k: 'maybe', icon: <HelpCircle className="size-4" />, cls: 'border-gold-500 bg-gold-100/60 text-gold-700' },
    { k: 'no', icon: <X className="size-4" />, cls: 'border-line-strong bg-canvas text-ink-2' },
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="grid gap-0 md:grid-cols-[340px_1fr]">
        <div className="bg-canvas p-4"><InvitationCanvas data={toInvitation(e, fundName)} /></div>
        <div className="flex min-w-0 flex-col gap-4 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="violet">{countdown(e.event_date)}</Tag><span className="text-xs text-muted">{kindLabel(e.kind)}</span>
              {e.is_mine && <Tag tone="green">دعوتك</Tag>}
              {!e.is_mine && e.creator_name && <span className="text-xs text-muted">من {e.creator_name}</span>}
              {mine && <Tag tone={mine.response === 'yes' ? 'green' : mine.response === 'maybe' ? 'amber' : 'neutral'}>ردك: {rsvpLabels[mine.response]}</Tag>}
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold text-ink">{e.title}</h2>
            {e.message && <p className="mt-1 text-sm text-ink-2">{e.message}</p>}
          </div>
          <dl className="grid gap-1.5 text-sm">
            <div><dt className="inline text-muted">التاريخ: </dt><dd className="inline">{greg}{hijri ? ` — ${hijri}` : ''}</dd></div>
            {e.start_time && <div><dt className="inline text-muted">الوقت: </dt><dd className="inline">{e.start_time}</dd></div>}
            {e.location && <div><dt className="inline text-muted">المكان: </dt><dd className="inline">{e.location}</dd></div>}
            {e.host && <div><dt className="inline text-muted">الداعي: </dt><dd className="inline">{e.host}</dd></div>}
          </dl>
          <ShareBar e={e} fundName={fundName} />
          {e.is_mine && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold-300 bg-gold-100/40 p-3 text-sm">
              <span className="flex items-center gap-1.5"><Users className="size-4 text-gold-700" />الحضور المتوقع <b className="num">{e.expected_attendance}</b>
                <span className="text-xs text-muted">(سأحضر <span className="num">{e.yes_count}</span> · ربما <span className="num">{e.maybe_count}</span> · أعتذر <span className="num">{e.no_count}</span>)</span></span>
              <Button variant="secondary" className="ms-auto" icon={<Pencil className="size-4" />} onClick={onManage}>الردود والتعديل</Button>
            </div>
          )}
          {e.rsvp_enabled && (
            <div className="mt-auto space-y-3 rounded-xl bg-canvas p-4">
              <ErrorBox>{a.error}</ErrorBox>
              <div className="text-sm font-medium">هل ستحضر؟</div>
              <div className="grid grid-cols-3 gap-2">
                {opts.map(o => (
                  <button key={o.k} type="button" onClick={() => setResp(o.k)} aria-pressed={resp === o.k}
                    className={clsx('flex h-11 items-center justify-center gap-1.5 rounded-lg border-2 text-sm font-medium transition',
                      resp === o.k ? o.cls : 'border-line bg-surface text-ink-2 hover:border-line-strong')}>{o.icon}{rsvpLabels[o.k]}</button>
                ))}
              </div>
              {resp === 'yes' && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>عدد المرافقين معك</span>
                  <div className="flex items-center gap-2">
                    <button type="button" className="flex size-8 items-center justify-center rounded-md border border-line bg-surface disabled:opacity-40" disabled={guests <= 0} onClick={() => setGuests(guests - 1)} aria-label="إنقاص"><Minus className="size-4" /></button>
                    <span className="w-6 text-center font-semibold num">{guests}</span>
                    <button type="button" className="flex size-8 items-center justify-center rounded-md border border-line bg-surface disabled:opacity-40" disabled={guests >= 20} onClick={() => setGuests(guests + 1)} aria-label="زيادة"><Plus className="size-4" /></button>
                  </div>
                </div>
              )}
              <Input placeholder="ملاحظة للمنظمين (اختياري)" maxLength={200} value={note} onChange={x => setNote(x.target.value)} />
              <Button className="w-full" onClick={send} loading={a.busy} disabled={!changed}>{mine ? 'تحديث ردي' : 'إرسال الرد'}</Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
