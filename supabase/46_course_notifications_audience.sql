-- Notify only students in the course's exact grade when a course is published.
-- New exams no longer generate student notifications.

create or replace function public.notify_students_on_course_publish()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published
     and new.grade is not null
     and (tg_op = 'INSERT' or old.is_published is false) then
    insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
    select p.id, 'course', new.id, 'كورس جديد: ' || new.title,
           'تم نشر كورس جديد مناسب لسنتك الدراسية.', '/dashboard/courses/' || new.id
    from public.profiles p
    where p.role = 'student' and p.grade = new.grade
    on conflict (user_id, source_type, source_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists exams_notify_students_on_publish on public.exams;

revoke all on function public.notify_students_on_course_publish() from public, anon, authenticated;
