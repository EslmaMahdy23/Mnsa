-- الخطوة 20: تنبيهات الطالب عند نشر كورس أو امتحان أو جدول محاضرات
-- شغّله في Supabase SQL Editor بعد ملف 19_lecture_schedules.sql.

create table if not exists public.student_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('course', 'exam', 'lecture_schedule')),
  source_id uuid not null,
  title text not null,
  message text not null,
  href text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, source_type, source_id)
);

create index if not exists student_notifications_inbox_idx
  on public.student_notifications (user_id, created_at desc);

alter table public.student_notifications enable row level security;

drop policy if exists "students read own notifications" on public.student_notifications;
create policy "students read own notifications" on public.student_notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "students mark own notifications read" on public.student_notifications;
create policy "students mark own notifications read" on public.student_notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.student_notifications from anon, authenticated;
grant select on public.student_notifications to authenticated;
grant update (read_at) on public.student_notifications to authenticated;

-- كورس جديد: لكل الطلاب لو مفيش صف محدد، أو لطلاب الصف المحدد.
create or replace function public.notify_students_on_course_publish()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published and (tg_op = 'INSERT' or old.is_published is false) then
    insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
    select p.id, 'course', new.id, 'كورس جديد: ' || new.title,
           'تم نشر كورس جديد وأصبح متاحًا لك.', '/dashboard/courses/' || new.id
    from public.profiles p
    where p.role = 'student' and (new.grade is null or p.grade = new.grade)
    on conflict (user_id, source_type, source_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists courses_notify_students_on_publish on public.courses;
create trigger courses_notify_students_on_publish
  after insert or update of is_published on public.courses
  for each row execute function public.notify_students_on_course_publish();

-- جدول المحاضرات: للطلاب في نفس الصف فقط.
create or replace function public.notify_students_on_schedule_publish()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published and (tg_op = 'INSERT' or old.is_published is false) then
    insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
    select p.id, 'lecture_schedule', new.id, 'جدول محاضرات جديد: ' || new.subject,
           'تم نشر جدول محاضرات جديد لصفك.', '/dashboard/lecture-schedules'
    from public.profiles p
    where p.role = 'student' and p.grade = new.grade
    on conflict (user_id, source_type, source_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists lecture_schedules_notify_students_on_publish on public.lecture_schedules;
create trigger lecture_schedules_notify_students_on_publish
  after insert or update of is_published on public.lecture_schedules
  for each row execute function public.notify_students_on_schedule_publish();

-- الامتحان: المسجلون في كورسه، أو طلاب الصف لو امتحان عام.
-- فحص question_count يسمح بإشعار الامتحان المنشور من admin_save_exam بعد إضافة أسئلته.
create or replace function public.notify_students_on_exam_publish()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published and new.question_count > 0
     and (tg_op = 'INSERT' or old.is_published is false or old.question_count = 0) then
    if new.course_id is not null then
      insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
      select p.id, 'exam', new.id, 'امتحان جديد: ' || new.title,
             'تم نشر امتحان جديد في أحد كورساتك.', '/dashboard/exams/' || new.id
      from public.enrollments en
      join public.profiles p on p.id = en.user_id and p.role = 'student'
      where en.course_id = new.course_id
      on conflict (user_id, source_type, source_id) do nothing;
    else
      insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
      select p.id, 'exam', new.id, 'امتحان جديد: ' || new.title,
             'تم نشر امتحان جديد متاح لك.', '/dashboard/exams/' || new.id
      from public.profiles p
      where p.role = 'student' and (new.grade is null or p.grade = new.grade)
      on conflict (user_id, source_type, source_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists exams_notify_students_on_publish on public.exams;
create trigger exams_notify_students_on_publish
  after insert or update of is_published, question_count on public.exams
  for each row execute function public.notify_students_on_exam_publish();

revoke all on function public.notify_students_on_course_publish() from public, anon, authenticated;
revoke all on function public.notify_students_on_schedule_publish() from public, anon, authenticated;
revoke all on function public.notify_students_on_exam_publish() from public, anon, authenticated;
