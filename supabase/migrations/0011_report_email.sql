-- =====================================================================
-- E-mail delivery of monthly reports (sent by the send-report-emails Edge Function).
-- =====================================================================
alter table public.fund_settings add column if not exists monthly_report_email boolean not null default true;

alter table public.monthly_reports
  add column if not exists email_to text,
  add column if not exists emailed_at timestamptz,
  add column if not exists email_error text,
  add column if not exists email_attempts int not null default 0;

/** Recipient for a member: the member's own e-mail, else their login e-mail. */
create or replace function public.member_email(p_member uuid) returns text
language sql stable security definer set search_path = public as $$
  select nullif(trim(coalesce(nullif(m.email, ''), u.email)), '')
    from public.members m left join public.app_users u on u.id = m.user_id where m.id = p_member
$$;

/** Rows the mailer should send for a period (service role only). */
create or replace function public.reports_to_email(p_period date default null, p_ids uuid[] default null, p_resend boolean default false)
returns table (id uuid, member_id uuid, period date, report jsonb, note text, member_name text, email text)
language sql stable security definer set search_path = public as $$
  select r.id, r.member_id, r.period, r.report, r.note, m.full_name, public.member_email(r.member_id)
    from public.monthly_reports r join public.members m on m.id = r.member_id
   where (p_ids is null or r.id = any(p_ids))
     and (p_period is null or r.period = date_trunc('month', p_period)::date)
     and (p_ids is not null or p_period is not null
          or r.period = (date_trunc('month', public.fund_today()) - interval '1 month')::date)
     and (p_resend or r.emailed_at is null)
     and m.status = 'active'
   order by m.member_no
$$;

create or replace function public.mark_report_emailed(p_id uuid, p_to text, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.monthly_reports
     set email_to = p_to, email_attempts = email_attempts + 1,
         emailed_at = case when p_error is null then now() else emailed_at end,
         email_error = p_error
   where id = p_id;
end $$;

drop function if exists public.set_monthly_report_prefs(boolean, text);
create or replace function public.set_monthly_report_prefs(p_auto boolean, p_note text, p_email boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare o public.fund_settings := public.settings();
begin
  perform public.assert_manager();
  update public.fund_settings set monthly_report_auto = p_auto, monthly_report_note = nullif(trim(p_note), ''),
         monthly_report_email = p_email, updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._log('update', 'fund_settings', '1',
    jsonb_build_object('monthly_report_auto', p_auto, 'monthly_report_note', p_note, 'monthly_report_email', p_email),
    jsonb_build_object('monthly_report_auto', o.monthly_report_auto, 'monthly_report_note', o.monthly_report_note, 'monthly_report_email', o.monthly_report_email),
    'إعدادات التقارير الشهرية');
end $$;

revoke execute on function public.member_email(uuid), public.reports_to_email(date,uuid[],boolean),
  public.mark_report_emailed(uuid,text,text), public.set_monthly_report_prefs(boolean,text,boolean) from public, anon, authenticated;
grant execute on function public.set_monthly_report_prefs(boolean,text,boolean) to authenticated;
do $$ begin
  grant execute on function public.reports_to_email(date,uuid[],boolean), public.mark_report_emailed(uuid,text,text), public.member_email(uuid) to service_role;
exception when undefined_object then null; end $$;
