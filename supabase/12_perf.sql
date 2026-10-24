-- الخطوة 12: تسريع سياسات الأمان (RLS) من غير ما نغيّر مين يشوف إيه
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 02 لحد 11)
--
-- المشكلة: auth.uid() وpublic.is_admin() جوه السياسات كانوا بيتنفّذوا مرة لكل صف.
-- لما تفتح كورس فيه دروس كتير، كل درس كان بيدفع تمن استعلامات إضافية.
-- الحل: نلفّهم في (select ...) فالداتابيز تحسبهم مرة واحدة للاستعلام كله.
-- كمان سياسات "write" كانت for all، يعني بتتنفّذ مع كل قراءة (select) فوق سياسة القراءة.
-- بنقسمها لإضافة وتعديل وحذف، ومفيش تغيير في الصلاحيات (المدرّس صاحب الكورس والأدمن
-- بيشوفوا كل حاجة أصلاً من سياسات القراءة).

-- ========== 1) دوال الصلاحيات ==========
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

create or replace function public.is_teacher()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('teacher', 'admin'));
$$;

-- ========== 2) الكورسات (القراءة بس، باقي السياسات زي ما هي) ==========
drop policy if exists "courses read" on public.courses;
create policy "courses read" on public.courses for select
  using (is_published or teacher_id = (select auth.uid()) or (select public.is_admin()));

-- ========== 3) الدروس ==========
drop policy if exists "lessons read" on public.lessons;
create policy "lessons read" on public.lessons for select
  using (exists (
    select 1 from public.courses c
    where c.id = lessons.course_id
      and (
        c.teacher_id = (select auth.uid()) or (select public.is_admin())
        or (c.is_published and (
          lessons.is_free_preview
          or exists (select 1 from public.enrollments e
                     where e.course_id = c.id and e.user_id = (select auth.uid()))
        ))
      )
  ));

drop policy if exists "lessons write" on public.lessons;
drop policy if exists "lessons insert" on public.lessons;
drop policy if exists "lessons update" on public.lessons;
drop policy if exists "lessons delete" on public.lessons;

create policy "lessons insert" on public.lessons for insert
  with check (exists (select 1 from public.courses c
                      where c.id = lessons.course_id
                        and (c.teacher_id = (select auth.uid()) or (select public.is_admin()))));
create policy "lessons update" on public.lessons for update
  using (exists (select 1 from public.courses c
                 where c.id = lessons.course_id
                   and (c.teacher_id = (select auth.uid()) or (select public.is_admin()))))
  with check (exists (select 1 from public.courses c
                      where c.id = lessons.course_id
                        and (c.teacher_id = (select auth.uid()) or (select public.is_admin()))));
create policy "lessons delete" on public.lessons for delete
  using (exists (select 1 from public.courses c
                 where c.id = lessons.course_id
                   and (c.teacher_id = (select auth.uid()) or (select public.is_admin()))));

-- ========== 4) أقسام الكورس ==========
drop policy if exists "sections read" on public.course_sections;
create policy "sections read" on public.course_sections for select
  using (exists (
    select 1 from public.courses c
    where c.id = course_sections.course_id
      and (c.is_published or c.teacher_id = (select auth.uid()) or (select public.is_admin()))
  ));

drop policy if exists "sections write" on public.course_sections;
drop policy if exists "sections insert" on public.course_sections;
drop policy if exists "sections update" on public.course_sections;
drop policy if exists "sections delete" on public.course_sections;

create policy "sections insert" on public.course_sections for insert
  with check (exists (select 1 from public.courses c
                      where c.id = course_sections.course_id
                        and (c.teacher_id = (select auth.uid()) or (select public.is_admin()))));
create policy "sections update" on public.course_sections for update
  using (exists (select 1 from public.courses c
                 where c.id = course_sections.course_id
                   and (c.teacher_id = (select auth.uid()) or (select public.is_admin()))))
  with check (exists (select 1 from public.courses c
                      where c.id = course_sections.course_id
                        and (c.teacher_id = (select auth.uid()) or (select public.is_admin()))));
create policy "sections delete" on public.course_sections for delete
  using (exists (select 1 from public.courses c
                 where c.id = course_sections.course_id
                   and (c.teacher_id = (select auth.uid()) or (select public.is_admin()))));

-- ========== 5) التسجيل والتقدّم (القراءة بس) ==========
drop policy if exists "enrollments read" on public.enrollments;
create policy "enrollments read" on public.enrollments for select
  using (user_id = (select auth.uid()) or (select public.is_admin())
         or exists (select 1 from public.courses c
                    where c.id = enrollments.course_id and c.teacher_id = (select auth.uid())));

-- التقدّم: كل طالب يشوف ويعدّل تقدّمه هو بس (نفس المنطق، بس auth.uid() متغلّف)
drop policy if exists "progress own" on public.lesson_progress;
create policy "progress own" on public.lesson_progress for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ========== 6) فهرس ناقص: لما درس يتحذف الداتابيز بتدوّر على تقدّمه ==========
create index if not exists lesson_progress_lesson_idx on public.lesson_progress (lesson_id);
