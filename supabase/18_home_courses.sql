-- الخطوة 18: كورسات الصفحة الرئيسية (الأدمن يختار) + معاينة الكورس للزائر من غير تسجيل دخول
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 17_section_lock_toggle.sql)
--
-- الفكرة:
--  1) الأدمن يعلّم أي كورس منشور بـ "يظهر في الصفحة الرئيسية" (show_on_home) ويرتّبهم (home_position).
--  2) الزائر (من غير حساب) يشوف الكورسات دي في الرئيسية، ويفتح صفحة الكورس يشوف الأقسام
--     وعناوين الفيديوهات والملفات والامتحانات.
--  3) روابط الفيديو والملف بتتبعت للزائر لدروس "المعاينة المجانية" (is_free_preview) بس.
--     أي درس تاني الزائر يشوف عنوانه بس، من غير الرابط.
--  4) الزائر مبيقرأش جداول الكورسات مباشرةً (RLS زي ما هي)، كل حاجة بتعدّي من دالتين بيرجّعوا
--     الحد الأدنى المسموح بيه.
--  5) المدرّس العادي مايقدرش يغيّر show_on_home / home_position، الأدمن بس (زي السعر بالظبط).

-- ========== 1) الأعمدة ==========
alter table public.courses
  add column if not exists show_on_home boolean not null default false,
  add column if not exists home_position int not null default 0;

-- ========== 2) حماية: الأدمن بس يغيّر ظهور الكورس في الرئيسية ==========
-- (auth.uid() فاضي = تشغيل من SQL Editor أو من السيرفر، وده مسموح)
create or replace function public.guard_course_home()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.show_on_home := false;
      new.home_position := 0;
    else
      new.show_on_home := old.show_on_home;
      new.home_position := old.home_position;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists courses_home_guard on public.courses;
create trigger courses_home_guard
  before insert or update on public.courses
  for each row execute function public.guard_course_home();

create index if not exists courses_home_idx on public.courses (home_position, created_at desc) where show_on_home;

-- ========== 3) كورسات الرئيسية (للزائر وللطالب) ==========
create or replace function public.get_home_courses()
returns table (
  id uuid,
  title text,
  description text,
  cover_url text,
  grade smallint,
  price numeric,
  teacher_name text,
  sections_count bigint,
  lessons_count bigint
)
language sql security definer stable set search_path = public as $$
  select c.id, c.title, c.description, c.cover_url, c.grade, c.price,
         (select p.full_name from public.profiles p where p.id = c.teacher_id),
         (select count(*) from public.course_sections s where s.course_id = c.id),
         (select count(*) from public.lessons l where l.course_id = c.id)
  from public.courses c
  where c.is_published and c.show_on_home
  order by c.home_position, c.created_at desc
  limit 12;
$$;

-- ========== 4) محتوى كورس للمعاينة (للكورسات المختارة للرئيسية بس) ==========
-- بيرجّع JSON: بيانات الكورس + الأقسام + عناصر كل قسم (فيديو/ملف/امتحان) مترتّبة.
-- الرابط (url) بيتبعت لدروس المعاينة المجانية بس، غير كده null.
create or replace function public.get_public_course(p_course uuid)
returns json
language sql security definer stable set search_path = public as $$
  select json_build_object(
    'id', c.id,
    'title', c.title,
    'description', c.description,
    'cover_url', c.cover_url,
    'grade', c.grade,
    'price', c.price,
    'teacher_name', (select p.full_name from public.profiles p where p.id = c.teacher_id),
    'sections', coalesce((
      select json_agg(
        json_build_object(
          'id', s.id,
          'title', s.title,
          'description', s.description,
          'items', coalesce((
            select json_agg(x.j order by x.position, x.kind_order)
            from (
              select l.position as position, 0 as kind_order,
                     json_build_object(
                       'type', l.kind,
                       'id', l.id,
                       'title', l.title,
                       'free', l.is_free_preview,
                       'url', case when l.is_free_preview
                                   then (case when l.kind = 'file' then l.file_url else l.video_url end)
                                   else null end
                     ) as j
              from public.lessons l
              where l.section_id = s.id
              union all
              select e.position as position, 1 as kind_order,
                     json_build_object(
                       'type', 'exam',
                       'id', e.id,
                       'title', e.title,
                       'questions', e.question_count,
                       'minutes', e.duration_minutes
                     ) as j
              from public.exams e
              where e.section_id = s.id and e.is_published and e.question_count > 0
            ) x
          ), '[]'::json)
        )
        order by s.position, s.created_at, s.id
      )
      from public.course_sections s
      where s.course_id = c.id
    ), '[]'::json)
  )
  from public.courses c
  where c.id = p_course and c.is_published and c.show_on_home;
$$;

-- ========== 5) الصلاحيات: الزائر (anon) والمسجّل (authenticated) ==========
revoke all on function public.get_home_courses() from public;
revoke all on function public.get_public_course(uuid) from public;
grant execute on function public.get_home_courses() to anon, authenticated;
grant execute on function public.get_public_course(uuid) to anon, authenticated;
