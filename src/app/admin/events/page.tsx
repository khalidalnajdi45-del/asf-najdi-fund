'use client';
import { useMemo, useState } from 'react';
import { CalendarPlus, Pencil, Users, XCircle } from 'lucide-react';
import { rpc, supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { useAction } from '@/lib/action';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { formatEventDate } from '@/lib/invitation';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Tabs, Tag } from '@/components/ui';
import { countdown, InvitationCanvas, isPast, kindLabel, toInvitation, type EventRow } from '@/components/events';
import { blank, EventDetail, EventEditor, type Draft } from '@/components/event-editor';

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

  if (edit) return <EventEditor init={edit} fundName={fund?.fund_name} onClose={saved => { setEdit(null); if (saved) list.reload(); }} />;

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
      {view && <EventDetail e={view} fundName={fund?.fund_name} onClose={() => setView(null)} onChanged={() => { setView(null); list.reload(); }}
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

