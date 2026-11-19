-- =====================================================================
-- Username logins for members.
-- Members sign in with a short username (e.g. "khalid"); behind it Supabase Auth uses a synthetic,
-- never-mailed address <username>@members.najdi-fund.app. The member's personal e-mail stays in
-- members.email and is used only for reports/messages. Temporary passwords force a change on first login.
-- =====================================================================

alter table public.members add column if not exists username text;
alter table public.members add constraint members_username_format check (username is null or username ~ '^[a-z][a-z0-9._-]{2,19}$');
create unique index if not exists members_username_key on public.members(username);

create or replace function public.login_domain() returns text language sql immutable as $$ select 'members.najdi-fund.app' $$;

/** Personal e-mail for mailings — never the synthetic login address. */
create or replace function public.member_email(p_member uuid) returns text
language sql stable security definer set search_path = public as $$
  select nullif(trim(coalesce(
           nullif(case when m.email ilike '%@' || public.login_domain() then null else m.email end, ''),
           case when u.email ilike '%@' || public.login_domain() then null else u.email end)), '')
    from public.members m left join public.app_users u on u.id = m.user_id where m.id = p_member
$$;

create or replace function public._check_username(p text) returns text language plpgsql stable as $$
declare v text := lower(trim(coalesce(p, '')));
begin
  if v !~ '^[a-z][a-z0-9._-]{2,19}$' then
    raise exception 'اسم المستخدم: 3–20 حرفاً إنجليزياً صغيراً أو أرقام أو (. _ -) ويبدأ بحرف';
  end if;
  if exists (select 1 from public.members where username = v) then raise exception 'اسم المستخدم مستخدم مسبقاً'; end if;
  return v;
end $$;

create or replace function public._check_personal_email(p text) returns text language plpgsql immutable as $$
declare v text := nullif(lower(trim(coalesce(p, ''))), '');
begin
  if v is not null and v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'البريد الشخصي غير صالح'; end if;
  return v;
end $$;

/** Give an existing member (no login yet) a username + temporary password. */
create or replace function public.admin_create_member_login(p_member uuid, p_username text, p_password text, p_email text default null)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare m public.members; v_user text; v_uid uuid; v_mail text;
begin
  perform public.assert_manager();
  select * into m from public.members where id = p_member for update;
  if not found then raise exception 'العضو غير موجود'; end if;
  if m.user_id is not null then raise exception 'لدى هذا العضو حساب دخول مسبقاً — استخدم إعادة تعيين كلمة المرور'; end if;
  v_user := public._check_username(p_username);
  v_mail := public._check_personal_email(p_email);
  v_uid := public._create_auth_user(v_user || '@' || public.login_domain(), p_password, m.full_name, 'member');
  update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('must_change_password', true, 'username', v_user) where id = v_uid;
  update public.members set user_id = v_uid, username = v_user, email = coalesce(v_mail, email) where id = p_member;
  perform public._notify(v_uid, 'welcome', 'مرحباً بك في الصندوق', 'تم تفعيل حسابك. يمكنك متابعة اشتراكاتك وودائعك وقروضك من لوحة التحكم.', '/member');
  perform public._log('create_login', 'members', p_member::text, jsonb_build_object('username', v_user), null, 'إنشاء دخول عضو');
  return v_user;
end $$;

/** New member + username login in one step. */
create or replace function public.admin_create_member_v2(p_full_name text, p_username text, p_password text,
  p_email text default null, p_phone text default null, p_join_date date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_mid uuid;
begin
  perform public.assert_manager();
  if length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'الاسم مطلوب'; end if;
  insert into public.members(full_name, phone, email, join_date, notes, created_by)
  values (trim(p_full_name), nullif(trim(p_phone), ''), public._check_personal_email(p_email),
          coalesce(p_join_date, public.fund_today()), p_notes, auth.uid())
  returning id into v_mid;
  perform public.admin_create_member_login(v_mid, p_username, p_password, null);
  perform public.generate_contribution_obligations();
  return v_mid;
end $$;

create or replace function public.admin_reset_password(p_member uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid;
begin
  perform public.assert_manager();
  if p_password is null or length(p_password) < 8 then raise exception 'كلمة المرور يجب ألا تقل عن 8 أحرف'; end if;
  select user_id into v_uid from public.members where id = p_member;
  if v_uid is null then raise exception 'لا يوجد حساب دخول لهذا العضو'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now(),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb
   where id = v_uid;
  perform public._log('reset_password', 'members', p_member::text);
end $$;

create or replace function public.admin_set_member_email(p_member uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_manager();
  update public.members set email = public._check_personal_email(p_email) where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  perform public._log('update', 'members', p_member::text, jsonb_build_object('email', p_email), null, 'تحديث البريد الشخصي');
end $$;

revoke execute on function public.admin_create_member_login(uuid,text,text,text), public.admin_create_member_v2(text,text,text,text,text,date,text),
  public.admin_set_member_email(uuid,text), public._check_username(text), public._check_personal_email(text) from public, anon;
grant execute on function public.admin_create_member_login(uuid,text,text,text), public.admin_create_member_v2(text,text,text,text,text,date,text),
  public.admin_set_member_email(uuid,text) to authenticated;
