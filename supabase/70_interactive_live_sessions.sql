-- Teacher scheduled live sessions with grade-specific booking and an atomic seat limit.
create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  grade smallint not null check (grade between 1 and 9),
  title text not null check (char_length(trim(title)) >= 3),
  description text not null check (char_length(trim(description)) >= 3),
  session_at timestamptz not null,
  join_url text not null check (join_url ~* '^https?://'),
  capacity integer not null check (capacity between 1 and 500),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists live_sessions_grade_date_idx
  on public.live_sessions (grade, session_at) where is_published;
create index if not exists live_sessions_teacher_date_idx
  on public.live_sessions (teacher_id, session_at desc);

create table if not exists public.live_session_bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (session_id, student_id)
);
create index if not exists live_session_bookings_active_idx
  on public.live_session_bookings (session_id) where cancelled_at is null;

alter table public.live_sessions enable row level security;
alter table public.live_session_bookings enable row level security;

drop policy if exists "teachers manage own live sessions" on public.live_sessions;
create policy "teachers manage own live sessions" on public.live_sessions
  for all to authenticated
  using (teacher_id = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='teacher'
  ))
  with check (teacher_id = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='teacher'
  ));

drop policy if exists "teachers read bookings for own live sessions" on public.live_session_bookings;
create policy "teachers read bookings for own live sessions" on public.live_session_bookings
  for select to authenticated
  using (exists (
    select 1 from public.live_sessions s
    where s.id = live_session_bookings.session_id and s.teacher_id = (select auth.uid())
      and exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='teacher')
  ));

revoke all on public.live_sessions, public.live_session_bookings from public, anon, authenticated;

create or replace function public.teacher_list_live_sessions()
returns table(
  id uuid, grade smallint, title text, description text, session_at timestamptz,
  join_url text, capacity integer, is_published boolean, booked_count integer, bookings jsonb
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
      select jsonb_agg(jsonb_build_object('student_id',b.student_id,'student_name',p.full_name,'booked_at',b.booked_at) order by b.booked_at)
      from public.live_session_bookings b join public.profiles p on p.id=b.student_id
      where b.session_id=s.id and b.cancelled_at is null
    ),'[]'::jsonb)
  from public.live_sessions s
  where s.teacher_id=auth.uid()
  order by s.session_at desc,s.created_at desc;
end;
$$;

create or replace function public.teacher_save_live_session(
  p_id uuid, p_grade smallint, p_title text, p_description text, p_session_at timestamptz,
  p_join_url text, p_capacity integer, p_is_published boolean
)
returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_existing public.live_sessions%rowtype; v_booked integer;
begin
  if not exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='teacher') then
    raise exception 'not allowed' using errcode='42501';
  end if;
  if p_grade not between 1 and 9 or char_length(trim(coalesce(p_title,'')))<3
    or char_length(trim(coalesce(p_description,'')))<3 or p_session_at is null or p_session_at<=now()
    or coalesce(p_capacity,0) not between 1 and 500
    or coalesce(trim(p_join_url),'') !~* '^https?://' then
    raise exception 'invalid session details' using errcode='22023';
  end if;
  if p_is_published is true and p_session_at<=now() then
    raise exception 'session must be in the future' using errcode='22023';
  end if;
  if p_id is null then
    insert into public.live_sessions(teacher_id,grade,title,description,session_at,join_url,capacity,is_published)
    values(auth.uid(),p_grade,trim(p_title),trim(p_description),p_session_at,trim(p_join_url),p_capacity,coalesce(p_is_published,false))
    returning id into v_id;
  else
    select * into v_existing from public.live_sessions where id=p_id and teacher_id=auth.uid() for update;
    if not found then raise exception 'session not found' using errcode='P0002'; end if;
    select count(*)::int into v_booked from public.live_session_bookings where session_id=p_id and cancelled_at is null;
    if v_booked>p_capacity then raise exception 'capacity below current bookings' using errcode='22023'; end if;
    if v_booked>0 and v_existing.grade<>p_grade then raise exception 'grade cannot change after a booking' using errcode='22023'; end if;
    update public.live_sessions set grade=p_grade,title=trim(p_title),description=trim(p_description),
      session_at=p_session_at,join_url=trim(p_join_url),capacity=p_capacity,
      is_published=coalesce(p_is_published,false),updated_at=now()
    where id=p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.teacher_delete_live_session(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.live_sessions where id=p_id and teacher_id=auth.uid()) then
    raise exception 'session not found' using errcode='P0002';
  end if;
  delete from public.live_sessions where id=p_id and teacher_id=auth.uid();
end;
$$;

create or replace function public.student_list_live_sessions()
returns table(
  id uuid, teacher_id uuid, teacher_name text, grade smallint, title text, description text,
  session_at timestamptz, capacity integer, booked_count integer, is_booked boolean, join_url text
)
language plpgsql security definer stable set search_path=public as $$
declare v_grade smallint;
begin
  select p.grade into v_grade from public.profiles p where p.id=auth.uid() and p.role='student';
  if not found or v_grade is null then return; end if;
  return query
  select s.id,s.teacher_id,p.full_name,s.grade,s.title,s.description,s.session_at,s.capacity,
    (select count(*)::int from public.live_session_bookings b where b.session_id=s.id and b.cancelled_at is null),
    (mine.student_id is not null),
    case when mine.student_id is not null then s.join_url else null end
  from public.live_sessions s
  join public.profiles p on p.id=s.teacher_id
  left join public.live_session_bookings mine on mine.session_id=s.id and mine.student_id=auth.uid() and mine.cancelled_at is null
  where s.grade=v_grade and s.is_published and s.session_at>now()-interval '1 day'
  order by s.session_at asc;
end;
$$;

create or replace function public.student_book_live_session(p_session uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_grade smallint; v_session public.live_sessions%rowtype;
  v_existing public.live_session_bookings%rowtype; v_count integer; v_has_existing boolean;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  select p.grade into v_grade from public.profiles p where p.id=v_user and p.role='student';
  if not found or v_grade is null then raise exception 'student profile required' using errcode='42501'; end if;
  select * into v_session from public.live_sessions where id=p_session for update;
  if not found or not v_session.is_published or v_session.grade<>v_grade then
    raise exception 'session unavailable for your grade' using errcode='42501';
  end if;
  if v_session.session_at<=now() then raise exception 'booking closed' using errcode='22023'; end if;
  select * into v_existing from public.live_session_bookings where session_id=p_session and student_id=v_user;
  v_has_existing := found;
  if found and v_existing.cancelled_at is null then
    return json_build_object('booked',true,'already_booked',true);
  end if;
  select count(*)::int into v_count from public.live_session_bookings where session_id=p_session and cancelled_at is null;
  if v_count>=v_session.capacity then raise exception 'session_full' using errcode='23514'; end if;
  if v_has_existing then
    update public.live_session_bookings set cancelled_at=null,booked_at=now() where id=v_existing.id;
  else
    insert into public.live_session_bookings(session_id,student_id) values(p_session,v_user);
  end if;
  return json_build_object('booked',true,'already_booked',false);
end;
$$;

create or replace function public.student_cancel_live_session_booking(p_session uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_session public.live_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='28000'; end if;
  select * into v_session from public.live_sessions where id=p_session for update;
  if not found or v_session.session_at<=now() then raise exception 'cancellation closed' using errcode='22023'; end if;
  update public.live_session_bookings set cancelled_at=now()
  where session_id=p_session and student_id=auth.uid() and cancelled_at is null;
end;
$$;

revoke all on function public.teacher_list_live_sessions() from public,anon;
revoke all on function public.teacher_save_live_session(uuid,smallint,text,text,timestamptz,text,integer,boolean) from public,anon;
revoke all on function public.teacher_delete_live_session(uuid) from public,anon;
revoke all on function public.student_list_live_sessions() from public,anon;
revoke all on function public.student_book_live_session(uuid) from public,anon;
revoke all on function public.student_cancel_live_session_booking(uuid) from public,anon;
grant execute on function public.teacher_list_live_sessions() to authenticated;
grant execute on function public.teacher_save_live_session(uuid,smallint,text,text,timestamptz,text,integer,boolean) to authenticated;
grant execute on function public.teacher_delete_live_session(uuid) to authenticated;
grant execute on function public.student_list_live_sessions() to authenticated;
grant execute on function public.student_book_live_session(uuid) to authenticated;
grant execute on function public.student_cancel_live_session_booking(uuid) to authenticated;
