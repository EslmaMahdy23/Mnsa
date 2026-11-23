-- Email a branded certificate to students who passed one of a teacher's published exams.
-- Run after the existing exam and teacher exam migrations.

create table if not exists public.exam_certificate_deliveries (
  attempt_id uuid primary key references public.exam_attempts(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  percent integer not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  claimed_by uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists exam_certificate_deliveries_exam_status_idx
  on public.exam_certificate_deliveries (exam_id, status);

alter table public.exam_certificate_deliveries enable row level security;
revoke all on public.exam_certificate_deliveries from public, anon, authenticated;

-- These RPCs are server-only. The API verifies the teacher session, and this
-- function independently confirms that the requested exam belongs to them.
create or replace function public.claim_exam_certificate_recipients(
  p_exam uuid,
  p_min_percent integer,
  p_teacher uuid
)
returns table(attempt_id uuid, student_name text, email text, percent integer)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if p_min_percent is null or p_min_percent < 0 or p_min_percent > 100 then
    raise exception 'invalid_min_percent' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles p
    join public.exams e on e.id = p_exam
    left join public.courses c on c.id = e.course_id
    where p.id = p_teacher and p.role = 'teacher' and e.is_published
      and (c.teacher_id = p_teacher or (e.course_id is null and e.created_by = p_teacher))
  ) then
    raise exception 'exam_not_owned_or_unpublished' using errcode = '42501';
  end if;

  return query
  with eligible as (
    select a.id as attempt_id, a.user_id as student_id, u.email::text as email,
           coalesce(nullif(trim(p.full_name), ''), 'الطالب') as student_name,
           a.percent::integer as percent
    from public.exam_attempts a
    join public.profiles p on p.id = a.user_id and p.role = 'student'
    join auth.users u on u.id = a.user_id
    where a.exam_id = p_exam and a.submitted_at is not null
      and a.passed is true and a.essay_pending is false
      and a.percent >= p_min_percent and u.email is not null
  ), claimed as (
    insert into public.exam_certificate_deliveries as d
      (attempt_id, exam_id, student_id, email, percent, status, claimed_by, updated_at)
    select e.attempt_id, p_exam, e.student_id, e.email, e.percent, 'sending', p_teacher, now()
    from eligible e
    on conflict (attempt_id) do update
      set email = excluded.email,
          percent = excluded.percent,
          status = 'sending',
          claimed_by = p_teacher,
          last_error = null,
          updated_at = now()
      where d.status = 'failed'
         or (d.status = 'sending' and d.updated_at < now() - interval '15 minutes')
    returning d.attempt_id
  )
  select e.attempt_id, e.student_name, e.email, e.percent
  from eligible e join claimed c on c.attempt_id = e.attempt_id;
end;
$$;

create or replace function public.finish_exam_certificate_delivery(
  p_attempt uuid,
  p_teacher uuid,
  p_sent boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.exam_certificate_deliveries d
  set status = case when p_sent then 'sent' else 'failed' end,
      sent_at = case when p_sent then now() else null end,
      last_error = case when p_sent then null else left(coalesce(p_error, 'send_failed'), 300) end,
      updated_at = now()
  where d.attempt_id = p_attempt and d.claimed_by = p_teacher and d.status = 'sending'
    and exists (
      select 1 from public.exams e
      left join public.courses c on c.id = e.course_id
      where e.id = d.exam_id
        and (c.teacher_id = p_teacher or (e.course_id is null and e.created_by = p_teacher))
    );
  if not found then raise exception 'delivery_not_owned' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.claim_exam_certificate_recipients(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.finish_exam_certificate_delivery(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_exam_certificate_recipients(uuid, integer, uuid) to service_role;
grant execute on function public.finish_exam_certificate_delivery(uuid, uuid, boolean, text) to service_role;
