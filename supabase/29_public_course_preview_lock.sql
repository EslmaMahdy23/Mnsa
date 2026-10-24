-- Public course previews show the curriculum only. Never return lesson URLs,
-- including URLs for lessons marked as free previews.
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
  where c.id = p_course and c.is_published and c.show_on_home;
$$;

revoke all on function public.get_public_course(uuid) from public;
grant execute on function public.get_public_course(uuid) to anon, authenticated;

-- Anonymous clients must use the safe public preview RPC, never query lesson rows directly.
revoke select on public.lessons from anon;
