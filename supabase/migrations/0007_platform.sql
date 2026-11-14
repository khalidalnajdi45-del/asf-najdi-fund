-- =====================================================================
-- Supabase platform pieces (not run in local PGlite tests):
-- private document storage + daily scheduled job.
-- =====================================================================

-- Private bucket for supporting documents (10 MB max, restricted types)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760,
        array['application/pdf','image/png','image/jpeg','image/webp',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- Manager: full access to the bucket. Members: read files registered against their own account.
create policy "docs_manager_all" on storage.objects for all to authenticated
  using (bucket_id = 'documents' and (select public.is_manager()))
  with check (bucket_id = 'documents' and (select public.is_manager()));

create policy "docs_member_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and exists (
    select 1 from public.documents d where d.storage_path = name and d.member_id = (select public.current_member_id())));

-- Daily jobs at 06:00 Riyadh (03:00 UTC): obligations, loan statuses, reminders.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('najdi-fund-daily', '0 3 * * *', $$select public.run_daily_jobs()$$);
