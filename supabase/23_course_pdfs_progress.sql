-- Private course PDF storage. Run once in Supabase SQL Editor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-pdfs', 'course-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 52428800,
      allowed_mime_types = array['application/pdf'];

drop policy if exists "course pdf upload by owner" on storage.objects;
create policy "course pdf upload by owner" on storage.objects for insert to authenticated
with check (
  bucket_id = 'course-pdfs'
  and exists (
    select 1 from public.courses c
    where c.id::text = (storage.foldername(name))[1]
      and (c.teacher_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists "course pdf read with lesson access" on storage.objects;
create policy "course pdf read with lesson access" on storage.objects for select to authenticated
using (
  bucket_id = 'course-pdfs'
  and exists (
    select 1 from public.lessons l
    where l.file_url = storage.objects.name
      and l.kind = 'file'
  )
);

drop policy if exists "progress own" on public.lesson_progress;
drop policy if exists "progress read own" on public.lesson_progress;
drop policy if exists "progress insert own" on public.lesson_progress;
create policy "progress read own" on public.lesson_progress for select to authenticated
using (user_id = (select auth.uid()));
create policy "progress insert own" on public.lesson_progress for insert to authenticated
with check (user_id = (select auth.uid()));
