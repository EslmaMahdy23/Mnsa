-- Restore database-enforced lesson/exam locks after role-policy migrations,
-- and make failed support-ticket creation report a useful error.
-- Run after 64_teacher_grading_and_retries.sql.

create or replace function public.is_section_unlocked(p_section uuid)
returns boolean
language sql security definer stable set search_path=public as $$
  select case
    when (select public.is_admin()) or (select public.can_manage_course_content()) then true
    when (select auth.uid()) is null then false
    else coalesce((
      select c.teacher_id=(select auth.uid()) or not s.require_pass_prev or not exists (
        select 1
        from public.course_sections previous_section
        join public.exams e on e.section_id=previous_section.id
        where previous_section.course_id=s.course_id
          and (previous_section.position,previous_section.created_at,previous_section.id)
              < (s.position,s.created_at,s.id)
          and not exists (
            select 1 from public.course_sections between_section
            where between_section.course_id=s.course_id
              and (between_section.position,between_section.created_at,between_section.id)
                  > (previous_section.position,previous_section.created_at,previous_section.id)
              and (between_section.position,between_section.created_at,between_section.id)
                  < (s.position,s.created_at,s.id)
          )
          and e.is_published and e.question_count>0
          and not exists (
            select 1 from public.exam_attempts a
            where a.exam_id=e.id and a.user_id=(select auth.uid()) and a.passed is true
          )
      )
      from public.course_sections s join public.courses c on c.id=s.course_id
      where s.id=p_section
    ),false)
  end;
$$;

create or replace function public.is_exam_unlocked(p_exam uuid)
returns boolean
language sql security definer stable set search_path=public as $$
  select case
    when (select public.is_admin()) or (select public.can_manage_course_content()) then true
    when (select auth.uid()) is null then false
    else coalesce((
      select (c.teacher_id=(select auth.uid())) or (
        (e.section_id is null or public.is_section_unlocked(e.section_id))
        and not exists (
          select 1 from public.exams blocker
          where e.section_id is not null and blocker.section_id=e.section_id
            and blocker.lock_following and blocker.is_published and blocker.question_count>0
            and (blocker.position,blocker.created_at,blocker.id)<(e.position,e.created_at,e.id)
            and not exists (
              select 1 from public.exam_attempts a
              where a.exam_id=blocker.id and a.user_id=(select auth.uid()) and a.passed is true
            )
        )
      )
      from public.exams e left join public.courses c on c.id=e.course_id
      where e.id=p_exam
    ),false)
  end;
$$;

create or replace function public.is_lesson_unlocked(p_lesson uuid)
returns boolean
language sql security definer stable set search_path=public as $$
  select case
    when (select public.is_admin()) or (select public.can_manage_course_content()) then true
    when (select auth.uid()) is null then false
    else coalesce((
      select (c.teacher_id=(select auth.uid())) or (
        public.is_section_unlocked(l.section_id)
        and not exists (
          select 1 from public.exams blocker
          where blocker.section_id=l.section_id and blocker.lock_following
            and blocker.is_published and blocker.question_count>0
            and (blocker.position,blocker.created_at,blocker.id)<(l.position,l.created_at,l.id)
            and not exists (
              select 1 from public.exam_attempts a
              where a.exam_id=blocker.id and a.user_id=(select auth.uid()) and a.passed is true
            )
        )
      )
      from public.lessons l join public.courses c on c.id=l.course_id
      where l.id=p_lesson
    ),false)
  end;
$$;

-- Free preview may bypass enrollment, but never a failed progression lock.
drop policy if exists "lessons read" on public.lessons;
create policy "lessons read" on public.lessons for select to authenticated
using (exists (
  select 1 from public.courses c
  where c.id=lessons.course_id and (
    c.teacher_id=(select auth.uid()) or (select public.can_manage_course_content())
    or (c.is_published and public.is_lesson_unlocked(lessons.id)
      and (lessons.is_free_preview or exists (
        select 1 from public.enrollments en
        where en.course_id=c.id and en.user_id=(select auth.uid())
      )))
  )
));

-- Migration 44 removed is_exam_unlocked from the general course-exam policy.
drop policy if exists "exams read" on public.exams;
create policy "exams read" on public.exams for select to authenticated
using (
  (select public.is_admin())
  or ((select public.can_manage_course_content()) and course_id is not null)
  or (is_published and (
    course_id is null
    or exists (select 1 from public.enrollments en
      where en.course_id=exams.course_id and en.user_id=(select auth.uid()))
  ) and public.is_exam_unlocked(exams.id))
);

revoke all on function public.is_section_unlocked(uuid) from public,anon;
revoke all on function public.is_exam_unlocked(uuid) from public,anon;
revoke all on function public.is_lesson_unlocked(uuid) from public,anon;
grant execute on function public.is_section_unlocked(uuid) to authenticated;
grant execute on function public.is_exam_unlocked(uuid) to authenticated;
grant execute on function public.is_lesson_unlocked(uuid) to authenticated;

-- Recheck the essay result against the pass threshold captured when the
-- attempt started, so changing exam settings cannot unlock later content.
create or replace function public.admin_grade_exam_essays(p_attempt uuid,p_grades jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_owner uuid; v_role text; v_result json; v_percent integer; v_threshold integer; v_pass boolean;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if v_role is null or v_role not in ('admin','teacher','essay_grader') then
    raise exception 'not allowed' using errcode='42501';
  end if;
  select coalesce(c.teacher_id,e.created_by) into v_owner
  from public.exam_attempts a join public.exams e on e.id=a.exam_id
  left join public.courses c on c.id=e.course_id where a.id=p_attempt;
  if not public.is_admin() and not (
    (v_role='teacher' and v_owner=auth.uid())
    or (v_role='essay_grader' and (
      not exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid())
      or exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid() and teacher_id=v_owner)
    ))
  ) then raise exception 'not allowed' using errcode='42501'; end if;

  v_result:=public.admin_grade_exam_essays_core(p_attempt,p_grades);
  select a.percent,coalesce(a.pass_percent_snapshot,e.pass_percent,50)
    into v_percent,v_threshold
  from public.exam_attempts a join public.exams e on e.id=a.exam_id where a.id=p_attempt;
  v_pass:=v_percent>=v_threshold;
  update public.exam_attempts set passed=v_pass where id=p_attempt;
  return jsonb_set(v_result::jsonb,'{passed}',to_jsonb(v_pass),true)::json;
end;
$$;
revoke all on function public.admin_grade_exam_essays(uuid,jsonb) from public,anon;
grant execute on function public.admin_grade_exam_essays(uuid,jsonb) to authenticated;

create or replace function public.create_support_ticket(p_subject text,p_message text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_ticket_id uuid;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  if exists(select 1 from public.profiles p where p.id=v_user and p.role in ('admin','support_agent')) then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  if p_subject is null or char_length(trim(p_subject)) not between 1 and 120
     or p_message is null or char_length(trim(p_message)) not between 1 and 2000 then
    raise exception 'bad_ticket_content' using errcode='22023';
  end if;
  insert into public.support_tickets(user_id,subject,status)
  values(v_user,trim(p_subject),'waiting_admin') returning id into v_ticket_id;
  insert into public.support_messages(ticket_id,sender_id,sender_role,body)
  values(v_ticket_id,v_user,'student',trim(p_message));
  return v_ticket_id;
end;
$$;
revoke all on function public.create_support_ticket(text,text) from public,anon;
grant execute on function public.create_support_ticket(text,text) to authenticated;
