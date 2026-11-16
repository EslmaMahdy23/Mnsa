-- Allow teachers to manage lecture schedules for their own courses.
-- Course schedules are visible only to enrolled students; legacy schedules
-- without a course_id keep their existing grade based visibility.

alter table public.lecture_schedules
  add column if not exists course_id uuid references public.courses(id) on delete cascade;

create index if not exists lecture_schedules_course_idx
  on public.lecture_schedules (course_id, is_published);

drop policy if exists "lecture schedules student read" on public.lecture_schedules;
create policy "lecture schedules student read" on public.lecture_schedules
  for select to authenticated
  using (
    public.is_admin()
    or (
      is_published
      and (
        (course_id is null and grade = (select p.grade from public.profiles p where p.id = (select auth.uid())))
        or (course_id is not null and exists (
          select 1 from public.enrollments en
          where en.course_id = lecture_schedules.course_id and en.user_id = (select auth.uid())
        ))
      )
    )
  );

drop policy if exists "lecture schedules teacher read own course" on public.lecture_schedules;
create policy "lecture schedules teacher read own course" on public.lecture_schedules
  for select to authenticated
  using (
    teacher_id = (select auth.uid()) and course_id is not null
    and exists (
      select 1 from public.courses c
      where c.id = lecture_schedules.course_id and c.teacher_id = (select auth.uid())
    )
  );

drop policy if exists "lecture schedules teacher insert own course" on public.lecture_schedules;
create policy "lecture schedules teacher insert own course" on public.lecture_schedules
  for insert to authenticated
  with check (
    teacher_id = (select auth.uid()) and course_id is not null
    and exists (
      select 1 from public.courses c
      where c.id = lecture_schedules.course_id and c.teacher_id = (select auth.uid())
    )
  );

drop policy if exists "lecture schedules teacher update own course" on public.lecture_schedules;
create policy "lecture schedules teacher update own course" on public.lecture_schedules
  for update to authenticated
  using (
    teacher_id = (select auth.uid()) and course_id is not null
    and exists (
      select 1 from public.courses c
      where c.id = lecture_schedules.course_id and c.teacher_id = (select auth.uid())
    )
  )
  with check (
    teacher_id = (select auth.uid()) and course_id is not null
    and exists (
      select 1 from public.courses c
      where c.id = lecture_schedules.course_id and c.teacher_id = (select auth.uid())
    )
  );

drop policy if exists "lecture schedules teacher delete own course" on public.lecture_schedules;
create policy "lecture schedules teacher delete own course" on public.lecture_schedules
  for delete to authenticated
  using (
    teacher_id = (select auth.uid()) and course_id is not null
    and exists (
      select 1 from public.courses c
      where c.id = lecture_schedules.course_id and c.teacher_id = (select auth.uid())
    )
  );

drop policy if exists "lecture items student read" on public.lecture_schedule_items;
create policy "lecture items student read" on public.lecture_schedule_items
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.lecture_schedules s
      where s.id = lecture_schedule_items.schedule_id and s.is_published
        and (
          (s.course_id is null and exists (
            select 1 from public.profiles p where p.id = (select auth.uid()) and p.grade = s.grade
          ))
          or (s.course_id is not null and exists (
            select 1 from public.enrollments en
            where en.course_id = s.course_id and en.user_id = (select auth.uid())
          ))
        )
    )
  );

drop policy if exists "lecture items teacher read own course" on public.lecture_schedule_items;
create policy "lecture items teacher read own course" on public.lecture_schedule_items
  for select to authenticated
  using (exists (
    select 1 from public.lecture_schedules s
    where s.id = lecture_schedule_items.schedule_id
      and s.teacher_id = (select auth.uid()) and s.course_id is not null
  ));

drop policy if exists "lecture items teacher insert own course" on public.lecture_schedule_items;
create policy "lecture items teacher insert own course" on public.lecture_schedule_items
  for insert to authenticated
  with check (exists (
    select 1 from public.lecture_schedules s
    where s.id = lecture_schedule_items.schedule_id
      and s.teacher_id = (select auth.uid()) and s.course_id is not null
  ));

drop policy if exists "lecture items teacher update own course" on public.lecture_schedule_items;
create policy "lecture items teacher update own course" on public.lecture_schedule_items
  for update to authenticated
  using (exists (
    select 1 from public.lecture_schedules s
    where s.id = lecture_schedule_items.schedule_id
      and s.teacher_id = (select auth.uid()) and s.course_id is not null
  ))
  with check (exists (
    select 1 from public.lecture_schedules s
    where s.id = lecture_schedule_items.schedule_id
      and s.teacher_id = (select auth.uid()) and s.course_id is not null
  ));

drop policy if exists "lecture items teacher delete own course" on public.lecture_schedule_items;
create policy "lecture items teacher delete own course" on public.lecture_schedule_items
  for delete to authenticated
  using (exists (
    select 1 from public.lecture_schedules s
    where s.id = lecture_schedule_items.schedule_id
      and s.teacher_id = (select auth.uid()) and s.course_id is not null
  ));

create or replace function public.notify_students_on_schedule_publish()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published and (tg_op = 'INSERT' or old.is_published is false) then
    insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
    select p.id, 'lecture_schedule', new.id, 'جدول محاضرات جديد: ' || new.subject,
           'تم نشر جدول محاضرات جديد لك.', '/dashboard/lecture-schedules'
    from public.profiles p
    where p.role = 'student'
      and (
        (new.course_id is null and p.grade = new.grade)
        or (new.course_id is not null and exists (
          select 1 from public.enrollments en
          where en.course_id = new.course_id and en.user_id = p.id
        ))
      )
    on conflict (user_id, source_type, source_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_students_on_schedule_publish() from public, anon, authenticated;
