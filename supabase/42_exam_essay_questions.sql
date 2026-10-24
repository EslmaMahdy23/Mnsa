-- Manual essay-question grading for exams. Run in Supabase SQL Editor after 41_forum_images.sql.

alter table public.exam_questions
  add column if not exists question_type text not null default 'choice';
alter table public.exam_questions drop constraint if exists exam_questions_question_type_check;
alter table public.exam_questions add constraint exam_questions_question_type_check
  check (question_type in ('choice', 'essay'));

alter table public.exam_attempts add column if not exists essay_pending boolean not null default false;
alter table public.exam_attempt_details add column if not exists mcq_score int not null default 0;
alter table public.exam_attempt_details add column if not exists essay_answers jsonb not null default '{}'::jsonb;
alter table public.exam_attempt_details add column if not exists essay_grades jsonb not null default '{}'::jsonb;

-- Earned essay marks may use half-point increments.
alter table public.exam_questions alter column points type numeric(7,2) using points::numeric(7,2);
alter table public.exams alter column total_points type numeric(9,2) using total_points::numeric(9,2);
alter table public.exam_attempts alter column score type numeric(9,2) using score::numeric(9,2);
alter table public.exam_attempts alter column total type numeric(9,2) using total::numeric(9,2);
alter table public.exam_attempt_details alter column mcq_score type numeric(9,2) using mcq_score::numeric(9,2);

alter table public.student_notifications drop constraint if exists student_notifications_source_type_check;
alter table public.student_notifications add constraint student_notifications_source_type_check
  check (source_type in ('course','exam','lecture_schedule','admin_broadcast','forum_answer','exam_essay_review'));

create or replace function public.start_exam(p_exam uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_exam public.exams%rowtype; v_att public.exam_attempts%rowtype;
begin
  if v_user is null then raise exception 'not authenticated' using errcode='28000'; end if;
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

create or replace function public.admin_save_exam(p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_title text := trim(coalesce(p_data->>'title',''));
  v_desc text := nullif(trim(coalesce(p_data->>'description','')),'');
  v_qs jsonb := coalesce(p_data->'questions','[]'::jsonb);
  v_pub boolean := coalesce((p_data->>'is_published')::boolean,false);
  v_course uuid := nullif(p_data->>'course_id','')::uuid;
  v_grade smallint := nullif(p_data->>'grade','')::smallint;
  v_dur int := nullif(p_data->>'duration_minutes','')::int;
  v_pass int := coalesce(nullif(p_data->>'pass_percent','')::int,50);
  v_review text := coalesce(nullif(p_data->>'review_mode',''),'none');
  v_section uuid := nullif(p_data->>'section_id','')::uuid;
  v_old_sec uuid;
  v_pos int := 0;
  v_count int;
  v_points int;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  if char_length(v_title)<3 then raise exception 'bad title' using errcode='22023'; end if;
  if v_review not in ('none','marks','full') then raise exception 'bad review mode' using errcode='22023'; end if;
  if jsonb_typeof(v_qs)<>'array' or jsonb_array_length(v_qs)>200 then raise exception 'bad questions' using errcode='22023'; end if;
  if v_pub and jsonb_array_length(v_qs)=0 then raise exception 'no questions' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(v_qs) as q(val) where coalesce(q.val->>'question_type','choice') not in ('choice','essay')) then
    raise exception 'bad question type' using errcode='22023';
  end if;
  if v_id is not null then
    select section_id into v_old_sec from public.exams where id=v_id;
    if not found then raise exception 'exam not found' using errcode='P0002'; end if;
    if not (p_data ? 'section_id') then v_section:=v_old_sec; end if;
  end if;
  if v_section is not null and (v_course is null or not exists(select 1 from public.course_sections where id=v_section and course_id=v_course)) then
    raise exception 'section does not belong to course' using errcode='22023';
  end if;
  if v_section is not null and (v_id is null or v_section is distinct from v_old_sec) then
    select greatest(coalesce((select max(position) from public.lessons where section_id=v_section),0),coalesce((select max(position) from public.exams where section_id=v_section),0))+1 into v_pos;
  end if;
  if v_id is null then
    insert into public.exams(title,description,course_id,grade,duration_minutes,pass_percent,is_published,created_by,section_id,position,review_mode)
    values(v_title,v_desc,v_course,v_grade,v_dur,v_pass,v_pub,auth.uid(),v_section,v_pos,v_review) returning id into v_id;
  else
    update public.exams set title=v_title,description=v_desc,course_id=v_course,grade=v_grade,duration_minutes=v_dur,pass_percent=v_pass,
      is_published=v_pub,section_id=v_section,review_mode=v_review,
      position=case when v_section is not distinct from v_old_sec then exams.position else v_pos end where id=v_id;
  end if;
  delete from public.exam_questions where exam_id=v_id;
  insert into public.exam_questions(exam_id,position,body,options,correct_index,points,explanation,question_type)
  select v_id,q.ord::int,trim(q.val->>'body'),
    case when coalesce(q.val->>'question_type','choice')='essay' then array['','']::text[] else array(select jsonb_array_elements_text(q.val->'options')) end,
    case when coalesce(q.val->>'question_type','choice')='essay' then 0 else coalesce((q.val->>'correct_index')::int,0) end,
    coalesce(nullif(q.val->>'points','')::int,1),nullif(trim(coalesce(q.val->>'explanation','')),''),coalesce(q.val->>'question_type','choice')
  from jsonb_array_elements(v_qs) with ordinality q(val,ord);
  select count(*),coalesce(sum(points),0) into v_count,v_points from public.exam_questions where exam_id=v_id;
  update public.exams set question_count=v_count,total_points=v_points where id=v_id;
  return v_id;
end;
$$;

create or replace function public.submit_exam(p_attempt uuid,p_answers jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_att public.exam_attempts%rowtype; v_exam public.exams%rowtype;
  v_late boolean; v_ans jsonb:=case when jsonb_typeof(p_answers)='object' then p_answers else '{}'::jsonb end;
  v_score int; v_total int; v_pct int; v_pass boolean; v_has_essay boolean;
begin
  if v_user is null then raise exception 'not authenticated' using errcode='28000'; end if;
  select * into v_att from public.exam_attempts where id=p_attempt and user_id=v_user for update;
  if not found then raise exception 'attempt not found' using errcode='P0002'; end if;
  if v_att.submitted_at is not null then raise exception 'already submitted' using errcode='23505'; end if;
  select * into v_exam from public.exams where id=v_att.exam_id;
  if not found then raise exception 'exam not found' using errcode='P0002'; end if;
  v_late:=v_exam.duration_minutes is not null and now()>v_att.started_at+make_interval(mins=>v_exam.duration_minutes)+interval '2 minutes';
  select exists(select 1 from public.exam_questions where exam_id=v_exam.id and question_type='essay') into v_has_essay;
  select coalesce(sum(points),0),
         coalesce(sum(case when not v_late and question_type<>'essay' and (v_ans->>id::text)=correct_index::text then points else 0 end),0)
    into v_total,v_score from public.exam_questions where exam_id=v_exam.id;
  update public.exam_attempts set submitted_at=now(),essay_pending=(v_has_essay and not v_late),
    score=case when v_has_essay and not v_late then null else v_score end,
    total=case when v_has_essay and not v_late then null else v_total end,
    percent=case when v_has_essay and not v_late then null else case when v_total=0 then 0 else round(v_score*100.0/v_total)::int end end,
    passed=case when v_has_essay and not v_late then null else (case when v_total=0 then 0 else round(v_score*100.0/v_total)::int end)>=v_exam.pass_percent end
    where id=v_att.id;
  insert into public.exam_attempt_details(attempt_id,answers,snapshot,mcq_score,essay_answers)
  select v_att.id,
    case when v_late then '{}'::jsonb else coalesce((select jsonb_object_agg(q.id::text,to_jsonb((v_ans->>q.id::text)::int)) from public.exam_questions q where q.exam_id=v_exam.id and q.question_type='choice' and (v_ans->>q.id::text)~'^(0|[1-9][0-9]{0,2})$'),'{}'::jsonb) end,
    coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'body',q.body,'question_type',q.question_type,'options',to_jsonb(q.options),'correct_index',q.correct_index,'points',q.points,'explanation',q.explanation) order by q.position) from public.exam_questions q where q.exam_id=v_exam.id),'[]'::jsonb),
    v_score,
    case when v_late then '{}'::jsonb else coalesce((select jsonb_object_agg(q.id::text,to_jsonb(v_ans->>q.id::text)) from public.exam_questions q where q.exam_id=v_exam.id and q.question_type='essay' and nullif(trim(v_ans->>q.id::text),'') is not null),'{}'::jsonb) end
  on conflict(attempt_id) do nothing;
  return json_build_object('score',case when v_has_essay and not v_late then null else v_score end,
    'total',case when v_has_essay and not v_late then null else v_total end,
    'percent',case when v_has_essay and not v_late then null else case when v_total=0 then 0 else round(v_score*100.0/v_total)::int end end,
    'passed',case when v_has_essay and not v_late then null else (case when v_total=0 then 0 else round(v_score*100.0/v_total)::int end)>=v_exam.pass_percent end,
    'late',v_late,'essay_pending',v_has_essay and not v_late);
end;
$$;

create or replace function public.admin_get_essay_attempt(p_attempt uuid)
returns json language plpgsql security definer stable set search_path=public as $$
declare v_data json;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  select json_build_object('attempt_id',a.id,'exam_title',a.exam_title,'student_name',p.full_name,'questions',coalesce((
    select json_agg(json_build_object('id',q.val->>'id','body',q.val->>'body','points',(q.val->>'points')::numeric,'answer',d.essay_answers->>(q.val->>'id'),'grade',d.essay_grades->(q.val->>'id')) order by q.ord)
    from public.exam_attempt_details d,jsonb_array_elements(d.snapshot) with ordinality q(val,ord)
    where d.attempt_id=a.id and q.val->>'question_type'='essay'
  ),'[]'::json)) into v_data from public.exam_attempts a join public.profiles p on p.id=a.user_id
  where a.id=p_attempt and a.submitted_at is not null and a.essay_pending;
  if v_data is null then raise exception 'essay attempt not found or already graded' using errcode='P0002'; end if;
  return v_data;
end;
$$;

create or replace function public.admin_grade_exam_essays(p_attempt uuid,p_grades jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare v_att public.exam_attempts%rowtype; v_det public.exam_attempt_details%rowtype; v_exam public.exams%rowtype;
  v_q jsonb; v_grade jsonb; v_total numeric(9,2); v_score numeric(9,2); v_pct int; v_pass boolean; v_final jsonb:='{}'::jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  if jsonb_typeof(p_grades)<>'array' then raise exception 'bad grades' using errcode='22023'; end if;
  select * into v_att from public.exam_attempts where id=p_attempt for update;
  if not found or not v_att.essay_pending then raise exception 'essay attempt not pending' using errcode='23505'; end if;
  select * into v_det from public.exam_attempt_details where attempt_id=p_attempt for update;
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
  v_pass:=v_pct>=v_exam.pass_percent;
  update public.exam_attempt_details set essay_grades=v_final where attempt_id=p_attempt;
  update public.exam_attempts set essay_pending=false,score=v_score,total=v_total,percent=v_pct,passed=v_pass where id=p_attempt;
  insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    values(v_att.user_id,'exam_essay_review',v_att.id,'تم تصحيح الامتحان: '||v_att.exam_title,'ظهرت درجتك بعد مراجعة الإجابات المقالية.','/dashboard/profile')
    on conflict(user_id,source_type,source_id) do update set created_at=now(),read_at=null;
  return json_build_object('score',v_score,'total',v_total,'percent',v_pct,'passed',v_pass);
end;
$$;

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

revoke all on function public.admin_save_exam(uuid,jsonb) from public,anon;
revoke all on function public.submit_exam(uuid,jsonb) from public,anon;
revoke all on function public.get_exam_review(uuid) from public,anon;
revoke all on function public.admin_get_essay_attempt(uuid) from public,anon,authenticated;
revoke all on function public.admin_grade_exam_essays(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_save_exam(uuid,jsonb) to authenticated;
grant execute on function public.submit_exam(uuid,jsonb) to authenticated;
grant execute on function public.get_exam_review(uuid) to authenticated;
grant execute on function public.admin_get_essay_attempt(uuid) to authenticated;
grant execute on function public.admin_grade_exam_essays(uuid,jsonb) to authenticated;
