-- Supabase-only: private bucket where the mailer caches the e-mail banner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-assets', 'email-assets', false, 1048576, array['image/png']) on conflict (id) do nothing;
