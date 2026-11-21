-- 0029 Members can create invitations for everyone; the creator (or the manager) edits/cancels them
-- and sees who's coming.
alter table public.events add column if not exists creator_name text;

drop view if exists public.v_event_summary;
create view public.v_event_summary with (security_invoker = true) as
  select e.*,
         coalesce(r.yes, 0) as yes_count, coalesce(r.no, 0) as no_count, coalesce(r.maybe, 0) as maybe_count,
         coalesce(r.guests, 0) as guests_count, coalesce(r.yes, 0) + coalesce(r.guests, 0) as expected_attendance,
         (e.created_by = auth.uid()) as is_mine
    from public.events e
    left join lateral (
      select count(*) filter (where response = 'yes') yes, count(*) filter (where response = 'no') no,
             count(*) filter (where response = 'maybe') maybe, sum(guests) filter (where response = 'yes') guests
        from public.event_rsvps where event_id = e.id) r on true;
grant select on public.v_event_summary to authenticated;
revoke all on public.v_event_summary from anon;

create or replace function public._event_can_edit(e public.events) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (e.created_by is not null and e.created_by = auth.uid())
$$;

create or replace function public.create_event(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; v_name text; v_mgr boolean := public.is_manager();
begin
  if not v_mgr then
    perform public.assert_member();
    if (select count(*) from public.events where created_by = auth.uid() and status = 'active' and event_date >= public.fund_today()) >= 5 then
      raise exception 'لديك 5 دعوات قادمة — ألغِ إحداها أو انتظر حتى تنتهي';
    end if;
  end if;
  select full_name into v_name from public.app_users where id = auth.uid();
  p := public._event_payload(p);
  insert into public.events(kind, title, message, event_date, start_time, location, location_url, host, rsvp_enabled, created_by, creator_name)
  values (p->>'kind', trim(p->>'title'), nullif(trim(p->>'message'),''), (p->>'event_date')::date, nullif(trim(p->>'start_time'),''),
          nullif(trim(p->>'location'),''), nullif(trim(p->>'location_url'),''),
          coalesce(nullif(trim(p->>'host'),''), case when v_mgr then null else v_name end),
          coalesce((p->>'rsvp_enabled')::boolean, true), auth.uid(), v_name)
  returning id into v;
  if v_mgr is false or coalesce((p->>'notify')::boolean, true) then
    perform public._notify(u.id, 'event_invite', 'دعوة: ' || trim(p->>'title'),
      case when v_mgr then '' else 'من ' || v_name || ' — ' end || 'بتاريخ ' || (p->>'event_date') || coalesce(' — ' || nullif(trim(p->>'location'),''), ''),
      case when u.role = 'manager' then '/admin/events' else '/member/events' end, 'event-' || v)
      from public.app_users u where u.is_active and u.id <> auth.uid();
  end if;
  return v;
end $$;

create or replace function public.update_event(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  select * into e from public.events where id = p_id for update;
  if not found then raise exception 'المناسبة غير موجودة'; end if;
  if not public._event_can_edit(e) then raise exception 'غير مصرح: تعديل الدعوة لصاحبها أو مدير الصندوق'; end if;
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
  select * into e from public.events where id = p_id for update;
  if not found or e.status = 'cancelled' then raise exception 'لا يمكن إلغاء هذه المناسبة'; end if;
  if not public._event_can_edit(e) then raise exception 'غير مصرح: إلغاء الدعوة لصاحبها أو مدير الصندوق'; end if;
  update public.events set status = 'cancelled' where id = p_id;
  perform public._notify(u.id, 'event_cancelled', 'إلغاء: ' || e.title, coalesce(nullif(trim(p_note),''), 'تم إلغاء المناسبة'),
                         case when u.role = 'manager' then '/admin/events' else '/member/events' end, 'event-cancel-' || p_id)
    from public.app_users u where u.is_active and u.id <> auth.uid();
end $$;

/** Who's coming — for the manager or the person who sent the invitation. */
create or replace function public.event_responses(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.events;
begin
  select * into e from public.events where id = p_id;
  if not found then raise exception 'المناسبة غير موجودة'; end if;
  if not public._event_can_edit(e) then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'member_name', m.full_name, 'response', r.response, 'guests', r.guests,
                                     'note', r.note, 'updated_at', r.updated_at) order by r.updated_at desc)
                     from public.event_rsvps r join public.members m on m.id = r.member_id where r.event_id = p_id), '[]'::jsonb);
end $$;

revoke execute on function public._event_can_edit(public.events), public.event_responses(uuid) from public, anon;
grant execute on function public.event_responses(uuid) to authenticated;
