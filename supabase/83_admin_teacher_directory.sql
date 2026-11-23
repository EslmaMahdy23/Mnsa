-- Admin-only teacher directory with course and activity summaries.
-- Run in Supabase SQL Editor after the existing project migrations.

create or replace function public.admin_teacher_directory()
returns table (
  id uuid,
  full_name text,
  email text,
  phone text,
  created_at timestamptz,
  public_photo_url text,
  public_bio text,
  public_subjects text,
  public_location text,
  public_enabled boolean,
  application_status text,
  qualification text,
  specialization text,
  experience_range text,
  subjects text,
  stages text[],
  primary_grades smallint[],
  previous_workplaces text,
  courses_count bigint,
  published_courses_count bigint,
  students_count bigint,
  lessons_count bigint,
  exams_count bigint,
  exam_attempts_count bigint,
  live_sessions_count bigint,
  live_bookings_count bigint,
  schedules_count bigint,
  courses jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    p.phone,
    p.created_at,
    p.public_photo_url,
    p.public_bio,
    p.public_subjects,
    p.public_location,
    coalesce(p.public_enabled, true),
    ta.status,
    ta.qualification,
    ta.specialization,
    ta.experience_range,
    ta.subjects,
    ta.stages,
    ta.primary_grades,
    ta.previous_workplaces,
    (select count(*) from public.courses c where c.teacher_id=p.id),
    (select count(*) from public.courses c where c.teacher_id=p.id and c.is_published),
    (select count(distinct en.user_id)
       from public.enrollments en join public.courses c on c.id=en.course_id
      where c.teacher_id=p.id),
    (select count(*) from public.lessons l join public.courses c on c.id=l.course_id where c.teacher_id=p.id),
    (select count(*) from public.exams e join public.courses c on c.id=e.course_id where c.teacher_id=p.id),
    (select count(*) from public.exam_attempts a join public.exams e on e.id=a.exam_id join public.courses c on c.id=e.course_id where c.teacher_id=p.id),
    (select count(*) from public.live_sessions ls where ls.teacher_id=p.id),
    (select count(*) from public.live_session_bookings b join public.live_sessions ls on ls.id=b.session_id where ls.teacher_id=p.id),
    (select count(*) from public.lecture_schedules s where s.teacher_id=p.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'subject', c.subject,
        'grade', c.grade,
        'price', c.price,
        'is_published', c.is_published,
        'created_at', c.created_at,
        'students_count', (select count(*) from public.enrollments en where en.course_id=c.id),
        'lessons_count', (select count(*) from public.lessons l where l.course_id=c.id),
        'sections_count', (select count(*) from public.course_sections s where s.course_id=c.id),
        'exams_count', (select count(*) from public.exams e where e.course_id=c.id),
        'attempts_count', (select count(*) from public.exam_attempts a join public.exams e on e.id=a.exam_id where e.course_id=c.id)
      ) order by c.created_at desc, c.id)
      from public.courses c where c.teacher_id=p.id
    ), '[]'::jsonb)
  from public.profiles p
  join auth.users u on u.id=p.id
  left join public.teacher_applications ta on ta.user_id=p.id
  where p.role='teacher'
  order by p.created_at desc, p.id;
end;
$$;

revoke all on function public.admin_teacher_directory() from public, anon;
grant execute on function public.admin_teacher_directory() to authenticated;

-- Special role filter used by the general user list so teachers live in their own section.
create or replace function public.admin_list_users(
  p_search text default null,
  p_role text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  email text,
  full_name text,
  phone text,
  parent_phone text,
  grade smallint,
  role text,
  created_at timestamptz,
  enrollments_count bigint,
  total_count bigint
)
language plpgsql security definer stable set search_path=public as $$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
  pat text;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  if q is not null then
    pat := '%' || replace(replace(replace(q, chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.phone, p.parent_phone, p.grade, p.role, p.created_at,
           (select count(*) from public.enrollments e where e.user_id=p.id), count(*) over ()
    from public.profiles p join auth.users u on u.id=p.id
    where (case when p_role='__non_teacher__' then p.role <> 'teacher'
                else nullif(p_role, '') is null or p.role=p_role end)
      and (pat is null or p.full_name ilike pat or u.email ilike pat or p.phone ilike pat or p.parent_phone ilike pat)
    order by p.created_at desc
    limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end;
$$;

revoke all on function public.admin_list_users(text,text,int,int) from public, anon;
grant execute on function public.admin_list_users(text,text,int,int) to authenticated;
