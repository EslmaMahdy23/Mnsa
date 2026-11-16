-- 1) كل امتحان له خيار: "شرط لفتح القسم اللي بعده" (افتراضي: نعم، زي ما كان).
--    لو الخيار ده مش معلّم، الامتحان ده عادي ومش بيقفل القسم التالي.
-- 2) القسم المقفول بيعرض عناصره (عنوان ونوع بس) بعلامة قفل، من غير أي رابط أو محتوى.
-- شغّله بعد 66_always_lock_after_exam.sql

alter table public.exams
  add column if not exists gates_next_section boolean not null default true;

-- حفظ الخيار (الأدمن أو مدرّس الكورس بس)
create or replace function public.set_exam_gates_next_section(p_exam uuid, p_value boolean)
returns void
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  if not (
    public.is_admin()
    or exists (
      select 1 from public.exams e join public.courses c on c.id=e.course_id
      where e.id=p_exam and c.teacher_id=auth.uid()
    )
  ) then raise exception 'not allowed' using errcode='42501'; end if;
  update public.exams set gates_next_section=coalesce(p_value,true) where id=p_exam;
end;
$$;
revoke all on function public.set_exam_gates_next_section(uuid,boolean) from public, anon;
grant execute on function public.set_exam_gates_next_section(uuid,boolean) to authenticated;

-- ========== هل القسم مفتوح؟ (بس الامتحانات اللي "شرط" بتقفل) ==========
create or replace function public.is_section_unlocked(p_section uuid)
returns boolean
language sql security definer stable set search_path=public as $$
  select case
    when (select public.is_admin()) or (select public.can_manage_course_content()) then true
    when (select auth.uid()) is null then false
    else coalesce((
      select c.teacher_id=(select auth.uid()) or not exists (
        select 1
        from public.course_sections prev
        join public.exams e on e.section_id=prev.id
        where prev.course_id=s.course_id
          and (prev.position,prev.created_at,prev.id)<(s.position,s.created_at,s.id)
          and e.is_published and e.question_count>0 and e.gates_next_section
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

-- ========== حالة قفل الأقسام (للواجهة) ==========
create or replace function public.get_course_section_locks(p_course uuid)
returns table (section_id uuid, locked boolean, blocking_exam_id uuid, blocking_exam_title text)
language sql security definer stable set search_path=public as $$
  select s.id, (b.id is not null), b.id, b.title
  from public.course_sections s
  join public.courses c on c.id=s.course_id
  left join lateral (
    select e.id, e.title
    from public.course_sections prev
    join public.exams e on e.section_id=prev.id and e.is_published and e.question_count>0 and e.gates_next_section
    where prev.course_id=s.course_id
      and (prev.position,prev.created_at,prev.id)<(s.position,s.created_at,s.id)
      and not exists (
        select 1 from public.exam_attempts a
        where a.exam_id=e.id and a.user_id=(select auth.uid()) and a.passed is true
      )
    order by prev.position, prev.created_at, prev.id, e.position, e.created_at, e.id
    limit 1
  ) b on not (
    (select public.is_admin()) or (select public.can_manage_course_content()) or c.teacher_id=(select auth.uid())
  )
  where s.course_id=p_course
    and (c.is_published or c.teacher_id=(select auth.uid()) or (select public.is_admin()))
  order by s.position, s.created_at, s.id;
$$;

-- ========== العناصر المقفولة (عنوان ونوع بس، من غير روابط) ==========
-- بترجّع: (أ) عناصر بعد امتحان "اقفل اللي بعده" في نفس القسم، (ب) كل عناصر الأقسام المقفولة.
drop function if exists public.get_course_locked_items(uuid);
create or replace function public.get_course_locked_items(p_course uuid)
returns table(
  section_id uuid,
  item_id uuid,
  item_type text,
  content_kind text,
  title text,
  "position" integer,
  blocking_exam_title text
)
language sql security definer stable set search_path=public as $$
  with eligible_course as (
    select c.id
    from public.courses c
    where c.id=p_course and c.is_published
      and not (select public.is_admin())
      and not (select public.can_manage_course_content())
      and c.teacher_id is distinct from (select auth.uid())
      and exists (
        select 1 from public.enrollments en
        where en.course_id=c.id and en.user_id=(select auth.uid())
      )
  ), section_blockers as (
    select s.id as section_id, b.title
    from public.course_sections s
    join eligible_course c on c.id=s.course_id
    join lateral (
      select e.title
      from public.course_sections prev
      join public.exams e on e.section_id=prev.id and e.is_published and e.question_count>0 and e.gates_next_section
      where prev.course_id=s.course_id
        and (prev.position,prev.created_at,prev.id)<(s.position,s.created_at,s.id)
        and not exists (
          select 1 from public.exam_attempts a
          where a.exam_id=e.id and a.user_id=(select auth.uid()) and a.passed is true
        )
      order by prev.position, prev.created_at, prev.id, e.position, e.created_at, e.id
      limit 1
    ) b on true
  ), all_locked as (
    -- (أ) دروس بعد امتحان قافل اللي بعده
    select l.section_id, l.id as item_id, 'lesson'::text as item_type,
           case when l.kind='video' then 'video' else 'file' end::text as content_kind,
           l.title, l.position, blocker.title as blocking_exam_title
    from public.lessons l
    join eligible_course c on c.id=l.course_id
    join lateral (
      select e.title
      from public.exams e
      where e.section_id=l.section_id
        and e.lock_following
        and e.is_published and e.question_count>0
        and e.position<l.position
        and not exists (
          select 1 from public.exam_attempts a
          where a.exam_id=e.id and a.user_id=(select auth.uid()) and a.passed is true
        )
      order by e.position desc, e.created_at desc, e.id desc
      limit 1
    ) blocker on true
    union all
    -- (أ) امتحانات بعد امتحان قافل اللي بعده
    select e.section_id, e.id, 'exam'::text, 'exam'::text, e.title, e.position, blocker.title
    from public.exams e
    join eligible_course c on c.id=e.course_id
    join lateral (
      select previous.title
      from public.exams previous
      where previous.section_id=e.section_id and previous.id<>e.id
        and previous.lock_following
        and previous.is_published and previous.question_count>0
        and (previous.position,previous.created_at,previous.id)<(e.position,e.created_at,e.id)
        and not exists (
          select 1 from public.exam_attempts a
          where a.exam_id=previous.id and a.user_id=(select auth.uid()) and a.passed is true
        )
      order by previous.position desc, previous.created_at desc, previous.id desc
      limit 1
    ) blocker on true
    where e.is_published and e.question_count>0
    union all
    -- (ب) كل دروس الأقسام المقفولة
    select l.section_id, l.id, 'lesson'::text,
           case when l.kind='video' then 'video' else 'file' end::text,
           l.title, l.position, sb.title
    from public.lessons l
    join section_blockers sb on sb.section_id=l.section_id
    union all
    -- (ب) كل امتحانات الأقسام المقفولة
    select e.section_id, e.id, 'exam'::text, 'exam'::text, e.title, e.position, sb.title
    from public.exams e
    join section_blockers sb on sb.section_id=e.section_id
    where e.is_published and e.question_count>0
  )
  select distinct on (item_id) section_id, item_id, item_type, content_kind, title, "position", blocking_exam_title
  from all_locked
  order by item_id;
$$;

revoke all on function public.is_section_unlocked(uuid) from public, anon;
revoke all on function public.get_course_section_locks(uuid) from public, anon;
revoke all on function public.get_course_locked_items(uuid) from public, anon;
grant execute on function public.is_section_unlocked(uuid) to authenticated;
grant execute on function public.get_course_section_locks(uuid) to authenticated;
grant execute on function public.get_course_locked_items(uuid) to authenticated;
