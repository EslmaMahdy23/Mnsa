-- الخطوة 17: الأدمن يحدد لكل قسم هل لازم النجاح في امتحان القسم اللي قبله ولا لأ
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 16_section_lock.sql)
--
-- القاعدة الجديدة (بتحل محل قاعدة ملف 16):
--  1) كل قسم عنده خيار require_pass_prev (الأدمن بيختاره من صفحة تعديل القسم):
--       true  = القسم ده مقفول لحد ما الطالب ينجح في امتحانات القسم اللي قبله مباشرةً
--       false = القسم مفتوح عادي (الطالب يدخله من غير ما يمتحن)
--  2) القفل بيبص على القسم اللي قبله مباشرةً بس (مش كل الأقسام اللي فاتت).
--     لو القسم اللي قبله مفيهوش امتحان منشور فيه أسئلة، مفيش قفل.
--  3) الأقسام الموجودة دلوقتي بتبقى true (يعني لازم ينجح) وتقدر تغيّرها من كل قسم.
--  4) القسم الأول مالوش قسم قبله، فالخيار ما بيأثرش عليه.
--  5) الأدمن ومدرّس الكورس مفيش عليهم قفل.
--  6) start_exam (من ملف 16) بتستخدم دالة is_section_unlocked، فهي بتاخد القاعدة الجديدة لوحدها.

-- ========== 1) العمود ==========
alter table public.course_sections
  add column if not exists require_pass_prev boolean not null default true;

-- ========== 2) هل القسم مفتوح للمستخدم الحالي؟ ==========
-- بتخرج بسرعة لو الأدمن أو المدرّس أو القسم مش مطلوب فيه نجاح (عشان بتتنفّذ مع كل درس في RLS)
create or replace function public.is_section_unlocked(p_section uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select
    (select public.is_admin())
    or coalesce((
      select
        c.teacher_id = (select auth.uid())
        or not s.require_pass_prev
        or not exists (
          select 1
          from public.exams e
          where e.section_id = (
                  select p.id from public.course_sections p
                  where p.course_id = s.course_id
                    and (p.position, p.created_at, p.id) < (s.position, s.created_at, s.id)
                  order by p.position desc, p.created_at desc, p.id desc
                  limit 1)
            and e.is_published and e.question_count > 0
            and not exists (
              select 1 from public.exam_attempts a
              where a.exam_id = e.id and a.user_id = (select auth.uid()) and a.passed is true
            )
        )
      from public.course_sections s
      join public.courses c on c.id = s.course_id
      where s.id = p_section
    ), true);
$$;

-- ========== 3) حالة قفل كل أقسام كورس (للواجهة) ==========
create or replace function public.get_course_section_locks(p_course uuid)
returns table (section_id uuid, locked boolean, blocking_exam_id uuid, blocking_exam_title text)
language sql security definer stable set search_path = public as $$
  select s.id, (b.id is not null), b.id, b.title
  from public.course_sections s
  join public.courses c on c.id = s.course_id
  left join lateral (
    select e.id, e.title
    from public.exams e
    where s.require_pass_prev
      and e.section_id = (
            select p.id from public.course_sections p
            where p.course_id = s.course_id
              and (p.position, p.created_at, p.id) < (s.position, s.created_at, s.id)
            order by p.position desc, p.created_at desc, p.id desc
            limit 1)
      and e.is_published and e.question_count > 0
      and not exists (
        select 1 from public.exam_attempts a
        where a.exam_id = e.id and a.user_id = (select auth.uid()) and a.passed is true
      )
    order by e.position, e.created_at
    limit 1
  ) b on not (
    (select public.is_admin()) or c.teacher_id = (select auth.uid())
  )
  where s.course_id = p_course
    and (c.is_published or c.teacher_id = (select auth.uid()) or (select public.is_admin()))
  order by s.position, s.created_at, s.id;
$$;

-- ========== 4) الصلاحيات ==========
revoke all on function public.is_section_unlocked(uuid) from public, anon;
revoke all on function public.get_course_section_locks(uuid) from public, anon;
grant execute on function public.is_section_unlocked(uuid) to authenticated;
grant execute on function public.get_course_section_locks(uuid) to authenticated;
