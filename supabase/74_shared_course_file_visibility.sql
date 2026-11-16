-- Teachers can hide shared files without deleting them. Hidden files remain
-- visible to their owning teacher, but students cannot list or open them.
alter table public.course_shared_files
  add column if not exists is_visible boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.course_shared_files'::regclass
      and conname='course_shared_files_path_matches_course'
  ) then
    alter table public.course_shared_files
      add constraint course_shared_files_path_matches_course
      check (left(storage_path, char_length(course_id::text) + 1) = course_id::text || '/');
  end if;
end;
$$;

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
    or (
      is_visible
      and exists (
        select 1 from public.courses c
        join public.enrollments en on en.course_id=c.id and en.user_id=(select auth.uid())
        where c.id=course_shared_files.course_id and c.is_published
      )
    )
  );

drop policy if exists "shared course pdf read" on storage.objects;
create policy "shared course pdf read" on storage.objects for select to authenticated
using (
  bucket_id='shared-course-files' and exists (
    select 1 from public.course_shared_files f
    where f.storage_path=storage.objects.name
      and f.course_id::text=(storage.foldername(storage.objects.name))[1]
  )
);
