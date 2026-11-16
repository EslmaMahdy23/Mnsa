-- Shared PDF library for a course. Students can read files only while enrolled;
-- only the owning teacher (or an authorized course manager) can manage them.
create table if not exists public.course_shared_files (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 140),
  description text,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists course_shared_files_course_created_idx
  on public.course_shared_files (course_id, created_at desc);

alter table public.course_shared_files enable row level security;

drop policy if exists "shared course files read" on public.course_shared_files;
create policy "shared course files read" on public.course_shared_files
  for select to authenticated using (
    public.is_admin()
    or public.can_manage_course_content()
    or exists (
      select 1 from public.courses c
      where c.id=course_shared_files.course_id
        and c.teacher_id=(select auth.uid())
    )
    or exists (
      select 1 from public.courses c
      join public.enrollments en on en.course_id=c.id and en.user_id=(select auth.uid())
      where c.id=course_shared_files.course_id and c.is_published
    )
  );

drop policy if exists "shared course files teacher insert" on public.course_shared_files;
create policy "shared course files teacher insert" on public.course_shared_files
  for insert to authenticated with check (
    teacher_id=(select auth.uid()) and exists (
      select 1 from public.courses c where c.id=course_shared_files.course_id
        and c.teacher_id=(select auth.uid())
    )
  );

drop policy if exists "shared course files teacher update" on public.course_shared_files;
create policy "shared course files teacher update" on public.course_shared_files
  for update to authenticated using (
    teacher_id=(select auth.uid()) and exists (
      select 1 from public.courses c where c.id=course_shared_files.course_id
        and c.teacher_id=(select auth.uid())
    )
  ) with check (
    teacher_id=(select auth.uid()) and exists (
      select 1 from public.courses c where c.id=course_shared_files.course_id
        and c.teacher_id=(select auth.uid())
    )
  );

drop policy if exists "shared course files teacher delete" on public.course_shared_files;
create policy "shared course files teacher delete" on public.course_shared_files
  for delete to authenticated using (
    teacher_id=(select auth.uid()) and exists (
      select 1 from public.courses c where c.id=course_shared_files.course_id
        and c.teacher_id=(select auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shared-course-files','shared-course-files',false,31457280,array['application/pdf'])
on conflict (id) do update set public=false,file_size_limit=31457280,allowed_mime_types=array['application/pdf'];

drop policy if exists "shared course pdf upload" on storage.objects;
create policy "shared course pdf upload" on storage.objects for insert to authenticated
with check (
  bucket_id='shared-course-files' and exists (
    select 1 from public.courses c where c.id::text=(storage.foldername(name))[1]
      and c.teacher_id=(select auth.uid())
  )
);

drop policy if exists "shared course pdf read" on storage.objects;
create policy "shared course pdf read" on storage.objects for select to authenticated
using (
  bucket_id='shared-course-files' and exists (
    select 1 from public.course_shared_files f
    where f.storage_path=storage.objects.name
  )
);

drop policy if exists "shared course pdf delete" on storage.objects;
create policy "shared course pdf delete" on storage.objects for delete to authenticated
using (
  bucket_id='shared-course-files' and exists (
    select 1 from public.courses c where c.id::text=(storage.foldername(name))[1]
      and c.teacher_id=(select auth.uid())
  )
);
