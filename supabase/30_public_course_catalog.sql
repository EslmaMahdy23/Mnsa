-- Public catalog metadata for visitors. Lesson URLs/content are never exposed here.
create or replace function public.get_public_courses()
returns table (
  id uuid,
  title text,
  description text,
  cover_url text,
  grade smallint,
  price numeric,
  teacher_id uuid,
  teacher_name text,
  sections_count bigint,
  lessons_count bigint
)
language sql security definer stable set search_path = public as $$
  select c.id, c.title, c.description, c.cover_url, c.grade, c.price, c.teacher_id,
         (select p.full_name from public.profiles p where p.id = c.teacher_id),
         (select count(*) from public.course_sections s where s.course_id = c.id),
         (select count(*) from public.lessons l where l.course_id = c.id)
  from public.courses c
  where c.is_published
  order by c.created_at desc, c.id;
$$;

-- Let every published course use the same safe preview, whether or not it is
-- featured on the home page. Locked items still return metadata only.
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
              select l.position, 0 as kind_order,
                     json_build_object('type', l.kind, 'id', l.id, 'title', l.title) as j
              from public.lessons l
              where l.section_id = s.id
              union all
              select e.position, 1 as kind_order,
                     json_build_object(
                       'type', 'exam', 'id', e.id, 'title', e.title,
                       'questions', e.question_count, 'minutes', e.duration_minutes
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
  where c.id = p_course and c.is_published;
$$;

revoke all on function public.get_public_courses() from public;
grant execute on function public.get_public_courses() to anon, authenticated;
revoke all on function public.get_public_course(uuid) from public;
grant execute on function public.get_public_course(uuid) to anon, authenticated;
