-- Switch certificate delivery to immediate teacher-triggered sending.
-- Run after 78_exam_certificate_emails.sql and 79_scheduled_exam_certificates.sql.

create or replace function public.claim_immediate_exam_certificate_recipients(
  p_exam uuid,
  p_min_percent integer,
  p_teacher uuid
)
returns table(attempt_id uuid, student_name text, email text, percent integer, certificate_token text)
language plpgsql security definer set search_path=public,auth,extensions as $$
begin
  if p_min_percent is null or p_min_percent < 0 or p_min_percent > 100 then
    raise exception 'invalid_min_percent' using errcode='22023';
  end if;
  if not exists (
    select 1
    from public.profiles p
    join public.exams e on e.id=p_exam and e.is_published
    left join public.courses c on c.id=e.course_id
    where p.id=p_teacher and p.role='teacher'
      and (c.teacher_id=p_teacher or (e.course_id is null and e.created_by=p_teacher))
  ) then
    raise exception 'exam_not_owned_or_unpublished' using errcode='42501';
  end if;

  return query
  with eligible as (
    select a.id attempt_id,a.user_id student_id,u.email::text email,
           coalesce(nullif(trim(p.full_name),''),'الطالب') student_name,
           a.percent::integer percent
    from public.exam_attempts a
    join public.profiles p on p.id=a.user_id and p.role='student'
    join auth.users u on u.id=a.user_id and u.email is not null
    where a.exam_id=p_exam and a.submitted_at is not null
      and a.passed is true and a.essay_pending is false and a.percent>=p_min_percent
    order by a.submitted_at,a.id
  ), claimed as (
    insert into public.exam_certificate_deliveries as d
      (attempt_id,exam_id,student_id,email,percent,status,claimed_by,certificate_token,send_attempts,updated_at)
    select x.attempt_id,p_exam,x.student_id,x.email,x.percent,'sending',p_teacher,
           encode(extensions.gen_random_bytes(24),'hex'),1,now()
    from eligible x
    on conflict on constraint exam_certificate_deliveries_pkey do update set
      email=excluded.email,percent=excluded.percent,status='sending',claimed_by=p_teacher,
      certificate_token=coalesce(d.certificate_token,excluded.certificate_token),
      send_attempts=d.send_attempts+1,last_error=null,updated_at=now()
    where (d.status='failed' and d.send_attempts<5)
       or (d.status='sending' and d.updated_at<now()-interval '15 minutes' and d.send_attempts<5)
    returning d.attempt_id,d.certificate_token
  )
  select x.attempt_id,x.student_name,x.email,x.percent,c.certificate_token
  from eligible x join claimed c on c.attempt_id=x.attempt_id;
end;
$$;

revoke all on function public.claim_immediate_exam_certificate_recipients(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_immediate_exam_certificate_recipients(uuid,integer,uuid) to service_role;

-- Stop and remove any scheduled sends left over from the previous version.
update public.exam_certificate_campaigns
set status='cancelled',updated_at=now(),finished_at=now()
where status in ('scheduled','partial','sending');

do $$
declare job record;
begin
  for job in select jobid from cron.job where jobname='eduhelp-send-certificates' loop
    perform cron.unschedule(job.jobid);
  end loop;
end;
$$;
