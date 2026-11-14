-- =====================================================================
-- Family occasions (invitations + RSVPs) and editable welcome phrases
-- =====================================================================

alter table public.fund_settings add column if not exists welcome_phrases jsonb not null default
  '["ما يجمعنا أكبر من أي رصيد","من الحريق إلى الأحساء… والأصل واحد","صندوقنا أمان العائلة اليوم وبكرة","يد الله مع الجماعة","كل ريال ندخره اليوم سند لأهلنا بكرة","التكافل عادة أهلنا… ونكملها","قليلٌ دائم خيرٌ من كثيرٍ منقطع","بيت النجدي عامر بأهله"]'::jsonb;

create or replace function public.set_welcome_phrases(p_phrases jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o jsonb; v jsonb;
begin
  perform public.assert_manager();
  if jsonb_typeof(p_phrases) <> 'array' then raise exception 'صيغة العبارات غير صالحة'; end if;
  select coalesce(jsonb_agg(to_jsonb(left(trim(x), 120))), '[]') into v
    from jsonb_array_elements_text(p_phrases) x where length(trim(x)) > 0;
  if jsonb_array_length(v) = 0 then raise exception 'أضف عبارة واحدة على الأقل'; end if;
  if jsonb_array_length(v) > 40 then raise exception 'الحد الأعلى 40 عبارة'; end if;
  select welcome_phrases into o from public.fund_settings where id = 1;
  update public.fund_settings set welcome_phrases = v, updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._log('update', 'fund_settings', '1', jsonb_build_object('welcome_phrases', v), jsonb_build_object('welcome_phrases', o), 'تعديل عبارات الترحيب');
end $$;

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('eid','ramadan','sea','desert','gathering','general')),
  title         text not null check (length(trim(title)) between 2 and 80),
  message       text check (length(message) <= 400),
  event_date    date not null,
  start_time    text check (length(start_time) <= 40),
  location      text check (length(location) <= 120),
  location_url  text check (location_url is null or location_url ~ '^https?://'),
  host          text check (length(host) <= 80),
  rsvp_enabled  boolean not null default true,
  status        text not null default 'active' check (status in ('active','cancelled')),
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index on public.events(event_date);

create table public.event_rsvps (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id),
  member_id   uuid not null references public.members(id),
  response    text not null check (response in ('yes','no','maybe')),
  guests      smallint not null default 0 check (guests between 0 and 20),
  note        text check (length(note) <= 200),
  updated_at  timestamptz not null default now(),
  unique (event_id, member_id)
);
create index on public.event_rsvps(member_id);

create trigger nodelete_events before delete on public.events for each row execute function public.trg_forbid_delete();
create trigger audit_events after insert or update on public.events for each row execute function public.trg_audit();

create or replace view public.v_event_summary with (security_invoker = true) as
  select e.*,
         coalesce(r.yes, 0) as yes_count, coalesce(r.no, 0) as no_count, coalesce(r.maybe, 0) as maybe_count,
         coalesce(r.guests, 0) as guests_count, coalesce(r.yes, 0) + coalesce(r.guests, 0) as expected_attendance
    from public.events e
    left join lateral (
      select count(*) filter (where response = 'yes') yes, count(*) filter (where response = 'no') no,
             count(*) filter (where response = 'maybe') maybe, sum(guests) filter (where response = 'yes') guests
        from public.event_rsvps where event_id = e.id) r on true;

create or replace function public._event_payload(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
begin
  if coalesce(p->>'kind','') not in ('eid','ramadan','sea','desert','gathering','general') then raise exception 'نوع المناسبة غير معروف'; end if;
  if length(trim(coalesce(p->>'title',''))) < 2 then raise exception 'عنوان الدعوة مطلوب'; end if;
  if nullif(p->>'event_date','') is null then raise exception 'تاريخ المناسبة مطلوب'; end if;
  return p;
end $$;

create or replace function public.create_event(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform public.assert_manager();
  p := public._event_payload(p);
  insert into public.events(kind, title, message, event_date, start_time, location, location_url, host, rsvp_enabled, created_by)
  values (p->>'kind', trim(p->>'title'), nullif(trim(p->>'message'),''), (p->>'event_date')::date, nullif(trim(p->>'start_time'),''),
          nullif(trim(p->>'location'),''), nullif(trim(p->>'location_url'),''), nullif(trim(p->>'host'),''),
          coalesce((p->>'rsvp_enabled')::boolean, true), auth.uid())
  returning id into v;
  if coalesce((p->>'notify')::boolean, true) then
    perform public._notify(u.id, 'event_invite', 'دعوة: ' || trim(p->>'title'),
      'بتاريخ ' || (p->>'event_date') || coalesce(' — ' || nullif(trim(p->>'location'),''), ''),
      case when u.role = 'manager' then '/admin/events' else '/member/events' end, 'event-' || v)
      from public.app_users u where u.is_active;
  end if;
  return v;
end $$;

create or replace function public.update_event(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  perform public.assert_manager();
  select * into e from public.events where id = p_id for update;
  if not found then raise exception 'المناسبة غير موجودة'; end if;
  if e.status = 'cancelled' then raise exception 'لا يمكن تعديل مناسبة ملغاة'; end if;
  p := public._event_payload(p);
  update public.events set kind = p->>'kind', title = trim(p->>'title'), message = nullif(trim(p->>'message'),''),
         event_date = (p->>'event_date')::date, start_time = nullif(trim(p->>'start_time'),''),
         location = nullif(trim(p->>'location'),''), location_url = nullif(trim(p->>'location_url'),''),
         host = nullif(trim(p->>'host'),''), rsvp_enabled = coalesce((p->>'rsvp_enabled')::boolean, rsvp_enabled)
   where id = p_id;
end $$;

create or replace function public.cancel_event(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  perform public.assert_manager();
  select * into e from public.events where id = p_id for update;
  if not found or e.status = 'cancelled' then raise exception 'لا يمكن إلغاء هذه المناسبة'; end if;
  update public.events set status = 'cancelled' where id = p_id;
  perform public._notify(u.id, 'event_cancelled', 'إلغاء: ' || e.title, coalesce(nullif(trim(p_note),''), 'تم إلغاء المناسبة'),
                         '/member/events', 'event-cancel-' || p_id)
    from public.app_users u where u.is_active and u.role = 'member';
end $$;

create or replace function public.rsvp_event(p_id uuid, p_response text, p_guests int default 0, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_m uuid := public.assert_member(); e public.events;
begin
  select * into e from public.events where id = p_id;
  if not found or e.status <> 'active' then raise exception 'المناسبة غير متاحة'; end if;
  if not e.rsvp_enabled then raise exception 'هذه الدعوة لا تتطلب رداً'; end if;
  if e.event_date < public.fund_today() then raise exception 'انتهى موعد المناسبة'; end if;
  if p_response not in ('yes','no','maybe') then raise exception 'رد غير صالح'; end if;
  insert into public.event_rsvps(event_id, member_id, response, guests, note)
  values (p_id, v_m, p_response, case when p_response = 'yes' then greatest(0, least(coalesce(p_guests,0), 20)) else 0 end, nullif(trim(p_note),''))
  on conflict (event_id, member_id) do update
    set response = excluded.response, guests = excluded.guests, note = excluded.note, updated_at = now();
end $$;

-- security
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
revoke all on public.events, public.event_rsvps from public, anon, authenticated;
grant select on public.events, public.event_rsvps to authenticated;
create policy read_all on public.events for select to authenticated using (true);
create policy own_or_manager on public.event_rsvps for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.is_manager()));
grant select on public.v_event_summary to authenticated;
revoke all on public.v_event_summary from anon;

revoke execute on function public.set_welcome_phrases(jsonb), public._event_payload(jsonb), public.create_event(jsonb),
  public.update_event(uuid,jsonb), public.cancel_event(uuid,text), public.rsvp_event(uuid,text,int,text) from public, anon, authenticated;
grant execute on function public.set_welcome_phrases(jsonb), public.create_event(jsonb), public.update_event(uuid,jsonb),
  public.cancel_event(uuid,text), public.rsvp_event(uuid,text,int,text) to authenticated;
