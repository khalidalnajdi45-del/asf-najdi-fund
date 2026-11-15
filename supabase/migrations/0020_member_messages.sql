-- =====================================================================
-- Manager → members e-mail: free-form messages and payment reminders, personalised per member.
-- The send-report-emails Edge Function delivers them ({message_id} mode) and records each recipient's outcome.
-- =====================================================================

create table public.member_messages (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'custom' check (kind in ('custom','contribution_reminder','loan_reminder','announcement')),
  subject     text not null check (length(trim(subject)) between 2 and 150),
  body        text not null check (length(trim(body)) between 2 and 5000),
  notify_app  boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table public.member_message_recipients (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.member_messages(id),
  member_id   uuid not null references public.members(id),
  email       text,
  status      text not null default 'pending' check (status in ('pending','sent','failed','no_email')),
  error       text,
  sent_at     timestamptz,
  unique (message_id, member_id)
);
create index on public.member_message_recipients(message_id);

create or replace view public.v_member_messages with (security_invoker = true) as
  select m.*, count(r.id) as recipients,
         count(r.id) filter (where r.status = 'sent') as sent,
         count(r.id) filter (where r.status = 'failed') as failed,
         count(r.id) filter (where r.status = 'no_email') as no_email,
         count(r.id) filter (where r.status = 'pending') as pending
    from public.member_messages m left join public.member_message_recipients r on r.message_id = m.id
   group by m.id;

/** Values a message can merge per member: {الاسم} {المتأخرات} {أشهر_التأخير} {المتبقي_من_القرض} {القسط_القادم} {تاريخ_القسط} */
create or replace function public.member_merge_fields(p_member uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'الاسم', split_part(trim(regexp_replace(b.full_name, '\(.*?\)', '', 'g')), ' ', 1),
    'الاسم_الكامل', b.full_name,
    'المتأخرات', b.contributions_overdue,
    'أشهر_التأخير', b.contributions_overdue_months,
    'المتبقي_من_القرض', b.loan_outstanding,
    'القسط_القادم', (select next_due_amount from public.v_loan_summary where member_id = p_member and status in ('disbursed','active','overdue') and next_due_date is not null order by next_due_date limit 1),
    'تاريخ_القسط', (select next_due_date from public.v_loan_summary where member_id = p_member and status in ('disbursed','active','overdue') and next_due_date is not null order by next_due_date limit 1),
    'الاشتراك_الشهري', (public.settings()).monthly_contribution)
  from public.v_member_balances b where b.member_id = p_member
$$;

create or replace function public.create_member_message(p_kind text, p_subject text, p_body text, p_members uuid[], p_notify boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; n int;
begin
  perform public.assert_manager();
  if p_members is null or cardinality(p_members) = 0 then raise exception 'اختر مستلماً واحداً على الأقل'; end if;
  if cardinality(p_members) > 200 then raise exception 'الحد الأعلى 200 مستلم في الرسالة'; end if;
  insert into public.member_messages(kind, subject, body, notify_app, created_by)
  values (coalesce(p_kind, 'custom'), trim(p_subject), trim(p_body), coalesce(p_notify, true), auth.uid()) returning id into v;
  insert into public.member_message_recipients(message_id, member_id, email, status)
  select v, m.id, public.member_email(m.id), case when public.member_email(m.id) is null then 'no_email' else 'pending' end
    from public.members m where m.id = any(p_members) and m.status = 'active';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'لا يوجد أعضاء نشطون ضمن المختارين'; end if;
  if coalesce(p_notify, true) then
    perform public._notify(m.user_id, 'message', trim(p_subject), left(trim(p_body), 180), '/member/notifications', 'msg-' || v)
      from public.members m where m.id = any(p_members) and m.user_id is not null;
  end if;
  perform public._log('create', 'member_messages', v::text, jsonb_build_object('kind', p_kind, 'subject', p_subject, 'recipients', n), null, 'رسالة للأعضاء');
  return v;
end $$;

/** Mailer queue for one message (service role). */
create or replace function public.message_recipients_pending(p_message uuid, p_retry boolean default false)
returns table (id uuid, member_id uuid, email text, subject text, body text, fields jsonb)
language sql stable security definer set search_path = public as $$
  select r.id, r.member_id, r.email, m.subject, m.body, public.member_merge_fields(r.member_id)
    from public.member_message_recipients r join public.member_messages m on m.id = r.message_id
   where r.message_id = p_message and r.email is not null
     and (r.status = 'pending' or (p_retry and r.status = 'failed'))
$$;

create or replace function public.mark_message_recipient(p_id uuid, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.member_message_recipients
     set status = case when p_error is null then 'sent' else 'failed' end, error = p_error,
         sent_at = case when p_error is null then now() else sent_at end
   where id = p_id
$$;

alter table public.member_messages enable row level security;
alter table public.member_message_recipients enable row level security;
revoke all on public.member_messages, public.member_message_recipients, public.v_member_messages from public, anon, authenticated;
grant select on public.member_messages, public.member_message_recipients, public.v_member_messages to authenticated;
create policy manager_read on public.member_messages for select to authenticated using ((select public.is_manager()));
create policy manager_read on public.member_message_recipients for select to authenticated using ((select public.is_manager()));

revoke execute on function public.member_merge_fields(uuid), public.create_member_message(text,text,text,uuid[],boolean),
  public.message_recipients_pending(uuid,boolean), public.mark_message_recipient(uuid,text) from public, anon, authenticated;
grant execute on function public.create_member_message(text,text,text,uuid[],boolean) to authenticated;
do $$ begin
  grant execute on function public.member_merge_fields(uuid), public.message_recipients_pending(uuid,boolean), public.mark_message_recipient(uuid,text) to service_role;
exception when undefined_object then null; end $$;
