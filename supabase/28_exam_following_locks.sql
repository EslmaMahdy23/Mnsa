-- Let an admin lock all later items in the same section until students pass this exam.
alter table public.exams
  add column if not exists lock_following boolean not null default false;

create or replace function public.is_exam_unlocked(p_exam uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((
    select
      (select public.is_admin())
      or c.teacher_id = (select auth.uid())
      or (
        public.is_section_unlocked(e.section_id)
        and not exists (
          select 1
          from public.exams blocker
          where blocker.section_id = e.section_id
            and blocker.lock_following
            and blocker.is_published and blocker.question_count > 0
            and (blocker.position, blocker.created_at, blocker.id) < (e.position, e.created_at, e.id)
            and not exists (
              select 1 from public.exam_attempts a
              where a.exam_id = blocker.id and a.user_id = (select auth.uid()) and a.passed is true
            )
        )
      )
    from public.exams e
    join public.courses c on c.id = e.course_id
    where e.id = p_exam
  ), true);
$$;

create or replace function public.is_lesson_unlocked(p_lesson uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((
    select
      (select public.is_admin())
      or c.teacher_id = (select auth.uid())
      or (
        (l.is_free_preview or public.is_section_unlocked(l.section_id))
        and not exists (
          select 1
          from public.exams blocker
          where blocker.section_id = l.section_id
            and blocker.lock_following
            and blocker.is_published and blocker.question_count > 0
            and (blocker.position, blocker.created_at, blocker.id) < (l.position, l.created_at, l.id)
            and not exists (
              select 1 from public.exam_attempts a
              where a.exam_id = blocker.id and a.user_id = (select auth.uid()) and a.passed is true
            )
        )
      )
    from public.lessons l
    join public.courses c on c.id = l.course_id
    where l.id = p_lesson
  ), false);
$$;

drop policy if exists "lessons read" on public.lessons;
create policy "lessons read" on public.lessons for select
  using (exists (
    select 1 from public.courses c
    where c.id = lessons.course_id
      and (
        c.teacher_id = (select auth.uid()) or (select public.is_admin())
        or ((select auth.uid()) is not null and c.is_published
          and public.is_lesson_unlocked(lessons.id)
          and (lessons.is_free_preview or exists (
            select 1 from public.enrollments e
            where e.course_id = c.id and e.user_id = (select auth.uid())
          )))
      )
  ));

drop policy if exists "exams read" on public.exams;
create policy "exams read" on public.exams for select
  using (
    (select public.is_admin())
    or (is_published and (
      course_id is null
      or exists (select 1 from public.enrollments e
                 where e.course_id = exams.course_id and e.user_id = (select auth.uid()))
    ) and (section_id is null or public.is_exam_unlocked(exams.id)))
  );

create or replace function public.start_exam(p_exam uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_exam public.exams%rowtype;
  v_att public.exam_attempts%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_exam from public.exams e
   where e.id = p_exam and e.is_published
     and (e.course_id is null or exists (
       select 1 from public.enrollments en
       where en.course_id = e.course_id and en.user_id = v_user
     ));
  if not found then
    raise exception 'exam not available' using errcode = 'P0002';
  end if;

  if v_exam.section_id is not null and not public.is_section_unlocked(v_exam.section_id) then
    raise exception 'section locked' using errcode = 'EH002';
  end if;
  if v_exam.section_id is not null and not public.is_exam_unlocked(v_exam.id) then
    raise exception 'exam locked' using errcode = 'EH003';
  end if;

  select * into v_att from public.exam_attempts where exam_id = p_exam and user_id = v_user;
  if not found then
    insert into public.exam_attempts (exam_id, exam_title, user_id)
    values (p_exam, v_exam.title, v_user)
    on conflict (exam_id, user_id) do nothing;
    select * into v_att from public.exam_attempts where exam_id = p_exam and user_id = v_user;
  end if;
  if v_att.submitted_at is not null then
    raise exception 'already submitted' using errcode = '23505';
  end if;
  if v_exam.duration_minutes is not null
     and now() > v_att.started_at + make_interval(mins => v_exam.duration_minutes) + interval '2 minutes' then
    update public.exam_attempts
       set submitted_at = now(), score = 0, total = v_exam.total_points, percent = 0, passed = false
     where id = v_att.id;
    raise exception 'time is over' using errcode = '23505';
  end if;

  return json_build_object(
    'attempt_id', v_att.id, 'title', v_exam.title, 'started_at', v_att.started_at,
    'server_now', now(), 'duration_minutes', v_exam.duration_minutes,
    'questions', coalesce((
      select json_agg(json_build_object('id', q.id, 'body', q.body, 'options', to_json(q.options), 'points', q.points)
      order by q.position) from public.exam_questions q where q.exam_id = v_exam.id
    ), '[]'::json)
  );
end;
$$;

-- Return only display-safe metadata for locked rows; never expose lesson URLs/content.
drop function if exists public.get_course_locked_items(uuid);
create or replace function public.get_course_locked_items(p_course uuid)
returns table(
  section_id uuid,
  item_id uuid,
  item_type text,
  content_kind text,
  title text,
  "position" integer,
  blocking_exam_title text
)
language sql security definer stable set search_path = public as $$
  with eligible_course as (
    select c.id
    from public.courses c
    where c.id = p_course and c.is_published
      and not (select public.is_admin())
      and c.teacher_id is distinct from (select auth.uid())
      and exists (
        select 1 from public.enrollments en
        where en.course_id = c.id and en.user_id = (select auth.uid())
      )
  ), locked_lessons as (
    select l.section_id, l.id as item_id, 'lesson'::text as item_type,
           case
             when l.kind = 'video' then 'video'
             else 'file'
           end::text as content_kind,
           l.title, l.position, blocker.title as blocking_exam_title
    from public.lessons l
    join eligible_course c on c.id = l.course_id
    join lateral (
      select e.title
      from public.exams e
      where e.section_id = l.section_id and e.lock_following
        and e.is_published and e.question_count > 0
        and (e.position, e.created_at, e.id) < (l.position, l.created_at, l.id)
        and not exists (
          select 1 from public.exam_attempts a
          where a.exam_id = e.id and a.user_id = (select auth.uid()) and a.passed is true
        )
      order by e.position desc, e.created_at desc, e.id desc
      limit 1
    ) blocker on true
    where not public.is_lesson_unlocked(l.id)
  ), locked_exams as (
    select e.section_id, e.id as item_id, 'exam'::text as item_type,
           'exam'::text as content_kind, e.title, e.position, blocker.title as blocking_exam_title
    from public.exams e
    join eligible_course c on c.id = e.course_id
    join lateral (
      select previous.title
      from public.exams previous
      where previous.section_id = e.section_id and previous.lock_following
        and previous.is_published and previous.question_count > 0
        and (previous.position, previous.created_at, previous.id) < (e.position, e.created_at, e.id)
        and not exists (
          select 1 from public.exam_attempts a
          where a.exam_id = previous.id and a.user_id = (select auth.uid()) and a.passed is true
        )
      order by previous.position desc, previous.created_at desc, previous.id desc
      limit 1
    ) blocker on true
    where e.is_published and e.question_count > 0 and not public.is_exam_unlocked(e.id)
  )
  select * from locked_lessons
  union all
  select * from locked_exams;
$$;

revoke all on function public.is_exam_unlocked(uuid) from public, anon;
revoke all on function public.is_lesson_unlocked(uuid) from public, anon;
grant execute on function public.is_exam_unlocked(uuid) to authenticated;
grant execute on function public.is_lesson_unlocked(uuid) to authenticated;
revoke all on function public.get_course_locked_items(uuid) from public, anon;
grant execute on function public.get_course_locked_items(uuid) to authenticated;
revoke all on function public.start_exam(uuid) from public, anon;
grant execute on function public.start_exam(uuid) to authenticated;
