-- Teacher essay grading and controlled retakes. Run after 63_teacher_direct_publish.sql.

create table if not exists public.exam_attempt_retries (
  id uuid primary key default gen_random_uuid(),
  old_attempt_id uuid not null,
  exam_id uuid not null references public.exams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_title text not null,
  previous_percent integer,
  previous_passed boolean not null default false,
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now()
);
alter table public.exam_attempt_retries enable row level security;
revoke all on public.exam_attempt_retries from public, anon, authenticated;

-- The private core routines were originally admin-only. Their public wrappers
-- below perform teacher/grader ownership checks, so let those trusted wrappers
-- call the core for the authorized caller as well.
create or replace function public.admin_get_essay_attempt_core(p_attempt uuid)
returns json language plpgsql security definer stable set search_path=public as $$
declare v_data json;
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  select json_build_object('attempt_id',a.id,'exam_title',a.exam_title,'student_name',p.full_name,
    'student_grade',p.grade,'submitted_at',a.submitted_at,'questions',coalesce((
    select json_agg(json_build_object('id',q.val->>'id','body',q.val->>'body','points',(q.val->>'points')::numeric,
      'answer',d.essay_answers->>(q.val->>'id'),'grade',d.essay_grades->(q.val->>'id')) order by q.ord)
    from public.exam_attempt_details d,jsonb_array_elements(d.snapshot) with ordinality q(val,ord)
    where d.attempt_id=a.id and q.val->>'question_type'='essay'
  ),'[]'::json)) into v_data from public.exam_attempts a join public.profiles p on p.id=a.user_id
  where a.id=p_attempt and a.submitted_at is not null and a.essay_pending;
  if v_data is null then raise exception 'essay attempt not found or already graded' using errcode='P0002'; end if;
  return v_data;
end; $$;

create or replace function public.admin_grade_exam_essays_core(p_attempt uuid,p_grades jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_att public.exam_attempts%rowtype; v_det public.exam_attempt_details%rowtype; v_exam public.exams%rowtype;
  v_q jsonb; v_grade jsonb; v_total numeric(9,2); v_score numeric(9,2); v_pct int; v_pass boolean; v_final jsonb:='{}'::jsonb;
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  if jsonb_typeof(p_grades)<>'array' then raise exception 'bad grades' using errcode='22023'; end if;
  select * into v_att from public.exam_attempts where id=p_attempt for update;
  if not found or not v_att.essay_pending then raise exception 'essay attempt not pending' using errcode='23505'; end if;
  select * into v_det from public.exam_attempt_details where attempt_id=p_attempt for update;
  if not found then raise exception 'attempt details not found' using errcode='P0002'; end if;
  select * into v_exam from public.exams where id=v_att.exam_id;
  for v_q in select value from jsonb_array_elements(v_det.snapshot) where value->>'question_type'='essay' loop
    select value into v_grade from jsonb_array_elements(p_grades) where value->>'id'=v_q->>'id' limit 1;
    if v_grade is null or (v_grade->>'score') !~ '^\d+(\.5)?$' then raise exception 'missing or invalid essay grade' using errcode='22023'; end if;
    if (v_grade->>'score')::numeric < 0 or (v_grade->>'score')::numeric > (v_q->>'points')::numeric then raise exception 'essay grade out of range' using errcode='22023'; end if;
    v_final:=v_final||jsonb_build_object(v_q->>'id',jsonb_build_object('score',(v_grade->>'score')::numeric,'feedback',nullif(trim(coalesce(v_grade->>'feedback','')),'')));
  end loop;
  if jsonb_array_length(p_grades)<>(select count(*) from jsonb_array_elements(v_det.snapshot) where value->>'question_type'='essay') then raise exception 'unexpected essay grade' using errcode='22023'; end if;
  select coalesce(sum((value->>'points')::int),0) into v_total from jsonb_array_elements(v_det.snapshot);
  select v_det.mcq_score+coalesce(sum((value->>'score')::numeric),0) into v_score from jsonb_each(v_final);
  v_pct:=case when v_total=0 then 0 else round(v_score*100.0/v_total)::int end;
  v_pass:=v_pct>=coalesce(v_exam.pass_percent,v_att.pass_percent_snapshot,50);
  update public.exam_attempt_details set essay_grades=v_final where attempt_id=p_attempt;
  update public.exam_attempts set essay_pending=false,score=v_score,total=v_total,percent=v_pct,passed=v_pass where id=p_attempt;
  insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    values(v_att.user_id,'exam_essay_review',v_att.id,'تم تصحيح الامتحان: '||v_att.exam_title,'ظهرت درجتك بعد مراجعة الإجابات المقالية.','/dashboard/profile')
    on conflict(user_id,source_type,source_id) do update set created_at=now(),read_at=null;
  return json_build_object('score',v_score,'total',v_total,'percent',v_pct,'passed',v_pass);
end; $$;

create or replace function public.can_grade_exam_essays()
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','essay_grader','teacher'));
$$;

create or replace function public.grader_list_essay_attempts()
returns json language plpgsql security definer stable set search_path=public as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id',a.id,'exam_title',a.exam_title,'student_name',p.full_name,'student_grade',p.grade,
      'submitted_at',a.submitted_at,
      'essay_count',(select count(*) from public.exam_attempt_details d,jsonb_array_elements(d.snapshot) q(val)
        where d.attempt_id=a.id and q.val->>'question_type'='essay')
    ) order by a.submitted_at)
    from public.exam_attempts a
    join public.profiles p on p.id=a.user_id
    join public.exams e on e.id=a.exam_id
    left join public.courses c on c.id=e.course_id
    where a.essay_pending and a.submitted_at is not null and (
      public.is_admin()
      or (v_role='teacher' and coalesce(c.teacher_id,e.created_by)=auth.uid())
      or (v_role='essay_grader' and (
        not exists(select 1 from public.teacher_exam_graders g0 where g0.grader_id=auth.uid())
        or exists(select 1 from public.teacher_exam_graders g where g.grader_id=auth.uid() and g.teacher_id=coalesce(c.teacher_id,e.created_by))
      ))
    )
  ),'[]'::json);
end; $$;

create or replace function public.admin_get_essay_attempt(p_attempt uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_owner uuid; v_role text;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  select coalesce(c.teacher_id,e.created_by) into v_owner from public.exam_attempts a join public.exams e on e.id=a.exam_id left join public.courses c on c.id=e.course_id where a.id=p_attempt;
  if not public.is_admin() and not (
    (v_role='teacher' and v_owner=auth.uid())
    or (v_role='essay_grader' and (
      not exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid())
      or exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid() and teacher_id=v_owner)
    ))
  ) then raise exception 'not allowed' using errcode='42501'; end if;
  return public.admin_get_essay_attempt_core(p_attempt);
end; $$;

create or replace function public.admin_grade_exam_essays(p_attempt uuid,p_grades jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_owner uuid; v_role text;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  select coalesce(c.teacher_id,e.created_by) into v_owner from public.exam_attempts a join public.exams e on e.id=a.exam_id left join public.courses c on c.id=e.course_id where a.id=p_attempt;
  if not public.is_admin() and not (
    (v_role='teacher' and v_owner=auth.uid())
    or (v_role='essay_grader' and (
      not exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid())
      or exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid() and teacher_id=v_owner)
    ))
  ) then raise exception 'not allowed' using errcode='42501'; end if;
  return public.admin_grade_exam_essays_core(p_attempt,p_grades);
end; $$;

create or replace function public.list_exam_retry_candidates()
returns json language plpgsql security definer stable set search_path=public as $$
declare v_role text;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if v_role is null or v_role not in ('admin','teacher','essay_grader') then raise exception 'not allowed' using errcode='42501'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'attempt_id',a.id,'exam_id',e.id,'exam_title',a.exam_title,'course_title',c.title,
      'student_id',a.user_id,'student_name',p.full_name,'student_grade',p.grade,
      'submitted_at',a.submitted_at,'percent',a.percent
    ) order by a.submitted_at desc)
    from public.exam_attempts a
    join public.exams e on e.id=a.exam_id
    left join public.courses c on c.id=e.course_id
    join public.profiles p on p.id=a.user_id
    where a.submitted_at is not null and a.passed is false and not a.essay_pending and (
      v_role='admin'
      or (v_role='teacher' and c.teacher_id=auth.uid())
      or (v_role='essay_grader' and (
        not exists(select 1 from public.teacher_exam_graders g0 where g0.grader_id=auth.uid())
        or exists(select 1 from public.teacher_exam_graders g where g.grader_id=auth.uid() and g.teacher_id=coalesce(c.teacher_id,e.created_by))
      ))
    )
  ),'[]'::json);
end; $$;

create or replace function public.allow_exam_retry(p_attempt uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_role text; v_attempt public.exam_attempts%rowtype; v_exam public.exams%rowtype; v_owner uuid;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if v_role is null or v_role not in ('admin','teacher','essay_grader') then raise exception 'not allowed' using errcode='42501'; end if;
  select * into v_attempt from public.exam_attempts where id=p_attempt for update;
  if not found or v_attempt.submitted_at is null or v_attempt.passed is distinct from false or v_attempt.essay_pending then
    raise exception 'attempt_not_retryable' using errcode='22023';
  end if;
  if v_attempt.exam_id is null then raise exception 'exam_not_found' using errcode='P0002'; end if;
  select * into v_exam from public.exams where id=v_attempt.exam_id;
  select coalesce(c.teacher_id,v_exam.created_by) into v_owner from public.courses c where c.id=v_exam.course_id;
  v_owner:=coalesce(v_owner,v_exam.created_by);
  if v_role='teacher' and not exists(select 1 from public.courses c where c.id=v_exam.course_id and c.teacher_id=auth.uid()) then
    raise exception 'not_allowed' using errcode='42501';
  elsif v_role='essay_grader' and exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid())
      and not exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid() and teacher_id=v_owner) then
    raise exception 'not_allowed' using errcode='42501';
  end if;

  insert into public.exam_attempt_retries(old_attempt_id,exam_id,user_id,exam_title,previous_percent,previous_passed,granted_by)
  values(v_attempt.id,v_attempt.exam_id,v_attempt.user_id,v_attempt.exam_title,v_attempt.percent,false,auth.uid());
  delete from public.exam_attempt_details where attempt_id=v_attempt.id;
  delete from public.exam_attempts where id=v_attempt.id;
end; $$;

revoke all on function public.list_exam_retry_candidates() from public,anon;
revoke all on function public.allow_exam_retry(uuid) from public,anon;
grant execute on function public.list_exam_retry_candidates() to authenticated;
grant execute on function public.allow_exam_retry(uuid) to authenticated;
grant execute on function public.grader_list_essay_attempts() to authenticated;
grant execute on function public.admin_get_essay_attempt(uuid) to authenticated;
grant execute on function public.admin_grade_exam_essays(uuid,jsonb) to authenticated;
