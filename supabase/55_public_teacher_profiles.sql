-- بروفايل المدرس العام: بيانات يختار المدرس نشرها + دوال آمنة للزوار.
-- شغّل الملف بعد 54_course_submission_without_content.sql.

alter table public.profiles
  add column if not exists public_slug text,
  add column if not exists public_bio text,
  add column if not exists public_subjects text,
  add column if not exists public_location text,
  add column if not exists public_photo_url text,
  add column if not exists public_enabled boolean not null default true;

alter table public.profiles drop constraint if exists profiles_public_slug_check;
alter table public.profiles
  add constraint profiles_public_slug_check
  check (public_slug is null or public_slug ~ '^[a-z0-9][a-z0-9-]{2,48}$');

alter table public.profiles drop constraint if exists profiles_public_bio_check;
alter table public.profiles
  add constraint profiles_public_bio_check
  check (public_bio is null or char_length(public_bio) <= 600);

create unique index if not exists profiles_public_slug_key
  on public.profiles (lower(public_slug))
  where public_slug is not null;

-- المدرس يعدّل بياناته العامة فقط؛ الدور وباقي بيانات الحساب تظل محمية.
revoke update on public.profiles from authenticated;
grant update (full_name, grade, public_slug, public_bio, public_subjects, public_location, public_photo_url, public_enabled)
  on public.profiles to authenticated;

-- صور البروفايل العامة: روابطها يمكن قراءتها للزوار، والكتابة لصاحب مجلد user id فقط.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teacher-public', 'teacher-public', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "teacher public avatar insert" on storage.objects;
create policy "teacher public avatar insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'teacher-public' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "teacher public avatar update" on storage.objects;
create policy "teacher public avatar update" on storage.objects for update to authenticated
  using (bucket_id = 'teacher-public' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'teacher-public' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "teacher public avatar delete" on storage.objects;
create policy "teacher public avatar delete" on storage.objects for delete to authenticated
  using (bucket_id = 'teacher-public' and (storage.foldername(name))[1] = (select auth.uid())::text);

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
  students_count bigint
)
language sql security definer stable set search_path = public as $$
  select p.id, p.public_slug, p.full_name, p.public_bio, p.public_subjects,
         p.public_location, p.public_photo_url,
         (select count(*) from public.courses c where c.teacher_id = p.id and c.is_published),
         (select count(distinct e.user_id)
            from public.enrollments e
            join public.courses c on c.id = e.course_id
           where c.teacher_id = p.id and c.is_published)
    from public.profiles p
   where p.role = 'teacher'
     and p.public_enabled
     and p.public_slug is not null
   order by p.full_name nulls last, p.id;
$$;

create or replace function public.get_public_teacher(p_slug text)
returns json
language sql security definer stable set search_path = public as $$
  select json_build_object(
    'teacher', json_build_object(
      'id', p.id,
      'slug', p.public_slug,
      'full_name', p.full_name,
      'bio', p.public_bio,
      'subjects', p.public_subjects,
      'location', p.public_location,
      'photo_url', p.public_photo_url,
      'courses_count', (select count(*) from public.courses c where c.teacher_id = p.id and c.is_published),
      'students_count', (select count(distinct e.user_id)
                           from public.enrollments e
                           join public.courses c on c.id = e.course_id
                          where c.teacher_id = p.id and c.is_published)
    ),
    'courses', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'title', c.title, 'description', c.description,
        'cover_url', c.cover_url, 'grade', c.grade, 'price', c.price,
        'sections_count', (select count(*) from public.course_sections s where s.course_id = c.id),
        'lessons_count', (select count(*) from public.lessons l where l.course_id = c.id)
      ) order by c.created_at desc, c.id)
      from public.courses c
      where c.teacher_id = p.id and c.is_published
    ), '[]'::json)
  )
  from public.profiles p
 where lower(p.public_slug) = lower(trim(p_slug))
   and p.role = 'teacher'
   and p.public_enabled;
$$;

revoke all on function public.get_public_teachers() from public;
grant execute on function public.get_public_teachers() to anon, authenticated;
revoke all on function public.get_public_teacher(text) from public;
grant execute on function public.get_public_teacher(text) to anon, authenticated;
