-- Teachers may update their own approved teaching details from their profile.
-- Keep approval status and identity/document fields controlled by admins.
create or replace function public.update_teacher_profile(p jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_user uuid := auth.uid();
  v_stages text[];
  v_stage text;
  v_grades jsonb := coalesce(p->'stage_grades','{}'::jsonb);
  v_phone text := trim(coalesce(p->>'phone',''));
  v_alt text := trim(coalesce(p->>'alt_phone',''));
  v_name text := regexp_replace(trim(coalesce(p->>'full_name','')), '\s+', ' ', 'g');
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  if not exists(select 1 from public.teacher_applications a where a.user_id=v_user and a.status='approved')
    or not exists(select 1 from public.profiles pr where pr.id=v_user and pr.role='teacher') then
    raise exception 'teacher_not_approved' using errcode='42501';
  end if;
  if char_length(v_name) not between 8 and 100 or array_length(string_to_array(v_name,' '),1)<3 then
    raise exception 'bad_name' using errcode='22023';
  end if;
  if v_phone !~ '^01[0125][0-9]{8}$' or v_alt !~ '^01[0125][0-9]{8}$' or v_phone=v_alt then
    raise exception 'bad_phone' using errcode='22023';
  end if;
  if jsonb_typeof(p->'stages') is distinct from 'array' or jsonb_typeof(v_grades) is distinct from 'object' then
    raise exception 'bad_stages' using errcode='22023';
  end if;
  v_stages := array(select distinct x from jsonb_array_elements_text(p->'stages') x order by x);
  if cardinality(v_stages)=0 or not (v_stages <@ array['primary','preparatory','secondary_general','secondary_azhar','secondary_languages','university']) then
    raise exception 'bad_stages' using errcode='22023';
  end if;
  foreach v_stage in array v_stages loop
    if v_stage='university' then continue; end if;
    if jsonb_typeof(v_grades->v_stage) is distinct from 'array' then
      raise exception 'bad_grades' using errcode='22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(case when jsonb_typeof(v_grades->v_stage)='array' then v_grades->v_stage else '[]'::jsonb end) g(value)
      where g.value !~ '^[1-6]$' or (case when g.value ~ '^[1-6]$' then g.value::int else 99 end) >
        (case when v_stage='primary' then 6 else 3 end)
    ) then raise exception 'bad_grades' using errcode='22023'; end if;
  end loop;
  if char_length(trim(coalesce(p->>'subjects',''))) not between 2 and 200
    or char_length(trim(coalesce(p->>'governorate',''))) not between 2 and 40
    or char_length(trim(coalesce(p->>'city',''))) not between 2 and 80
    or char_length(trim(coalesce(p->>'qualification',''))) not between 3 and 200
    or coalesce(p->>'experience_range','') not in ('lt1','1_3','3_5','gt5')
    or coalesce(p->>'graduation_year','') !~ '^[0-9]{4}$'
    or (p->>'graduation_year')::int not between 1970 and extract(year from now())::int
    or char_length(coalesce(p->>'specialization','')) > 100
    or char_length(coalesce(p->>'postgraduate','')) > 500
    or char_length(coalesce(p->>'previous_workplaces','')) > 1000 then
    raise exception 'invalid_teacher_profile' using errcode='22023';
  end if;

  update public.teacher_applications set
    full_name=v_name, phone=v_phone, alt_phone=v_alt,
    governorate=trim(p->>'governorate'), city=trim(p->>'city'),
    qualification=trim(p->>'qualification'), graduation_year=(p->>'graduation_year')::int,
    specialization=trim(coalesce(p->>'specialization','')),
    postgraduate=nullif(trim(coalesce(p->>'postgraduate','')),''),
    experience_range=p->>'experience_range',
    previous_workplaces=nullif(trim(coalesce(p->>'previous_workplaces','')),''),
    subjects=trim(p->>'subjects'), stages=v_stages, stage_grades=v_grades,
    primary_grades=coalesce(array(select jsonb_array_elements_text(v_grades->'primary')::smallint),'{}'::smallint[]),
    updated_at=now()
  where user_id=v_user and status='approved';
  update public.profiles set full_name=v_name where id=v_user;
end;
$$;
revoke all on function public.update_teacher_profile(jsonb) from public,anon;
grant execute on function public.update_teacher_profile(jsonb) to authenticated;

-- Keep completed bookings visible in the student's "previous sessions" list.
drop function if exists public.student_list_live_sessions();
create function public.student_list_live_sessions()
returns table(
  id uuid, teacher_id uuid, teacher_name text, grade smallint, title text, description text,
  session_at timestamptz, capacity integer, booked_count integer, is_booked boolean, join_url text,
  courses jsonb, eligible_courses jsonb, booked_course_id uuid
)
language plpgsql security definer stable set search_path=public as $$
declare v_grade smallint;
begin
  select p.grade into v_grade from public.profiles p where p.id=auth.uid() and p.role='student';
  if not found or v_grade is null then return; end if;
  return query
  select s.id,s.teacher_id,teacher.full_name,s.grade,s.title,s.description,s.session_at,s.capacity,
    (select count(*)::int from public.live_session_bookings b where b.session_id=s.id and b.cancelled_at is null),
    (mine.student_id is not null),
    case when mine.student_id is not null then s.join_url else null end,
    coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title) order by c.title)
      from public.live_session_courses sc join public.courses c on c.id=sc.course_id where sc.session_id=s.id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('course_id',c.id,'course_title',c.title,
      'remaining',greatest(0,coalesce(cr.granted_count,0)-coalesce(cr.used_count,0))) order by c.title)
      from public.live_session_courses sc join public.courses c on c.id=sc.course_id
      join public.enrollments en on en.course_id=c.id and en.user_id=auth.uid()
      left join public.student_course_lecture_credits cr on cr.course_id=c.id and cr.user_id=auth.uid()
      where sc.session_id=s.id),'[]'::jsonb),
    mine.course_id
  from public.live_sessions s
  join public.profiles teacher on teacher.id=s.teacher_id
  left join public.live_session_bookings mine on mine.session_id=s.id and mine.student_id=auth.uid() and mine.cancelled_at is null
  where s.grade=v_grade
    -- Non-booked sessions disappear exactly when their scheduled time arrives;
    -- booked sessions remain available in the student's previous-sessions tab.
    and ((s.is_published and s.session_at>now()) or mine.student_id is not null)
    and exists (select 1 from public.live_session_courses sc join public.enrollments en on en.course_id=sc.course_id
      where sc.session_id=s.id and en.user_id=auth.uid())
  order by s.session_at asc;
end;
$$;
revoke all on function public.student_list_live_sessions() from public,anon;
grant execute on function public.student_list_live_sessions() to authenticated;
