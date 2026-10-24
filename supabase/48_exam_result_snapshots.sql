-- Preserve result-review settings when an exam is deleted. Run after 47_support_agent_role.sql.

alter table public.exam_attempts
  add column if not exists review_mode_snapshot text not null default 'none',
  add column if not exists pass_percent_snapshot int not null default 50;

alter table public.exam_attempts drop constraint if exists exam_attempts_review_mode_snapshot_check;
alter table public.exam_attempts add constraint exam_attempts_review_mode_snapshot_check
  check (review_mode_snapshot in ('none','marks','full'));

-- Backfill settings for exams that still exist. The exam_id foreign key already uses ON DELETE SET NULL,
-- so attempts and their answer snapshots remain attached to the student after exam deletion.
update public.exam_attempts a
set review_mode_snapshot=coalesce(e.review_mode,'none'),
    pass_percent_snapshot=coalesce(e.pass_percent,50)
from public.exams e
where e.id=a.exam_id;

create or replace function public.capture_exam_attempt_settings()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.submitted_at is null and new.submitted_at is not null and new.exam_id is not null then
    select coalesce(e.review_mode,'none'),coalesce(e.pass_percent,50)
      into new.review_mode_snapshot,new.pass_percent_snapshot
      from public.exams e where e.id=new.exam_id;
  end if;
  return new;
end;
$$;

drop trigger if exists exam_attempts_capture_settings on public.exam_attempts;
create trigger exam_attempts_capture_settings
  before update of submitted_at on public.exam_attempts
  for each row execute function public.capture_exam_attempt_settings();

create or replace function public.preserve_exam_attempt_settings_before_delete()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.exam_attempts
  set review_mode_snapshot=coalesce(old.review_mode,'none'),
      pass_percent_snapshot=coalesce(old.pass_percent,50)
  where exam_id=old.id;
  return old;
end;
$$;

drop trigger if exists exams_preserve_attempt_settings on public.exams;
create trigger exams_preserve_attempt_settings
  before delete on public.exams
  for each row execute function public.preserve_exam_attempt_settings_before_delete();

create or replace function public.get_exam_review(p_attempt uuid)
returns json language plpgsql security definer stable set search_path=public as $$
declare
  v_user uuid:=auth.uid();
  v_att public.exam_attempts%rowtype;
  v_exam public.exams%rowtype;
  v_det public.exam_attempt_details%rowtype;
  v_mode text;
begin
  if v_user is null then raise exception 'not authenticated' using errcode='28000'; end if;
  select * into v_att from public.exam_attempts where id=p_attempt and user_id=v_user;
  if not found or v_att.submitted_at is null then raise exception 'attempt not found' using errcode='P0002'; end if;
  if v_att.essay_pending then return json_build_object('mode','pending','essay_pending',true); end if;
  select * into v_exam from public.exams where id=v_att.exam_id;
  v_mode:=coalesce(v_exam.review_mode,v_att.review_mode_snapshot,'none');
  select * into v_det from public.exam_attempt_details where attempt_id=p_attempt;
  if not found then return json_build_object('mode',v_mode,'essay_pending',false,'questions','[]'::json,'essays','[]'::json); end if;
  return json_build_object('mode',v_mode,'essay_pending',false,
    'questions',case when v_mode='none' then '[]'::json else coalesce((
      select json_agg(json_build_object('body',q.val->>'body','options',q.val->'options','points',(q.val->>'points')::numeric,
        'my_index',(v_det.answers->>(q.val->>'id'))::int,
        'is_correct',coalesce((v_det.answers->>(q.val->>'id'))=(q.val->>'correct_index'),false),
        'correct_index',case when v_mode='full' then (q.val->>'correct_index')::int else null end,
        'explanation',case when v_mode='full' then q.val->>'explanation' else null end) order by q.ord)
      from jsonb_array_elements(v_det.snapshot) with ordinality q(val,ord)
      where q.val->>'question_type'='choice'
    ),'[]'::json) end,
    'essays',coalesce((
      select json_agg(json_build_object('body',q.val->>'body','answer',v_det.essay_answers->>(q.val->>'id'),
        'points',(q.val->>'points')::numeric,'score',(v_det.essay_grades->(q.val->>'id')->>'score')::numeric,
        'feedback',v_det.essay_grades->(q.val->>'id')->>'feedback') order by q.ord)
      from jsonb_array_elements(v_det.snapshot) with ordinality q(val,ord)
      where q.val->>'question_type'='essay'
    ),'[]'::json));
end;
$$;

create or replace function public.admin_grade_exam_essays(p_attempt uuid,p_grades jsonb)
returns json language plpgsql security definer set search_path=public as $$
declare
  v_att public.exam_attempts%rowtype;
  v_det public.exam_attempt_details%rowtype;
  v_exam public.exams%rowtype;
  v_q jsonb;
  v_grade jsonb;
  v_total numeric(9,2);
  v_score numeric(9,2);
  v_pct int;
  v_pass boolean;
  v_final jsonb:='{}'::jsonb;
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
    if (v_grade->>'score')::numeric<0 or (v_grade->>'score')::numeric>(v_q->>'points')::numeric then raise exception 'essay grade out of range' using errcode='22023'; end if;
    v_final:=v_final||jsonb_build_object(v_q->>'id',jsonb_build_object('score',(v_grade->>'score')::numeric,'feedback',nullif(trim(coalesce(v_grade->>'feedback','')),'')));
  end loop;
  if jsonb_array_length(p_grades)<>(select count(*) from jsonb_array_elements(v_det.snapshot) where value->>'question_type'='essay') then raise exception 'unexpected essay grade' using errcode='22023'; end if;
  select coalesce(sum((value->>'points')::numeric),0) into v_total from jsonb_array_elements(v_det.snapshot);
  select v_det.mcq_score+coalesce(sum((value->>'score')::numeric),0) into v_score from jsonb_each(v_final);
  v_pct:=case when v_total=0 then 0 else round(v_score*100.0/v_total)::int end;
  v_pass:=v_pct>=coalesce(v_exam.pass_percent,v_att.pass_percent_snapshot,50);
  update public.exam_attempt_details set essay_grades=v_final where attempt_id=p_attempt;
  update public.exam_attempts set essay_pending=false,score=v_score,total=v_total,percent=v_pct,passed=v_pass where id=p_attempt;
  insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    values(v_att.user_id,'exam_essay_review',v_att.id,'تم تصحيح الامتحان: '||v_att.exam_title,
      'ظهرت درجتك بعد مراجعة الإجابات المقالية.','/dashboard/profile')
    on conflict(user_id,source_type,source_id) do update set created_at=now(),read_at=null;
  return json_build_object('score',v_score,'total',v_total,'percent',v_pct,'passed',v_pass);
end;
$$;

revoke all on function public.capture_exam_attempt_settings() from public,anon,authenticated;
revoke all on function public.preserve_exam_attempt_settings_before_delete() from public,anon,authenticated;
revoke all on function public.get_exam_review(uuid) from public,anon;
revoke all on function public.admin_grade_exam_essays(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.get_exam_review(uuid) to authenticated;
grant execute on function public.admin_grade_exam_essays(uuid,jsonb) to authenticated;
