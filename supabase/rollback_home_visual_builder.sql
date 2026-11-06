-- Run this only if supabase/59_home_visual_builder.sql was already applied.
-- It removes the visual builder database objects and leaves existing homepage content untouched.

drop function if exists public.get_published_home_builder();
drop function if exists public.admin_register_home_builder_asset(text, text, text, text, bigint);
drop function if exists public.admin_restore_home_builder(uuid);
drop function if exists public.admin_unpublish_home_builder();
drop function if exists public.admin_publish_home_builder(timestamptz);
drop function if exists public.admin_save_home_builder(jsonb);
drop function if exists public.admin_get_home_builder();

drop policy if exists "home builder media upload" on storage.objects;
drop policy if exists "home builder media update" on storage.objects;
drop policy if exists "home builder media delete" on storage.objects;

drop table if exists public.homepage_builder_assets;
drop table if exists public.homepage_builder_revisions;
drop table if exists public.homepage_builder_pages;
