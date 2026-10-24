-- Restricted accounts for manual essay grading. Run after 42_exam_essay_questions.sql.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student','teacher','admin','essay_grader'));

create or replace function public.can_grade_exam_essays()
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','essay_grader'));
$$;

create or replace function public.start_exam(p_exam uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_exam public.exams%rowtype; v_att public.exam_attempts%rowtype;
begin
  if v_user is null then raise exception 'not authenticated' using errcode='28000'; end if;
  if exists(select 1 from public.profiles where id=v_user and role='essay_grader') then
    raise exception 'not allowed' using errcode='42501';
  end if;
  select * into v_exam from public.exams e where e.id=p_exam and e.is_published
    and (e.course_id is null or exists(select 1 from public.enrollments en where en.course_id=e.course_id and en.user_id=v_user));
  if not found then raise exception 'exam not available' using errcode='P0002'; end if;
  if v_exam.section_id is not null and not public.is_section_unlocked(v_exam.section_id) then raise exception 'section locked' using errcode='EH002'; end if;
  if v_exam.section_id is not null and not public.is_exam_unlocked(v_exam.id) then raise exception 'exam locked' using errcode='EH003'; end if;
  select * into v_att from public.exam_attempts where exam_id=p_exam and user_id=v_user;
  if not found then
    insert into public.exam_attempts(exam_id,exam_title,user_id) values(p_exam,v_exam.title,v_user) on conflict(exam_id,user_id) do nothing;
    select * into v_att from public.exam_attempts where exam_id=p_exam and user_id=v_user;
  end if;
  if v_att.submitted_at is not null then raise exception 'already submitted' using errcode='23505'; end if;
  if v_exam.duration_minutes is not null and now()>v_att.started_at+make_interval(mins=>v_exam.duration_minutes)+interval '2 minutes' then
    update public.exam_attempts set submitted_at=now(),score=0,total=v_exam.total_points,percent=0,passed=false where id=v_att.id;
    raise exception 'time is over' using errcode='23505';
  end if;
  return json_build_object('attempt_id',v_att.id,'title',v_exam.title,'started_at',v_att.started_at,'server_now',now(),
    'duration_minutes',v_exam.duration_minutes,'questions',coalesce((select json_agg(json_build_object('id',q.id,'body',q.body,
    'options',to_json(q.options),'points',q.points,'question_type',q.question_type) order by q.position) from public.exam_questions q where q.exam_id=v_exam.id),'[]'::json));
end;
$$;

drop function if exists public.admin_list_exam_graders();
create function public.admin_list_exam_graders()
returns table(user_id uuid,full_name text,email text,created_at timestamptz)
language plpgsql security definer stable set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  return query select p.id,p.full_name,u.email::text,p.created_at
    from public.profiles p join auth.users u on u.id=p.id where p.role='essay_grader' order by p.created_at desc;
end;
$$;

create or replace function public.admin_revoke_exam_grader(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_user=auth.uid() then raise exception 'cannot change own role' using errcode='22023'; end if;
  update public.profiles set role='student' where id=p_user and role='essay_grader';
  if not found then raise exception 'grader not found' using errcode='P0002'; end if;
end;
$$;

create or replace function public.grader_list_essay_attempts()
returns json language plpgsql security definer stable set search_path=public as $$
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  return coalesce((select json_agg(json_build_object('id',a.id,'exam_title',a.exam_title,'student_name',p.full_name,'student_grade',p.grade,
      'submitted_at',a.submitted_at,'essay_count',(select count(*) from public.exam_attempt_details d,jsonb_array_elements(d.snapshot) as q(val)
        where d.attempt_id=a.id and q.val->>'question_type'='essay'))
    order by a.submitted_at)
    from public.exam_attempts a join public.profiles p on p.id=a.user_id where a.essay_pending and a.submitted_at is not null),'[]'::json);
end;
$$;

create or replace function public.admin_get_essay_attempt(p_attempt uuid)
returns json language plpgsql security definer stable set search_path=public as $$
declare v_data json;
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  select json_build_object('attempt_id',a.id,'exam_title',a.exam_title,'student_name',p.full_name,'student_grade',p.grade,'submitted_at',a.submitted_at,'questions',coalesce((
    select json_agg(json_build_object('id',q.val->>'id','body',q.val->>'body','points',(q.val->>'points')::numeric,
      'answer',d.essay_answers->>(q.val->>'id'),'grade',d.essay_grades->(q.val->>'id')) order by q.ord)
    from public.exam_attempt_details d,jsonb_array_elements(d.snapshot) with ordinality q(val,ord)
    where d.attempt_id=a.id and q.val->>'question_type'='essay'
  ),'[]'::json)) into v_data
  from public.exam_attempts a join public.profiles p on p.id=a.user_id
  where a.id=p_attempt and a.submitted_at is not null and a.essay_pending;
  if v_data is null then raise exception 'essay attempt not found or already graded' using errcode='P0002'; end if;
  return v_data;
end;
$$;

-- Question points are numeric after migration 42 (for example, "2.00").
-- Keep review payloads numeric instead of casting their text representation to integer.
create or replace function public.get_exam_review(p_attempt uuid)
returns json language plpgsql security definer stable set search_path=public as $$
declare v_user uuid:=auth.uid(); v_att public.exam_attempts%rowtype; v_exam public.exams%rowtype; v_det public.exam_attempt_details%rowtype;
begin
  if v_user is null then raise exception 'not authenticated' using errcode='28000'; end if;
  select * into v_att from public.exam_attempts where id=p_attempt and user_id=v_user;
  if not found or v_att.submitted_at is null then raise exception 'attempt not found' using errcode='P0002'; end if;
  if v_att.essay_pending then return json_build_object('mode','pending','essay_pending',true); end if;
  select * into v_exam from public.exams where id=v_att.exam_id;
  select * into v_det from public.exam_attempt_details where attempt_id=p_attempt;
  return json_build_object('mode',coalesce(v_exam.review_mode,'none'),'essay_pending',false,
    'questions',case when coalesce(v_exam.review_mode,'none')='none' then '[]'::json else coalesce((
      select json_agg(json_build_object('body',q.val->>'body','options',q.val->'options','points',(q.val->>'points')::numeric,
        'my_index',(v_det.answers->>(q.val->>'id'))::int,'is_correct',coalesce((v_det.answers->>(q.val->>'id'))=(q.val->>'correct_index'),false),
        'correct_index',case when v_exam.review_mode='full' then (q.val->>'correct_index')::int else null end,
        'explanation',case when v_exam.review_mode='full' then q.val->>'explanation' else null end) order by q.ord)
      from jsonb_array_elements(v_det.snapshot) with ordinality q(val,ord) where q.val->>'question_type'='choice'
    ),'[]'::json) end,
    'essays',coalesce((select json_agg(json_build_object('body',q.val->>'body','answer',v_det.essay_answers->>(q.val->>'id'),
      'points',(q.val->>'points')::numeric,'score',(v_det.essay_grades->(q.val->>'id')->>'score')::numeric,
      'feedback',v_det.essay_grades->(q.val->>'id')->>'feedback') order by q.ord)
      from jsonb_array_elements(v_det.snapshot) with ordinality q(val,ord) where q.val->>'question_type'='essay'),'[]'::json));
end;
$$;

create or replace function public.admin_grade_exam_essays(p_attempt uuid,p_grades jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare
  v_att public.exam_attempts%rowtype; v_det public.exam_attempt_details%rowtype; v_exam public.exams%rowtype;
  v_q jsonb; v_grade jsonb; v_total numeric(9,2); v_score numeric(9,2); v_pct int; v_pass boolean; v_final jsonb:='{}'::jsonb;
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  if jsonb_typeof(p_grades)<>'array' then raise exception 'bad grades' using errcode='22023'; end if;
  select * into v_att from public.exam_attempts where id=p_attempt for update;
  if not found or not v_att.essay_pending then raise exception 'essay attempt not pending' using errcode='23505'; end if;
  select * into v_det from public.exam_attempt_details where attempt_id=p_attempt for update;
  select * into v_exam from public.exams where id=v_att.exam_id;
  for v_q in select value from jsonb_array_elements(v_det.snapshot) where value->>'question_type'='essay' loop
    select value into v_grade from jsonb_array_elements(p_grades) where value->>'id'=v_q->>'id' limit 1;
    if v_grade is null or (v_grade->>'score') !~ '^\d+(\.5)?$' then raise exception 'missing or invalid essay grade' using errcode='22023'; end if;
    if (v_grade->>'score')::numeric<0 or (v_grade->>'score')::numeric>(v_q->>'points')::numeric then raise exception 'essay grade out of range' using errcode='22023'; end if;
    v_final:=v_final||jsonb_build_object(v_q->>'id',jsonb_build_object('score',(v_grade->>'score')::numeric,'feedback',nullif(trim(coalesce(v_grade->>'feedback','')),'')));
  end loop;
  if jsonb_array_length(p_grades)<>(select count(*) from jsonb_array_elements(v_det.snapshot) where value->>'question_type'='essay') then
    raise exception 'unexpected essay grade' using errcode='22023';
  end if;
  select coalesce(sum((value->>'points')::numeric),0) into v_total from jsonb_array_elements(v_det.snapshot);
  select v_det.mcq_score+coalesce(sum((value->>'score')::numeric),0) into v_score from jsonb_each(v_final);
  v_pct:=case when v_total=0 then 0 else round(v_score*100.0/v_total)::int end;
  v_pass:=v_pct>=v_exam.pass_percent;
  update public.exam_attempt_details set essay_grades=v_final where attempt_id=p_attempt;
  update public.exam_attempts set essay_pending=false,score=v_score,total=v_total,percent=v_pct,passed=v_pass where id=p_attempt;
  insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    values(v_att.user_id,'exam_essay_review',v_att.id,'تم تصحيح الامتحان: '||v_att.exam_title,
      'ظهرت درجتك بعد مراجعة الإجابات المقالية.','/dashboard/profile')
    on conflict(user_id,source_type,source_id) do update set created_at=now(),read_at=null;
  return json_build_object('score',v_score,'total',v_total,'percent',v_pct,'passed',v_pass);
end;
$$;

revoke all on function public.can_grade_exam_essays() from public,anon;
revoke all on function public.admin_list_exam_graders() from public,anon;
revoke all on function public.admin_revoke_exam_grader(uuid) from public,anon;
revoke all on function public.grader_list_essay_attempts() from public,anon;
revoke all on function public.admin_get_essay_attempt(uuid) from public,anon;
revoke all on function public.admin_grade_exam_essays(uuid,jsonb) from public,anon;
grant execute on function public.can_grade_exam_essays() to authenticated;
grant execute on function public.admin_list_exam_graders() to authenticated;
grant execute on function public.admin_revoke_exam_grader(uuid) to authenticated;
grant execute on function public.grader_list_essay_attempts() to authenticated;
grant execute on function public.admin_get_essay_attempt(uuid) to authenticated;
grant execute on function public.admin_grade_exam_essays(uuid,jsonb) to authenticated;
grant execute on function public.get_exam_review(uuid) to authenticated;
