-- صفحة "طلابي" للمدرّس: طلاب كورسه وتقدّمهم ونتايج امتحاناتهم
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 61_teacher_exams.sql)
--
-- بنستخدم دالة واحدة (security definer) بدل ما نفتح جداول الطلاب للمدرّس:
--  * المدرّس لازم يكون صاحب الكورس، وإلا الدالة بترفض.
--  * بترجّع الاسم والسنة الدراسية بس (من غير رقم التليفون أو الإيميل).
--  * بترجّع الامتحانات المنشورة بس، ونتايج المحاولات المسلَّمة.

create or replace function public.teacher_course_students(p_course uuid)
returns json
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.courses c where c.id = p_course and c.teacher_id = auth.uid()) then
    raise exception 'course_not_found' using errcode = 'P0002';
  end if;

  return json_build_object(
    'content_total', (select count(*) from public.lessons l where l.course_id = p_course)
      + (select count(*) from public.exams e where e.course_id = p_course and e.is_published and e.question_count > 0),
    'exams', coalesce((
      select json_agg(json_build_object('id', e.id, 'title', e.title) order by e.created_at)
        from public.exams e
       where e.course_id = p_course and e.is_published and e.question_count > 0
    ), '[]'::json),
    'students', coalesce((
      select json_agg(json_build_object(
               'user_id', en.user_id,
               'name', p.full_name,
               'grade', p.grade,
               'enrolled_at', en.enrolled_at,
               'content_done', (
                 select count(*) from public.lesson_progress lp
                   join public.lessons l on l.id = lp.lesson_id
                  where lp.user_id = en.user_id and l.course_id = p_course
               ) + (
                 select count(*) from public.exam_attempts a join public.exams e on e.id = a.exam_id
                  where a.user_id = en.user_id and e.course_id = p_course and e.is_published
                    and a.submitted_at is not null
               ),
               'last_activity', (
                 select max(activity_at) from (
                   select lp.completed_at as activity_at from public.lesson_progress lp
                     join public.lessons l on l.id = lp.lesson_id
                    where lp.user_id = en.user_id and l.course_id = p_course
                   union all
                   select a.submitted_at from public.exam_attempts a join public.exams e on e.id = a.exam_id
                    where a.user_id = en.user_id and e.course_id = p_course and a.submitted_at is not null
                 ) activity
               ),
               'attempts', coalesce((
                 select json_agg(json_build_object(
                          'exam_id', a.exam_id, 'percent', a.percent, 'passed', a.passed,
                          'pending', a.essay_pending, 'submitted_at', a.submitted_at))
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
