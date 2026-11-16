-- Expand interactive sessions:
-- * session grades must be among the teacher's approved grades
-- * a session can serve multiple courses
-- * every new/existing course enrollment has 8 session credits
-- * a booking consumes one credit from one enrolled course; cancellation refunds it

create table if not exists public.live_session_courses (
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (session_id, course_id)
);
alter table public.live_session_courses enable row level security;
revoke all on public.live_session_courses from public, anon, authenticated;

alter table public.live_session_bookings
  add column if not exists course_id uuid references public.courses(id) on delete restrict;
create index if not exists live_session_bookings_course_idx
  on public.live_session_bookings (student_id, course_id) where cancelled_at is null;

create table if not exists public.student_course_lecture_credits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  granted_count integer not null default 8 check (granted_count >= 0),
  used_count integer not null default 0 check (used_count >= 0 and used_count <= granted_count),
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id)
);
alter table public.student_course_lecture_credits enable row level security;
revoke all on public.student_course_lecture_credits from public, anon, authenticated;

create or replace function public.grant_course_lecture_credits_on_enrollment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.student_course_lecture_credits(user_id,course_id,granted_count,used_count)
  values(new.user_id,new.course_id,8,0)
  on conflict(user_id,course_id) do nothing;
  return new;
end;
$$;
drop trigger if exists enrollments_grant_lecture_credits on public.enrollments;
create trigger enrollments_grant_lecture_credits
  after insert on public.enrollments
  for each row execute function public.grant_course_lecture_credits_on_enrollment();

-- Give existing enrolled students the same initial 8 credits once; later runs do not refill used balances.
insert into public.student_course_lecture_credits(user_id,course_id,granted_count,used_count)
select e.user_id,e.course_id,8,0 from public.enrollments e
on conflict(user_id,course_id) do nothing;

drop function if exists public.teacher_list_live_sessions();
create function public.teacher_list_live_sessions()
returns table(
  id uuid, grade smallint, title text, description text, session_at timestamptz,
  join_url text, capacity integer, is_published boolean, booked_count integer,
  bookings jsonb, course_ids uuid[], course_titles text[]
)
language plpgsql security definer stable set search_path=public as $$
begin
  if not exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='teacher') then
    raise exception 'not allowed' using errcode='42501';
  end if;
  return query
  select s.id,s.grade,s.title,s.description,s.session_at,s.join_url,s.capacity,s.is_published,
    (select count(*)::int from public.live_session_bookings b where b.session_id=s.id and b.cancelled_at is null),
    coalesce((
      select jsonb_agg(jsonb_build_object('student_id',b.student_id,'student_name',p.full_name,'booked_at',b.booked_at,'course_id',b.course_id) order by b.booked_at)
      from public.live_session_bookings b join public.profiles p on p.id=b.student_id
      where b.session_id=s.id and b.cancelled_at is null
    ),'[]'::jsonb),
    coalesce((select array_agg(c.id order by c.title) from public.live_session_courses sc join public.courses c on c.id=sc.course_id where sc.session_id=s.id),'{}'::uuid[]),
    coalesce((select array_agg(c.title order by c.title) from public.live_session_courses sc join public.courses c on c.id=sc.course_id where sc.session_id=s.id),'{}'::text[])
  from public.live_sessions s
  where s.teacher_id=auth.uid()
  order by s.session_at desc,s.created_at desc;
end;
$$;

drop function if exists public.teacher_save_live_session(uuid,smallint,text,text,timestamptz,text,integer,boolean);
create function public.teacher_save_live_session(
  p_id uuid, p_grade smallint, p_title text, p_description text, p_session_at timestamptz,
  p_join_url text, p_capacity integer, p_is_published boolean, p_course_ids uuid[]
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_id uuid; v_existing public.live_sessions%rowtype; v_booked integer;
  v_old_courses uuid[]; v_new_courses uuid[];
begin
  if not exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='teacher') then
    raise exception 'not allowed' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.teacher_applications a
    where a.user_id=auth.uid() and a.status='approved'
      and (
        (a.stage_grades <> '{}'::jsonb and exists (
          select 1 from jsonb_each(a.stage_grades) sg
          cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(sg.value)='array' then sg.value else '[]'::jsonb end
          ) g(value)
          where g.value ~ '^[1-9]$' and g.value::smallint=p_grade
        ))
        or (a.stage_grades='{}'::jsonb and p_grade=any(a.primary_grades))
      )
  ) then raise exception 'grade_not_registered' using errcode='42501'; end if;
  if p_grade not between 1 and 9 or char_length(trim(coalesce(p_title,'')))<3
    or char_length(trim(coalesce(p_description,'')))<3 or p_session_at is null or p_session_at<=now()
    or coalesce(p_capacity,0) not between 1 and 500
    or coalesce(trim(p_join_url),'') !~* '^https?://'
    or coalesce(array_length(p_course_ids,1),0) not between 1 and 20 then
    raise exception 'invalid session details' using errcode='22023';
  end if;
  select array_agg(distinct x order by x) into v_new_courses from unnest(p_course_ids) x;
  if cardinality(v_new_courses) <> cardinality(p_course_ids) then
    raise exception 'duplicate course selection' using errcode='22023';
  end if;
  if exists (
    select 1 from unnest(v_new_courses) selected(id)
    left join public.courses c on c.id=selected.id
    where c.id is null or c.teacher_id<>auth.uid() or (c.grade is not null and c.grade<>p_grade)
  ) then raise exception 'invalid_course_selection' using errcode='42501'; end if;

  if p_id is null then
    insert into public.live_sessions(teacher_id,grade,title,description,session_at,join_url,capacity,is_published)
    values(auth.uid(),p_grade,trim(p_title),trim(p_description),p_session_at,trim(p_join_url),p_capacity,coalesce(p_is_published,false))
    returning id into v_id;
  else
    select * into v_existing from public.live_sessions where id=p_id and teacher_id=auth.uid() for update;
    if not found then raise exception 'session not found' using errcode='P0002'; end if;
    select count(*)::int into v_booked from public.live_session_bookings where session_id=p_id and cancelled_at is null;
    select array_agg(course_id order by course_id) into v_old_courses from public.live_session_courses where session_id=p_id;
    if v_booked>p_capacity then raise exception 'capacity below current bookings' using errcode='22023'; end if;
    if v_booked>0 and v_existing.grade<>p_grade then raise exception 'grade cannot change after a booking' using errcode='22023'; end if;
    if v_booked>0 and v_old_courses is not null and v_old_courses<>v_new_courses then
      raise exception 'courses cannot change after a booking' using errcode='22023';
    end if;
    update public.live_sessions set grade=p_grade,title=trim(p_title),description=trim(p_description),
      session_at=p_session_at,join_url=trim(p_join_url),capacity=p_capacity,
      is_published=coalesce(p_is_published,false),updated_at=now()
    where id=p_id returning id into v_id;
  end if;
  delete from public.live_session_courses where session_id=v_id;
  insert into public.live_session_courses(session_id,course_id)
  select v_id,x from unnest(v_new_courses) x;
  return v_id;
end;
$$;

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
    coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title) order by c.title)
      from public.live_session_courses sc join public.courses c on c.id=sc.course_id
      where sc.session_id=s.id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'course_id',c.id,'course_title',c.title,
        'remaining',greatest(0,coalesce(cr.granted_count,0)-coalesce(cr.used_count,0))
      ) order by c.title)
      from public.live_session_courses sc
      join public.courses c on c.id=sc.course_id
      join public.enrollments en on en.course_id=c.id and en.user_id=auth.uid()
      left join public.student_course_lecture_credits cr on cr.course_id=c.id and cr.user_id=auth.uid()
      where sc.session_id=s.id
    ),'[]'::jsonb), mine.course_id
  from public.live_sessions s
  join public.profiles teacher on teacher.id=s.teacher_id
  left join public.live_session_bookings mine on mine.session_id=s.id and mine.student_id=auth.uid() and mine.cancelled_at is null
  where s.grade=v_grade and s.is_published and s.session_at>now()-interval '1 day'
    and exists (
      select 1 from public.live_session_courses sc join public.enrollments en on en.course_id=sc.course_id
      where sc.session_id=s.id and en.user_id=auth.uid()
    )
  order by s.session_at asc;
end;
$$;

drop function if exists public.student_book_live_session(uuid);
create or replace function public.student_book_live_session(p_session uuid,p_course uuid)
returns json language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_grade smallint; v_session public.live_sessions%rowtype;
  v_existing public.live_session_bookings%rowtype; v_credit public.student_course_lecture_credits%rowtype;
  v_count integer; v_has_existing boolean;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  select p.grade into v_grade from public.profiles p where p.id=v_user and p.role='student';
  if not found or v_grade is null then raise exception 'student profile required' using errcode='42501'; end if;
  select * into v_session from public.live_sessions where id=p_session for update;
  if not found or not v_session.is_published or v_session.grade<>v_grade then
    raise exception 'session unavailable for your grade' using errcode='42501';
  end if;
  if v_session.session_at<=now() then raise exception 'booking closed' using errcode='22023'; end if;
  if not exists(select 1 from public.live_session_courses where session_id=p_session and course_id=p_course)
    or not exists(select 1 from public.enrollments where course_id=p_course and user_id=v_user) then
    raise exception 'course enrollment required' using errcode='42501';
  end if;
  select * into v_existing from public.live_session_bookings where session_id=p_session and student_id=v_user for update;
  v_has_existing := found;
  if found and v_existing.cancelled_at is null then
    return json_build_object('booked',true,'already_booked',true,'course_id',v_existing.course_id);
  end if;
  select count(*)::int into v_count from public.live_session_bookings where session_id=p_session and cancelled_at is null;
  if v_count>=v_session.capacity then raise exception 'session_full' using errcode='23514'; end if;
  select * into v_credit from public.student_course_lecture_credits where user_id=v_user and course_id=p_course for update;
  if not found or v_credit.used_count>=v_credit.granted_count then
    raise exception 'lecture_credit_empty' using errcode='22023';
  end if;
  if v_has_existing then
    update public.live_session_bookings set course_id=p_course,cancelled_at=null,booked_at=now() where id=v_existing.id;
  else
    insert into public.live_session_bookings(session_id,student_id,course_id) values(p_session,v_user,p_course);
  end if;
  update public.student_course_lecture_credits set used_count=used_count+1,updated_at=now()
  where user_id=v_user and course_id=p_course;
  return json_build_object(
    'booked',true,'already_booked',false,'course_id',p_course,
    'remaining',v_credit.granted_count-v_credit.used_count-1
  );
end;
$$;

create or replace function public.student_cancel_live_session_booking(p_session uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_session public.live_sessions%rowtype; v_booking public.live_session_bookings%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  select * into v_session from public.live_sessions where id=p_session for update;
  if not found or v_session.session_at<=now() then raise exception 'cancellation closed' using errcode='22023'; end if;
  select * into v_booking from public.live_session_bookings
  where session_id=p_session and student_id=auth.uid() and cancelled_at is null for update;
  if not found then return; end if;
  update public.live_session_bookings set cancelled_at=now() where id=v_booking.id;
  if v_booking.course_id is not null then
    update public.student_course_lecture_credits
    set used_count=greatest(0,used_count-1),updated_at=now()
    where user_id=auth.uid() and course_id=v_booking.course_id;
  end if;
end;
$$;

revoke all on function public.teacher_list_live_sessions() from public,anon;
revoke all on function public.teacher_save_live_session(uuid,smallint,text,text,timestamptz,text,integer,boolean,uuid[]) from public,anon;
revoke all on function public.student_list_live_sessions() from public,anon;
revoke all on function public.student_book_live_session(uuid,uuid) from public,anon;
revoke all on function public.student_cancel_live_session_booking(uuid) from public,anon;
grant execute on function public.teacher_list_live_sessions() to authenticated;
grant execute on function public.teacher_save_live_session(uuid,smallint,text,text,timestamptz,text,integer,boolean,uuid[]) to authenticated;
grant execute on function public.student_list_live_sessions() to authenticated;
grant execute on function public.student_book_live_session(uuid,uuid) to authenticated;
grant execute on function public.student_cancel_live_session_booking(uuid) to authenticated;
