-- Scheduled teacher certificate campaigns + private printable certificates.
-- Run after 78_exam_certificate_emails.sql. Enable pg_cron, pg_net and Vault
-- in Supabase before applying the scheduler setup at the bottom of this file.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.exam_certificate_campaigns (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  min_percent integer not null check (min_percent between 0 and 100),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','sending','sent','partial','failed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.exam_certificate_campaigns add column if not exists updated_at timestamptz not null default now();
create index if not exists exam_certificate_campaigns_due_idx
  on public.exam_certificate_campaigns(status, scheduled_at);
create index if not exists exam_certificate_campaigns_teacher_idx
  on public.exam_certificate_campaigns(teacher_id, created_at desc);
alter table public.exam_certificate_campaigns enable row level security;
revoke all on public.exam_certificate_campaigns from public, anon, authenticated;

alter table public.exam_certificate_deliveries
  add column if not exists campaign_id uuid references public.exam_certificate_campaigns(id) on delete set null,
  add column if not exists certificate_token text,
  add column if not exists send_attempts integer not null default 0;
update public.exam_certificate_deliveries
set certificate_token = encode(extensions.gen_random_bytes(24), 'hex')
where certificate_token is null;
create unique index if not exists exam_certificate_deliveries_certificate_token_idx
  on public.exam_certificate_deliveries(certificate_token);
create index if not exists exam_certificate_deliveries_student_idx
  on public.exam_certificate_deliveries(student_id, status, sent_at desc);

create or replace function public.claim_scheduled_exam_certificate_recipients(p_campaign uuid)
returns table(attempt_id uuid, student_name text, email text, percent integer,
              certificate_token text, exam_title text, teacher_name text)
language plpgsql security definer set search_path = public, auth, extensions as $$
declare c public.exam_certificate_campaigns%rowtype;
begin
  select * into c from public.exam_certificate_campaigns where id=p_campaign for update;
  if not found or c.status not in ('scheduled','partial','sending') or c.scheduled_at > now() then return; end if;
  if c.status='sending' and c.updated_at >= now()-interval '15 minutes' then return; end if;

  update public.exam_certificate_campaigns set status='sending', updated_at=now(), finished_at=null where id=c.id;
  return query
  with eligible as (
    select a.id attempt_id, a.user_id student_id, u.email::text email,
           coalesce(nullif(trim(p.full_name),''),'الطالب') student_name,
           a.percent::integer percent,
           coalesce(nullif(trim(e.title),''),'الامتحان') exam_title,
           coalesce(nullif(trim(tp.full_name),''),'مدرّسك') teacher_name
    from public.exam_attempts a
    join public.profiles p on p.id=a.user_id and p.role='student'
    join auth.users u on u.id=a.user_id and u.email is not null
    join public.exams e on e.id=c.exam_id and e.is_published
    join public.profiles tp on tp.id=c.teacher_id
    left join public.courses course on course.id=e.course_id
    where a.exam_id=c.exam_id and a.submitted_at is not null and a.passed is true
      and a.essay_pending is false and a.percent >= c.min_percent
      and (course.teacher_id=c.teacher_id or (e.course_id is null and e.created_by=c.teacher_id))
      and not exists (
        select 1 from public.exam_certificate_deliveries old_delivery
        where old_delivery.attempt_id=a.id and (
          old_delivery.status='sent'
          or (old_delivery.status='failed' and old_delivery.send_attempts>=5)
          or (old_delivery.status='sending' and old_delivery.updated_at>=now()-interval '15 minutes')
        )
      )
    order by a.submitted_at, a.id
    limit 5
  ), claimed as (
    insert into public.exam_certificate_deliveries as d
      (attempt_id,exam_id,student_id,email,percent,status,claimed_by,campaign_id,certificate_token,send_attempts,updated_at)
    select x.attempt_id,c.exam_id,x.student_id,x.email,x.percent,'sending',c.teacher_id,c.id,
           encode(extensions.gen_random_bytes(24),'hex'),1,now()
    from eligible x
    on conflict (attempt_id) do update set
      email=excluded.email, percent=excluded.percent, status='sending', claimed_by=excluded.claimed_by,
      campaign_id=excluded.campaign_id,
      certificate_token=coalesce(d.certificate_token,excluded.certificate_token),
      send_attempts=d.send_attempts+1,last_error=null,updated_at=now()
    where d.status='failed' and d.send_attempts < 5
       or (d.status='sending' and d.updated_at < now()-interval '15 minutes' and d.send_attempts < 5)
    returning d.attempt_id,d.certificate_token
  )
  select x.attempt_id,x.student_name,x.email,x.percent,cl.certificate_token,x.exam_title,x.teacher_name
  from eligible x join claimed cl on cl.attempt_id=x.attempt_id;
end;
$$;

create or replace function public.finish_scheduled_exam_certificate_delivery(
  p_attempt uuid,p_campaign uuid,p_sent boolean,p_error text default null
) returns void language plpgsql security definer set search_path=public as $$
begin
  update public.exam_certificate_deliveries d
  set status=case when p_sent then 'sent' else 'failed' end,
      sent_at=case when p_sent then now() else null end,
      last_error=case when p_sent then null else left(coalesce(p_error,'send_failed'),300) end,
      updated_at=now()
  where d.attempt_id=p_attempt and d.campaign_id=p_campaign and d.status='sending';
  if not found then raise exception 'delivery_not_owned' using errcode='42501'; end if;
end;
$$;

create or replace function public.finalize_exam_certificate_campaign(p_campaign uuid)
returns void language plpgsql security definer set search_path=public as $$
declare pending_count integer; retry_count integer; failed_count integer; undispatched_count integer;
begin
  select count(*) filter (where status='sending'),
         count(*) filter (where status='failed' and send_attempts<5),
         count(*) filter (where status='failed' and send_attempts>=5)
  into pending_count,retry_count,failed_count
  from public.exam_certificate_deliveries where campaign_id=p_campaign;
  select count(*) into undispatched_count
  from public.exam_certificate_campaigns campaign
  join public.exams e on e.id=campaign.exam_id
  join public.exam_attempts a on a.exam_id=e.id and a.submitted_at is not null and a.passed is true
    and a.essay_pending is false and a.percent>=campaign.min_percent
  join auth.users u on u.id=a.user_id and u.email is not null
  left join public.courses course on course.id=e.course_id
  left join public.exam_certificate_deliveries d on d.attempt_id=a.id
  where campaign.id=p_campaign and (course.teacher_id=campaign.teacher_id or (e.course_id is null and e.created_by=campaign.teacher_id))
    and d.attempt_id is null;
  update public.exam_certificate_campaigns
  set status=case when pending_count>0 then 'sending'
                  when retry_count>0 or undispatched_count>0 then 'partial'
                  when failed_count>0 then 'failed'
                  else 'sent' end,
      updated_at=now(),finished_at=case when pending_count=0 and retry_count=0 and undispatched_count=0 then now() else null end
  where id=p_campaign;
end;
$$;

create or replace function public.my_exam_certificates()
returns table(certificate_token text,exam_title text,course_title text,percent integer,sent_at timestamptz,teacher_name text)
language sql security definer stable set search_path=public as $$
  select d.certificate_token,e.title,coalesce(c.title,'امتحان مستقل'),d.percent,d.sent_at,p.full_name
  from public.exam_certificate_deliveries d
  join public.exams e on e.id=d.exam_id
  left join public.courses c on c.id=e.course_id
  left join public.profiles p on p.id=d.claimed_by
  where d.student_id=(select auth.uid()) and d.status='sent' and d.certificate_token is not null
  order by d.sent_at desc;
$$;

create or replace function public.get_public_exam_certificate(p_token text)
returns jsonb language sql security definer stable set search_path=public as $$
  select jsonb_build_object(
    'student_name',coalesce(nullif(trim(student.full_name),''),'الطالب'),
    'exam_title',e.title,'course_title',coalesce(c.title,'امتحان مستقل'),
    'percent',d.percent,'issued_at',d.sent_at,'teacher_name',teacher.full_name
  )
  from public.exam_certificate_deliveries d
  join public.profiles student on student.id=d.student_id
  join public.exams e on e.id=d.exam_id
  left join public.courses c on c.id=e.course_id
  left join public.profiles teacher on teacher.id=d.claimed_by
  where d.certificate_token=p_token and d.status='sent'
  limit 1;
$$;
revoke all on function public.my_exam_certificates() from public, anon;
revoke all on function public.get_public_exam_certificate(text) from public;
grant execute on function public.my_exam_certificates() to authenticated;
grant execute on function public.get_public_exam_certificate(text) to anon, authenticated;
revoke all on function public.claim_scheduled_exam_certificate_recipients(uuid) from public, anon, authenticated;
revoke all on function public.finish_scheduled_exam_certificate_delivery(uuid,uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.finalize_exam_certificate_campaign(uuid) from public, anon, authenticated;
grant execute on function public.claim_scheduled_exam_certificate_recipients(uuid) to service_role;
grant execute on function public.finish_scheduled_exam_certificate_delivery(uuid,uuid,boolean,text) to service_role;
grant execute on function public.finalize_exam_certificate_campaign(uuid) to service_role;

-- After enabling pg_cron, pg_net and Vault, save these two values in Vault,
-- then schedule one-minute processing:
-- select vault.create_secret('https://edu-help1.vercel.app','eduhelp_certificate_app_url');
-- select vault.create_secret('<same value as Vercel CERTIFICATE_CRON_SECRET>','eduhelp_certificate_cron_secret');
-- select cron.schedule('eduhelp-send-certificates','* * * * *',$job$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name='eduhelp_certificate_app_url'),
--     headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='eduhelp_certificate_cron_secret'),'Content-Type','application/json'),
--     body := '{}'::jsonb
--   );
-- $job$);
