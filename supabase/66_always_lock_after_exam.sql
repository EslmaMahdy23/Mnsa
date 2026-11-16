-- القفل:
--  1) لو الامتحان معلّم عليه "اقفل اللي بعده" (lock_following) = أي عنصر بعده في نفس القسم مقفول لحد ما الطالب ينجح فيه (حتى لو لسه ما دخلهوش).
--     لو مش معلّم = اللي بعده مفتوح.
--  2) أي قسم بعد قسم فيه امتحان منشور = مقفول بالكامل لحد ما الطالب ينجح في كل امتحانات الأقسام اللي قبله.
--  3) الأدمن ومدرّس الكورس ومدير المحتوى مفيش عليهم قفل. والامتحانات القديمة (من غير قسم) زي ما هي.
-- الخيار require_pass_prev بقى من غير تأثير (قفل الأقسام ثابت).
-- شغّله بعد 65_support_and_progression_lock_fixes.sql

-- ========== 1) هل القسم مفتوح؟ ==========
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

-- ========== 2) هل الامتحان مفتوح؟ ==========
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
            and blocker.id<>e.id
            and blocker.lock_following
            and blocker.is_published and blocker.question_count>0
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

-- ========== 3) هل الدرس مفتوح؟ ==========
-- الدرس بيتقفل لو في امتحان قبله (position أصغر) في نفس القسم ولسه الطالب منجحش فيه.
-- المقارنة بالـ position بس، عشان تطابق ترتيب العرض في الصفحة.
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
          where blocker.section_id=l.section_id
            and blocker.lock_following
            and blocker.is_published and blocker.question_count>0
            and blocker.position<l.position
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

-- ========== 4) حالة قفل أقسام الكورس (للواجهة) ==========
create or replace function public.get_course_section_locks(p_course uuid)
returns table (section_id uuid, locked boolean, blocking_exam_id uuid, blocking_exam_title text)
language sql security definer stable set search_path=public as $$
  select s.id, (b.id is not null), b.id, b.title
  from public.course_sections s
  join public.courses c on c.id=s.course_id
  left join lateral (
    select e.id, e.title
    from public.course_sections prev
    join public.exams e on e.section_id=prev.id and e.is_published and e.question_count>0
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

-- ========== 5) العناصر المقفولة جوه القسم (عنوان ونوع بس، من غير روابط) ==========
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
  ), locked_lessons as (
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
  ), locked_exams as (
    select e.section_id, e.id as item_id, 'exam'::text as item_type,
           'exam'::text as content_kind, e.title, e.position, blocker.title as blocking_exam_title
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
  )
  select * from locked_lessons
  union all
  select * from locked_exams;
$$;

-- ========== 6) الصلاحيات ==========
revoke all on function public.is_section_unlocked(uuid) from public, anon;
revoke all on function public.is_exam_unlocked(uuid) from public, anon;
revoke all on function public.is_lesson_unlocked(uuid) from public, anon;
revoke all on function public.get_course_section_locks(uuid) from public, anon;
revoke all on function public.get_course_locked_items(uuid) from public, anon;
grant execute on function public.is_section_unlocked(uuid) to authenticated;
grant execute on function public.is_exam_unlocked(uuid) to authenticated;
grant execute on function public.is_lesson_unlocked(uuid) to authenticated;
grant execute on function public.get_course_section_locks(uuid) to authenticated;
grant execute on function public.get_course_locked_items(uuid) to authenticated;
