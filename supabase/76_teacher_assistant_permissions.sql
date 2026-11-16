-- Expand the existing teacher essay assistant with scoped retry and parent
-- report permissions. Assistants do not receive course or lesson management.
-- Run after 75_shared_course_files_collapse.sql and _parent_report_period.sql.

create or replace function public.is_teacher_assistant()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    join public.teacher_exam_graders g on g.grader_id = p.id
    where p.id = (select auth.uid()) and p.role = 'essay_grader'
  );
$$;

create or replace function public.teacher_assistant_courses()
returns table(id uuid, title text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.is_teacher_assistant() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select distinct c.id, c.title
    from public.teacher_exam_graders g
    join public.courses c on c.teacher_id = g.teacher_id
    where g.grader_id = v_user
    order by c.created_at desc;
end;
$$;

revoke all on function public.is_teacher_assistant() from public, anon;
revoke all on function public.teacher_assistant_courses() from public, anon;
grant execute on function public.is_teacher_assistant() to authenticated;
grant execute on function public.teacher_assistant_courses() to authenticated;

-- Replace the period-aware generator with a version that also accepts an
-- assistant assigned to the teacher whose enrolled student is being reported.
create or replace function public.create_parent_report_link(p_student uuid, p_from date, p_to date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'invalid_report_period' using errcode = '22023';
  end if;

  select p.role into v_role from public.profiles p where p.id = p_student;
  if v_role is distinct from 'student' then raise exception 'student_not_found' using errcode = 'P0002'; end if;

  if v_role <> 'student' or not (
    public.is_admin()
    or exists (
      select 1
      from public.enrollments en
      join public.courses c on c.id = en.course_id
      where en.user_id = p_student
        and (c.teacher_id = v_user or exists (
          select 1 from public.teacher_exam_graders g
          where g.teacher_id = c.teacher_id and g.grader_id = v_user
        ))
    )
  ) then
    raise exception 'student_not_in_teacher_courses' using errcode = '42501';
  end if;

  update public.parent_report_links set is_active = false
  where student_id = p_student and is_active;

  insert into public.parent_report_links(student_id, token, created_by, report_from, report_to)
  values (p_student, v_token, v_user, p_from, p_to);
  return v_token;
end;
$$;

revoke all on function public.create_parent_report_link(uuid,date,date) from public, anon;
grant execute on function public.create_parent_report_link(uuid,date,date) to authenticated;

drop function if exists public.get_parent_report_links(uuid[]);
create function public.get_parent_report_links(p_students uuid[])
returns table(student_id uuid, token text, report_from date, report_to date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return query
  select l.student_id, l.token, l.report_from, l.report_to
  from public.parent_report_links l
  where l.is_active
    and l.student_id = any(coalesce(p_students, array[]::uuid[]))
    and (
      public.is_admin()
      or exists (
        select 1 from public.enrollments en
        join public.courses c on c.id = en.course_id
        where en.user_id = l.student_id and c.teacher_id = v_user
      )
      or exists (
        select 1 from public.enrollments en
        join public.courses c on c.id = en.course_id
        join public.teacher_exam_graders g on g.teacher_id = c.teacher_id
        where en.user_id = l.student_id and g.grader_id = v_user
      )
    );
end;
$$;

revoke all on function public.get_parent_report_links(uuid[]) from public, anon;
grant execute on function public.get_parent_report_links(uuid[]) to authenticated;

-- Same roster shape as the existing teacher page. Scope permits either the
-- course owner or that teacher's assigned assistant, never unrelated courses.
create or replace function public.teacher_course_students(p_course uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.courses c
    where c.id = p_course and (
      c.teacher_id = v_user
      or exists (select 1 from public.teacher_exam_graders g where g.teacher_id = c.teacher_id and g.grader_id = v_user)
    )
  ) then
    raise exception 'course_not_found' using errcode = 'P0002';
  end if;

  return json_build_object(
    'content_total', (select count(*) from public.lessons l where l.course_id = p_course)
      + (select count(*) from public.exams e where e.course_id = p_course and e.is_published and e.question_count > 0),
    'exams', coalesce((
      select json_agg(json_build_object('id', e.id, 'title', e.title) order by e.created_at)
      from public.exams e where e.course_id = p_course and e.is_published and e.question_count > 0
    ), '[]'::json),
    'students', coalesce((
      select json_agg(json_build_object(
        'user_id', en.user_id, 'name', p.full_name, 'grade', p.grade,
        'parent_phone', p.parent_phone, 'enrolled_at', en.enrolled_at,
        'content_done', (
          select count(*) from public.lesson_progress lp
          join public.lessons l on l.id = lp.lesson_id
          where lp.user_id = en.user_id and l.course_id = p_course
        ) + (
          select count(*) from public.exam_attempts a
          join public.exams e on e.id = a.exam_id
          where a.user_id = en.user_id and e.course_id = p_course and e.is_published and a.submitted_at is not null
        ),
        'last_activity', (
          select max(activity_at) from (
            select lp.completed_at as activity_at from public.lesson_progress lp
            join public.lessons l on l.id = lp.lesson_id
            where lp.user_id = en.user_id and l.course_id = p_course
            union all
            select a.submitted_at from public.exam_attempts a
            join public.exams e on e.id = a.exam_id
            where a.user_id = en.user_id and e.course_id = p_course and a.submitted_at is not null
          ) activity
        ),
        'attempts', coalesce((
          select json_agg(json_build_object(
            'exam_id', a.exam_id, 'percent', a.percent, 'passed', a.passed,
            'pending', a.essay_pending, 'submitted_at', a.submitted_at
          ) order by a.submitted_at desc)
          from public.exam_attempts a
          join public.exams e on e.id = a.exam_id
          where a.user_id = en.user_id and e.course_id = p_course and a.submitted_at is not null
        ), '[]'::json)
      ) order by en.enrolled_at desc)
      from public.enrollments en
      join public.profiles p on p.id = en.user_id
      where en.course_id = p_course
    ), '[]'::json)
  );
end;
$$;

revoke all on function public.teacher_course_students(uuid) from public, anon;
grant execute on function public.teacher_course_students(uuid) to authenticated;
