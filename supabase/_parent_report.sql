-- Private parent progress reports through long, revocable bearer links.
-- Run once in Supabase SQL Editor after the existing course/student SQL files.

create table if not exists public.parent_report_links (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique check (length(token) >= 32),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz
);

create index if not exists parent_report_links_token_idx on public.parent_report_links(token);
create index if not exists parent_report_links_student_idx on public.parent_report_links(student_id);
create unique index if not exists parent_report_links_one_active_student_idx
  on public.parent_report_links(student_id) where is_active;

alter table public.parent_report_links enable row level security;

drop policy if exists "parent report links scoped read" on public.parent_report_links;
create policy "parent report links scoped read" on public.parent_report_links
  for select to authenticated using (
    public.is_admin()
    or exists (
      select 1
      from public.enrollments en
      join public.courses c on c.id = en.course_id
      where en.user_id = parent_report_links.student_id
        and c.teacher_id = (select auth.uid())
    )
  );

-- Mutations are done only through scoped RPCs below. These policies keep the
-- same ownership boundary if authenticated write grants are added later.
drop policy if exists "parent report links scoped insert" on public.parent_report_links;
create policy "parent report links scoped insert" on public.parent_report_links
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and (
      public.is_admin()
      or exists (
        select 1
        from public.enrollments en
        join public.courses c on c.id = en.course_id
        where en.user_id = parent_report_links.student_id
          and c.teacher_id = (select auth.uid())
      )
    )
  );

drop policy if exists "parent report links scoped update" on public.parent_report_links;
create policy "parent report links scoped update" on public.parent_report_links
  for update to authenticated using (
    public.is_admin()
    or exists (
      select 1
      from public.enrollments en
      join public.courses c on c.id = en.course_id
      where en.user_id = parent_report_links.student_id
        and c.teacher_id = (select auth.uid())
    )
  ) with check (
    public.is_admin()
    or exists (
      select 1
      from public.enrollments en
      join public.courses c on c.id = en.course_id
      where en.user_id = parent_report_links.student_id
        and c.teacher_id = (select auth.uid())
    )
  );

revoke all on table public.parent_report_links from public, anon;
grant select on table public.parent_report_links to authenticated;

-- Generates a new 244-bit random token and invalidates every older token for
-- this student in the same transaction. Teachers must own an enrolled course.
create or replace function public.create_parent_report_link(p_student uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select p.role into v_role from public.profiles p where p.id = p_student;
  if v_role is distinct from 'student' then raise exception 'student_not_found' using errcode = 'P0002'; end if;

  if not public.is_admin() and not exists (
    select 1
    from public.enrollments en
    join public.courses c on c.id = en.course_id
    where en.user_id = p_student and c.teacher_id = v_user
  ) then
    raise exception 'student_not_in_teacher_courses' using errcode = '42501';
  end if;

  update public.parent_report_links
     set is_active = false
   where student_id = p_student and is_active;

  insert into public.parent_report_links(student_id, token, created_by)
  values (p_student, v_token, v_user);

  return v_token;
end;
$$;

-- Returns only current tokens for students the caller is allowed to manage.
create or replace function public.get_parent_report_links(p_students uuid[])
returns table(student_id uuid, token text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  return query
  select l.student_id, l.token
  from public.parent_report_links l
  where l.is_active
    and l.student_id = any(coalesce(p_students, array[]::uuid[]))
    and (
      public.is_admin()
      or exists (
        select 1
        from public.enrollments en
        join public.courses c on c.id = en.course_id
        where en.user_id = l.student_id and c.teacher_id = v_user
      )
    );
end;
$$;

-- Public report endpoint. Only the token holder can reach the student's
-- first name, enrolled course progress, submitted exam results and activity
-- timestamps. No answers, email, student phone, or parent phone are returned.
create or replace function public.get_parent_report(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_id uuid;
  v_student uuid;
  v_full_name text;
  v_first_name text;
  v_last_login timestamptz;
  v_report jsonb;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;

  select l.id, l.student_id into v_link_id, v_student
  from public.parent_report_links l
  where l.token = p_token and l.is_active;
  if v_link_id is null then return null; end if;

  update public.parent_report_links
     set last_viewed_at = now()
   where id = v_link_id and is_active;
  if not found then return null; end if;

  select p.full_name into v_full_name from public.profiles p where p.id = v_student;
  v_first_name := split_part(trim(coalesce(v_full_name, '')), ' ', 1);
  select u.last_sign_in_at into v_last_login from auth.users u where u.id = v_student;

  select jsonb_build_object(
    'student_first_name', coalesce(nullif(v_first_name, ''), 'الطالب'),
    'last_login_at', v_last_login,
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'course_id', c.id,
        'course_title', c.title,
        'completed_items', stats.completed_items,
        'total_items', stats.total_items,
        'progress_percent', case when stats.total_items > 0
          then least(100, round(stats.completed_items * 100.0 / stats.total_items)::integer)
          else 0 end
      ) order by c.title)
      from public.enrollments en
      join public.courses c on c.id = en.course_id
      cross join lateral (
        select
          (select count(*)::integer from public.lessons l where l.course_id = c.id)
          + (select count(*)::integer from public.exams e where e.course_id = c.id and e.is_published and e.question_count > 0)
            as total_items,
          (select count(*)::integer
             from public.lesson_progress lp
             join public.lessons l on l.id = lp.lesson_id
            where lp.user_id = v_student and l.course_id = c.id)
          + (select count(*)::integer
               from public.exam_attempts a
               join public.exams e on e.id = a.exam_id
              where a.user_id = v_student and e.course_id = c.id
                and e.is_published and e.question_count > 0 and a.submitted_at is not null)
            as completed_items
      ) stats
      where en.user_id = v_student
    ), '[]'::jsonb),
    'exam_results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exam_title', coalesce(e.title, a.exam_title),
        'course_title', c.title,
        'score', case when a.essay_pending then null else a.score end,
        'total', a.total,
        'percent', case when a.essay_pending then null else a.percent end,
        'pending_review', a.essay_pending,
        'submitted_at', a.submitted_at
      ) order by a.submitted_at desc)
      from (
        select ea.* from public.exam_attempts ea
        where ea.user_id = v_student and ea.submitted_at is not null
        order by ea.submitted_at desc limit 30
      ) a
      left join public.exams e on e.id = a.exam_id
      left join public.courses c on c.id = e.course_id
    ), '[]'::jsonb),
    'activity', jsonb_build_object(
      'last_activity_at', (
        select max(activity.activity_at)
        from (
          select lp.completed_at as activity_at
          from public.lesson_progress lp where lp.user_id = v_student
          union all
          select greatest(a.started_at, coalesce(a.submitted_at, a.started_at))
          from public.exam_attempts a where a.user_id = v_student
        ) activity
      ),
      'completed_lessons', (select count(*)::integer from public.lesson_progress lp where lp.user_id = v_student),
      'started_exams', (select count(*)::integer from public.exam_attempts a where a.user_id = v_student),
      'submitted_exams', (select count(*)::integer from public.exam_attempts a where a.user_id = v_student and a.submitted_at is not null)
    )
  ) into v_report;

  return v_report;
end;
$$;

revoke all on function public.create_parent_report_link(uuid) from public, anon;
revoke all on function public.get_parent_report_links(uuid[]) from public, anon;
revoke all on function public.get_parent_report(text) from public;
grant execute on function public.create_parent_report_link(uuid) to authenticated;
grant execute on function public.get_parent_report_links(uuid[]) to authenticated;
grant execute on function public.get_parent_report(text) to anon, authenticated;

-- The existing teacher roster RPC already checks ownership of p_course.
-- Add the parent phone to that scoped response; do not broaden profiles RLS.
create or replace function public.teacher_course_students(p_course uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.courses c where c.id = p_course and c.teacher_id = auth.uid()
  ) then
    raise exception 'course_not_found' using errcode = 'P0002';
  end if;

  return json_build_object(
    'content_total', (select count(*) from public.lessons l where l.course_id = p_course)
      + (select count(*) from public.exams e where e.course_id = p_course and e.is_published and e.question_count > 0),
    'exams', coalesce((
      select json_agg(json_build_object('id', e.id, 'title', e.title) order by e.created_at)
      from public.exams e
      where e.course_id = p_course and e.is_published and e.question_count > 0
    ), '[]'::json),
    'students', coalesce((
      select json_agg(json_build_object(
        'user_id', en.user_id,
        'name', p.full_name,
        'grade', p.grade,
        'parent_phone', p.parent_phone,
        'enrolled_at', en.enrolled_at,
        'content_done', (
          select count(*) from public.lesson_progress lp
          join public.lessons l on l.id = lp.lesson_id
          where lp.user_id = en.user_id and l.course_id = p_course
        ) + (
          select count(*) from public.exam_attempts a
          join public.exams e on e.id = a.exam_id
          where a.user_id = en.user_id and e.course_id = p_course and e.is_published
            and a.submitted_at is not null
        ),
        'last_activity', (
          select max(activity_at) from (
            select lp.completed_at as activity_at from public.lesson_progress lp
            join public.lessons l on l.id = lp.lesson_id
            where lp.user_id = en.user_id and l.course_id = p_course
            union all
            select a.submitted_at from public.exam_attempts a
            join public.exams e on e.id = a.exam_id
            where a.user_id = en.user_id and e.course_id = p_course and a.submitted_at is not null
          ) activity
        ),
        'attempts', coalesce((
          select json_agg(json_build_object(
            'exam_id', a.exam_id, 'percent', a.percent, 'passed', a.passed,
            'pending', a.essay_pending, 'submitted_at', a.submitted_at
          ) order by a.submitted_at desc)
          from public.exam_attempts a
          join public.exams e on e.id = a.exam_id
          where a.user_id = en.user_id and e.course_id = p_course and a.submitted_at is not null
        ), '[]'::json)
      ) order by en.enrolled_at desc)
      from public.enrollments en
      join public.profiles p on p.id = en.user_id
      where en.course_id = p_course
    ), '[]'::json)
  );
end;
$$;

revoke all on function public.teacher_course_students(uuid) from public, anon;
grant execute on function public.teacher_course_students(uuid) to authenticated;
