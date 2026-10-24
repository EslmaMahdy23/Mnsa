-- الخطوة 21: إرسال إشعارات مخصصة من الأدمن لطلاب محددين
-- شغّله في Supabase SQL Editor بعد 20_student_notifications.sql.

alter table public.student_notifications
  drop constraint if exists student_notifications_source_type_check;
alter table public.student_notifications
  add constraint student_notifications_source_type_check
  check (source_type in ('course', 'exam', 'lecture_schedule', 'admin_broadcast'));

create or replace function public.admin_send_student_notification(
  p_audience text,
  p_title text,
  p_message text,
  p_course uuid default null,
  p_student uuid default null,
  p_grade smallint default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_campaign uuid := gen_random_uuid();
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_title is null or char_length(trim(p_title)) < 2 or char_length(trim(p_title)) > 120 then
    raise exception 'title must be between 2 and 120 characters' using errcode = '22023';
  end if;
  if p_message is null or char_length(trim(p_message)) < 2 or char_length(trim(p_message)) > 3000 then
    raise exception 'message must be between 2 and 3000 characters' using errcode = '22023';
  end if;

  if p_audience = 'course' then
    if p_course is null or not exists (select 1 from public.courses c where c.id = p_course) then
      raise exception 'course not found' using errcode = '22023';
    end if;
    insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
    select distinct p.id, 'admin_broadcast', v_campaign, trim(p_title), trim(p_message), '/dashboard/courses/' || p_course
    from public.enrollments en
    join public.profiles p on p.id = en.user_id
    where en.course_id = p_course and p.role = 'student';
  elsif p_audience = 'student' then
    if p_student is null or not exists (select 1 from public.profiles p where p.id = p_student and p.role = 'student') then
      raise exception 'student not found' using errcode = '22023';
    end if;
    insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
    select p.id, 'admin_broadcast', v_campaign, trim(p_title), trim(p_message), '/dashboard'
    from public.profiles p where p.id = p_student and p.role = 'student';
  elsif p_audience = 'grade' then
    if p_grade is null or p_grade not between 1 and 9 then
      raise exception 'invalid grade' using errcode = '22023';
    end if;
    insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
    select p.id, 'admin_broadcast', v_campaign, trim(p_title), trim(p_message), '/dashboard'
    from public.profiles p where p.role = 'student' and p.grade = p_grade;
  elsif p_audience = 'all' then
    insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
    select p.id, 'admin_broadcast', v_campaign, trim(p_title), trim(p_message), '/dashboard'
    from public.profiles p where p.role = 'student';
  else
    raise exception 'invalid audience' using errcode = '22023';
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_send_student_notification(text, text, text, uuid, uuid, smallint) from public, anon;
grant execute on function public.admin_send_student_notification(text, text, text, uuid, uuid, smallint) to authenticated;
