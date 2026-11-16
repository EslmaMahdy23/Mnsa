-- Direct publishing for teacher owned courses. Run after the updated 61_teacher_exams.sql and 62_teacher_students.sql.
-- Also re-run the updated 61_teacher_exams.sql to enable mixed choice/essay exams.

create or replace function public.guard_course_approval()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.can_manage_course_content()
     or current_setting('app.course_review', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.approval_status := 'approved';
    new.approval_note := null;
    new.submitted_at := now();
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();
  else
    new.approval_status := 'approved';
    new.approval_note := null;
    new.submitted_at := coalesce(old.submitted_at, now());
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();
    new.teacher_id := old.teacher_id;
    new.price := old.price;
    new.show_on_home := old.show_on_home;
  end if;
  return new;
end;
$$;

create or replace function public.teacher_submit_course(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.courses
     set approval_status = 'approved', approval_note = null, submitted_at = now(),
         reviewed_at = now(), reviewed_by = auth.uid(), is_published = true
   where id = p_id and teacher_id = auth.uid();
  if not found then raise exception 'course_not_found' using errcode = 'P0002'; end if;
end;
$$;

-- Existing submissions no longer wait for staff review. Keep each course's
-- current visibility setting so the teacher still controls whether it is live.
update public.courses c
   set approval_status = 'approved', approval_note = null
 where exists (select 1 from public.profiles p where p.id = c.teacher_id and p.role = 'teacher');

-- Approve existing teacher exams that were waiting for review and make them live.
update public.exams e
   set approval_status = 'approved', approval_note = null, is_published = true
 where exists (select 1 from public.courses c where c.id = e.course_id and c.teacher_id = e.created_by)
   and e.approval_status in ('draft', 'pending', 'rejected');

-- Each teacher may invite existing accounts to grade essays in that teacher's courses.
create table if not exists public.teacher_exam_graders (
  teacher_id uuid not null references auth.users(id) on delete cascade,
  grader_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (teacher_id, grader_id), check (teacher_id <> grader_id)
);
alter table public.teacher_exam_graders enable row level security;
drop policy if exists teacher_exam_graders_owner_read on public.teacher_exam_graders;
create policy teacher_exam_graders_owner_read on public.teacher_exam_graders
  for select to authenticated using (teacher_id = auth.uid());

create or replace function public.teacher_manage_exam_grader(p_email text, p_action text default 'add')
returns json language plpgsql security definer set search_path=public,auth as $$
declare v_teacher uuid:=auth.uid(); v_grader uuid; v_email text:=lower(trim(p_email));
begin
  if not exists(select 1 from public.profiles where id=v_teacher and role='teacher') then raise exception 'not allowed' using errcode='42501'; end if;
  if lower(trim(p_action))='remove' then
    select u.id into v_grader from auth.users u where lower(u.email)=v_email;
    if v_grader is not null then delete from public.teacher_exam_graders where teacher_id=v_teacher and grader_id=v_grader; end if;
    if v_grader is not null and not exists(select 1 from public.teacher_exam_graders where grader_id=v_grader)
       and exists(select 1 from public.profiles where id=v_grader and role='essay_grader') then
      update public.profiles set role='student' where id=v_grader;
    end if;
  elsif lower(trim(p_action))='add' then
    select u.id into v_grader from auth.users u where lower(u.email)=v_email;
    if v_grader is null then raise exception 'user_not_found' using errcode='P0002'; end if;
    if v_grader=v_teacher then raise exception 'cannot_add_self' using errcode='22023'; end if;
    if not exists(select 1 from public.profiles p where p.id=v_grader and
      (p.role='student' or (p.role='essay_grader' and exists(select 1 from public.teacher_exam_graders g where g.grader_id=p.id)))) then
      raise exception 'account_not_eligible' using errcode='22023';
    end if;
    insert into public.teacher_exam_graders(teacher_id,grader_id) values(v_teacher,v_grader) on conflict do nothing;
    update public.profiles set role='essay_grader' where id=v_grader and role='student';
  elsif lower(trim(p_action))<>'list' then raise exception 'bad_action' using errcode='22023';
  end if;
  return coalesce((select json_agg(json_build_object('id',p.id,'name',p.full_name,'email',u.email) order by p.full_name)
    from public.teacher_exam_graders g join public.profiles p on p.id=g.grader_id join auth.users u on u.id=p.id
    where g.teacher_id=v_teacher),'[]'::json);
end; $$;

create or replace function public.can_grade_exam_essays()
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','essay_grader'));
$$;

create or replace function public.grader_list_essay_attempts()
returns json language plpgsql security definer stable set search_path=public as $$
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  return coalesce((select json_agg(json_build_object('id',a.id,'exam_title',a.exam_title,'student_name',p.full_name,
      'student_grade',p.grade,'submitted_at',a.submitted_at,'essay_count',(select count(*) from public.exam_attempt_details d,
        jsonb_array_elements(d.snapshot) q(val) where d.attempt_id=a.id and q.val->>'question_type'='essay')) order by a.submitted_at)
    from public.exam_attempts a join public.profiles p on p.id=a.user_id join public.exams e on e.id=a.exam_id
    where a.essay_pending and a.submitted_at is not null and (public.is_admin()
      or not exists(select 1 from public.teacher_exam_graders g0 where g0.grader_id=auth.uid())
      or exists(select 1 from public.teacher_exam_graders g where g.grader_id=auth.uid() and g.teacher_id=e.created_by))), '[]'::json);
end; $$;

do $$ begin
  if to_regprocedure('public.admin_get_essay_attempt_core(uuid)') is null then
    execute 'alter function public.admin_get_essay_attempt(uuid) rename to admin_get_essay_attempt_core';
  end if;
end $$;
create or replace function public.admin_get_essay_attempt(p_attempt uuid) returns json
language plpgsql security definer set search_path=public as $$
declare v_owner uuid; v_data json;
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  select e.created_by into v_owner from public.exam_attempts a join public.exams e on e.id=a.exam_id where a.id=p_attempt;
  if not public.is_admin() and exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid())
     and not exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid() and teacher_id=v_owner)
    then raise exception 'not allowed' using errcode='42501'; end if;
  return public.admin_get_essay_attempt_core(p_attempt);
end; $$;

do $$ begin
  if to_regprocedure('public.admin_grade_exam_essays_core(uuid,jsonb)') is null then
    execute 'alter function public.admin_grade_exam_essays(uuid,jsonb) rename to admin_grade_exam_essays_core';
  end if;
end $$;
create or replace function public.admin_grade_exam_essays(p_attempt uuid,p_grades jsonb) returns json
language plpgsql security definer set search_path=public as $$
declare v_owner uuid;
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  select e.created_by into v_owner from public.exam_attempts a join public.exams e on e.id=a.exam_id where a.id=p_attempt;
  if not public.is_admin() and exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid())
     and not exists(select 1 from public.teacher_exam_graders where grader_id=auth.uid() and teacher_id=v_owner)
    then raise exception 'not allowed' using errcode='42501'; end if;
  return public.admin_grade_exam_essays_core(p_attempt,p_grades);
end; $$;

revoke all on function public.admin_get_essay_attempt_core(uuid) from public,anon,authenticated;
revoke all on function public.admin_grade_exam_essays_core(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.admin_get_essay_attempt(uuid) from public,anon;
revoke all on function public.admin_grade_exam_essays(uuid,jsonb) from public,anon;
revoke all on function public.teacher_manage_exam_grader(text,text) from public,anon;
grant execute on function public.teacher_manage_exam_grader(text,text) to authenticated;
grant execute on function public.admin_get_essay_attempt(uuid) to authenticated;
grant execute on function public.admin_grade_exam_essays(uuid,jsonb) to authenticated;

