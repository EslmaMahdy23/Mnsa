-- إضافة الصفوف المرتبطة بكورسات المدرس المنشورة حتى يعمل فلتر الصف في /teachers.
-- شغّل الملف بعد 55_public_teacher_profiles.sql.

drop function if exists public.get_public_teachers();

create or replace function public.get_public_teachers()
returns table (
  id uuid,
  slug text,
  full_name text,
  bio text,
  subjects text,
  location text,
  photo_url text,
  courses_count bigint,
  students_count bigint,
  grades integer[]
)
language sql security definer stable set search_path = public as $$
  select p.id, p.public_slug, p.full_name, p.public_bio, p.public_subjects,
         p.public_location, p.public_photo_url,
         (select count(*) from public.courses c where c.teacher_id = p.id and c.is_published),
         (select count(distinct e.user_id)
            from public.enrollments e
            join public.courses c on c.id = e.course_id
           where c.teacher_id = p.id and c.is_published),
         coalesce((select array_agg(distinct c.grade order by c.grade)
                     from public.courses c
                    where c.teacher_id = p.id and c.is_published and c.grade is not null), '{}'::integer[])
    from public.profiles p
   where p.role = 'teacher'
     and p.public_enabled
     and p.public_slug is not null
   order by p.full_name nulls last, p.id;
$$;

revoke all on function public.get_public_teachers() from public;
grant execute on function public.get_public_teachers() to anon, authenticated;
