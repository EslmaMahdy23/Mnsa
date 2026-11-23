-- Teacher supplied certificate art and the student's variable name position.
-- Run after 80_immediate_exam_certificates.sql.

alter table public.exams
  add column if not exists certificate_template_url text,
  add column if not exists certificate_name_x numeric not null default 50,
  add column if not exists certificate_name_y numeric not null default 48,
  add column if not exists certificate_name_color text not null default '#123B59',
  add column if not exists certificate_name_size numeric not null default 5.2;

create or replace function public.get_public_exam_certificate(p_token text)
returns jsonb language sql security definer stable set search_path=public as $$
  select jsonb_build_object(
    'student_name',coalesce(nullif(trim(student.full_name),''),'الطالب'),
    'exam_title',e.title,'course_title',coalesce(c.title,'امتحان مستقل'),
    'percent',d.percent,'issued_at',d.sent_at,'teacher_name',teacher.full_name,
    'certificate_template_url',e.certificate_template_url,
    'certificate_name_x',e.certificate_name_x,
    'certificate_name_y',e.certificate_name_y,
    'certificate_name_color',e.certificate_name_color,
    'certificate_name_size',e.certificate_name_size
  )
  from public.exam_certificate_deliveries d
  join public.profiles student on student.id=d.student_id
  join public.exams e on e.id=d.exam_id
  left join public.courses c on c.id=e.course_id
  left join public.profiles teacher on teacher.id=d.claimed_by
  where d.certificate_token=p_token and d.status='sent'
  limit 1;
$$;

revoke all on function public.get_public_exam_certificate(text) from public;
grant execute on function public.get_public_exam_certificate(text) to anon,authenticated;
