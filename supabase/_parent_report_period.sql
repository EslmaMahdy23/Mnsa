-- Bind parent report activity to a period selected by the teacher/admin.
-- Run after _parent_report.sql. Course progress remains lifetime progress.

alter table public.parent_report_links
  add column if not exists report_from date,
  add column if not exists report_to date;

update public.parent_report_links
set report_from = coalesce(report_from, (now() at time zone 'Africa/Cairo')::date - 6),
    report_to = coalesce(report_to, (now() at time zone 'Africa/Cairo')::date)
where report_from is null or report_to is null;

alter table public.parent_report_links
  alter column report_from set default ((now() at time zone 'Africa/Cairo')::date - 6),
  alter column report_to set default ((now() at time zone 'Africa/Cairo')::date),
  alter column report_from set not null,
  alter column report_to set not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.parent_report_links'::regclass
      and conname = 'parent_report_links_period_check'
  ) then
    alter table public.parent_report_links
      add constraint parent_report_links_period_check
      check (report_from <= report_to and report_to - report_from <= 365);
  end if;
end $$;

-- Period-aware link generation replaces the student's previous active link.
create or replace function public.create_parent_report_link(p_student uuid, p_from date, p_to date)
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
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'invalid_report_period' using errcode = '22023';
  end if;

  select p.role into v_role from public.profiles p where p.id = p_student;
  if v_role is distinct from 'student' then raise exception 'student_not_found' using errcode = 'P0002'; end if;

  if not public.is_admin() and not exists (
    select 1 from public.enrollments en
    join public.courses c on c.id = en.course_id
    where en.user_id = p_student and c.teacher_id = v_user
  ) then
    raise exception 'student_not_in_teacher_courses' using errcode = '42501';
  end if;

  update public.parent_report_links set is_active = false
  where student_id = p_student and is_active;

  insert into public.parent_report_links(student_id, token, created_by, report_from, report_to)
  values (p_student, v_token, v_user, p_from, p_to);

  return v_token;
end;
$$;

revoke all on function public.create_parent_report_link(uuid,date,date) from public, anon;
grant execute on function public.create_parent_report_link(uuid,date,date) to authenticated;

-- Include the saved range beside the token for the teacher/admin UI.
drop function if exists public.get_parent_report_links(uuid[]);
create function public.get_parent_report_links(p_students uuid[])
returns table(student_id uuid, token text, report_from date, report_to date)
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
  select l.student_id, l.token, l.report_from, l.report_to
  from public.parent_report_links l
  where l.is_active
    and l.student_id = any(coalesce(p_students, array[]::uuid[]))
    and (
      public.is_admin()
      or exists (
        select 1 from public.enrollments en
        join public.courses c on c.id = en.course_id
        where en.user_id = l.student_id and c.teacher_id = v_user
      )
    );
end;
$$;

revoke all on function public.get_parent_report_links(uuid[]) from public, anon;
grant execute on function public.get_parent_report_links(uuid[]) to authenticated;

-- Public bearer-link report: activity and exam results are period-scoped;
-- course progress is intentionally calculated across the full course history.
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
  v_from date;
  v_to date;
  v_start timestamptz;
  v_end timestamptz;
  v_report jsonb;
begin
  if p_token is null or length(p_token) < 32 then return null; end if;

  select l.id, l.student_id, l.report_from, l.report_to
    into v_link_id, v_student, v_from, v_to
  from public.parent_report_links l
  where l.token = p_token and l.is_active;
  if v_link_id is null then return null; end if;

  update public.parent_report_links set last_viewed_at = now()
  where id = v_link_id and is_active;
  if not found then return null; end if;

  v_start := v_from::timestamp at time zone 'Africa/Cairo';
  v_end := (v_to + 1)::timestamp at time zone 'Africa/Cairo';

  select p.full_name into v_full_name from public.profiles p where p.id = v_student;
  v_first_name := split_part(trim(coalesce(v_full_name, '')), ' ', 1);
  select case when u.last_sign_in_at >= v_start and u.last_sign_in_at < v_end
    then u.last_sign_in_at else null end
    into v_last_login from auth.users u where u.id = v_student;

  select jsonb_build_object(
    'student_first_name', coalesce(nullif(v_first_name, ''), 'الطالب'),
    'period_from', v_from,
    'period_to', v_to,
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
          (select count(*)::integer from public.lesson_progress lp
             join public.lessons l on l.id = lp.lesson_id
            where lp.user_id = v_student and l.course_id = c.id)
          + (select count(*)::integer from public.exam_attempts a
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
        where ea.user_id = v_student and ea.submitted_at >= v_start and ea.submitted_at < v_end
        order by ea.submitted_at desc limit 100
      ) a
      left join public.exams e on e.id = a.exam_id
      left join public.courses c on c.id = e.course_id
    ), '[]'::jsonb),
    'activity', jsonb_build_object(
      'last_activity_at', (
        select max(activity.activity_at)
        from (
          select lp.completed_at as activity_at from public.lesson_progress lp
          where lp.user_id = v_student and lp.completed_at >= v_start and lp.completed_at < v_end
          union all
          select a.started_at from public.exam_attempts a
          where a.user_id = v_student and a.started_at >= v_start and a.started_at < v_end
          union all
          select a.submitted_at from public.exam_attempts a
          where a.user_id = v_student and a.submitted_at >= v_start and a.submitted_at < v_end
        ) activity
      ),
      'completed_lessons', (select count(*)::integer from public.lesson_progress lp
        where lp.user_id = v_student and lp.completed_at >= v_start and lp.completed_at < v_end),
      'started_exams', (select count(*)::integer from public.exam_attempts a
        where a.user_id = v_student and a.started_at >= v_start and a.started_at < v_end),
      'submitted_exams', (select count(*)::integer from public.exam_attempts a
        where a.user_id = v_student and a.submitted_at >= v_start and a.submitted_at < v_end)
    )
  ) into v_report;

  return v_report;
end;
$$;

revoke all on function public.get_parent_report(text) from public;
grant execute on function public.get_parent_report(text) to anon, authenticated;
