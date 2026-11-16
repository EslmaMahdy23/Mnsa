-- The files section is collapsible in the UI; it does not hide files from students.
-- Restore any files previously hidden by the earlier, incorrect visibility toggle.
update public.course_shared_files set is_visible=true where is_visible is false;

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

drop policy if exists "shared course pdf read" on storage.objects;
create policy "shared course pdf read" on storage.objects for select to authenticated
using (
  bucket_id='shared-course-files' and exists (
    select 1 from public.course_shared_files f
    where f.storage_path=storage.objects.name
      and f.course_id::text=(storage.foldername(storage.objects.name))[1]
  )
);
