-- Add a content manager role. Run after 43_exam_grader_role.sql.
-- Content managers can create and maintain course content, but cannot manage users,
-- enrollments, attempts, billing, or other admin features.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student','teacher','admin','essay_grader','course_manager'));

create or replace function public.can_manage_course_content()
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','course_manager'));
$$;

-- Managers may see and maintain course catalog entries, but cannot delete courses.
drop policy if exists "courses read" on public.courses;
create policy "courses read" on public.courses for select
  using (is_published or teacher_id=(select auth.uid()) or (select public.can_manage_course_content()));

drop policy if exists "courses insert" on public.courses;
create policy "courses insert" on public.courses for insert
  with check (
    (public.can_manage_course_content() and exists(select 1 from public.profiles t where t.id=teacher_id and t.role in ('teacher','admin')))
    or (teacher_id=(select auth.uid()) and public.is_teacher())
  );

drop policy if exists "courses update" on public.courses;
create policy "courses update" on public.courses for update
  using (teacher_id=(select auth.uid()) or (select public.can_manage_course_content()))
  with check (
    (public.can_manage_course_content() and exists(select 1 from public.profiles t where t.id=teacher_id and t.role in ('teacher','admin')))
    or (teacher_id=(select auth.uid()) and public.is_teacher())
  );

-- Sections and lesson records are maintained inside a course.
drop policy if exists "sections read" on public.course_sections;
create policy "sections read" on public.course_sections for select
  using (exists(select 1 from public.courses c where c.id=course_sections.course_id
    and (c.is_published or c.teacher_id=(select auth.uid()) or (select public.can_manage_course_content()))));

drop policy if exists "sections write" on public.course_sections;
create policy "sections write" on public.course_sections for all
  using (exists(select 1 from public.courses c where c.id=course_sections.course_id
    and (c.teacher_id=(select auth.uid()) or (select public.can_manage_course_content()))))
  with check (exists(select 1 from public.courses c where c.id=course_sections.course_id
    and (c.teacher_id=(select auth.uid()) or (select public.can_manage_course_content()))));

drop policy if exists "lessons read" on public.lessons;
create policy "lessons read" on public.lessons for select
  using (exists(
    select 1 from public.courses c where c.id=lessons.course_id and (
      c.teacher_id=(select auth.uid()) or (select public.can_manage_course_content())
      or (c.is_published and (lessons.is_free_preview or (
        exists(select 1 from public.enrollments e where e.course_id=c.id and e.user_id=(select auth.uid()))
        and public.is_section_unlocked(lessons.section_id)
      )))
    )
  ));

drop policy if exists "lessons write" on public.lessons;
create policy "lessons write" on public.lessons for all
  using (exists(select 1 from public.courses c where c.id=lessons.course_id
    and (c.teacher_id=(select auth.uid()) or (select public.can_manage_course_content()))))
  with check (exists(select 1 from public.courses c where c.id=lessons.course_id
    and (c.teacher_id=(select auth.uid()) or (select public.can_manage_course_content()))));

-- Managers can open course exams and edit their questions, but can't access attempts.
drop policy if exists "exams read" on public.exams;
create policy "exams read" on public.exams for select
  using ((select public.is_admin()) or (course_id is not null and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='course_manager')) or (is_published and (
    course_id is null or exists(select 1 from public.enrollments e where e.course_id=exams.course_id and e.user_id=(select auth.uid()))
  )));

drop policy if exists "exams update" on public.exams;
create policy "exams update" on public.exams for update
  using ((select public.is_admin()) or (course_id is not null and exists(
    select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='course_manager'
  )))
  with check ((select public.is_admin()) or (course_id is not null and exists(
    select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='course_manager'
  )));

drop policy if exists "questions admin read" on public.exam_questions;
create policy "questions admin read" on public.exam_questions for select
  using ((select public.is_admin()) or (
    exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='course_manager')
    and exists(select 1 from public.exams e where e.id=exam_questions.exam_id and e.course_id is not null)
  ));

-- Save exam/question bundles through the existing validated admin RPC.
create or replace function public.admin_save_exam(p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_id uuid:=p_id;
  v_title text:=trim(coalesce(p_data->>'title',''));
  v_desc text:=nullif(trim(coalesce(p_data->>'description','')),'');
  v_qs jsonb:=coalesce(p_data->'questions','[]'::jsonb);
  v_pub boolean:=coalesce((p_data->>'is_published')::boolean,false);
  v_course uuid:=nullif(p_data->>'course_id','')::uuid;
  v_grade smallint:=nullif(p_data->>'grade','')::smallint;
  v_dur int:=nullif(p_data->>'duration_minutes','')::int;
  v_pass int:=coalesce(nullif(p_data->>'pass_percent','')::int,50);
  v_review text:=coalesce(nullif(p_data->>'review_mode',''),'none');
  v_section uuid:=nullif(p_data->>'section_id','')::uuid;
  v_old_sec uuid;
  v_old_course uuid;
  v_pos int:=0;
  v_count int;
  v_points numeric;
begin
  if not public.can_manage_course_content() then raise exception 'not allowed' using errcode='42501'; end if;
  if char_length(v_title)<3 then raise exception 'bad title' using errcode='22023'; end if;
  if v_review not in ('none','marks','full') then raise exception 'bad review mode' using errcode='22023'; end if;
  if jsonb_typeof(v_qs)<>'array' or jsonb_array_length(v_qs)>200 then raise exception 'bad questions' using errcode='22023'; end if;
  if v_pub and jsonb_array_length(v_qs)=0 then raise exception 'no questions' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(v_qs) q(val) where coalesce(q.val->>'question_type','choice') not in ('choice','essay')) then
    raise exception 'bad question type' using errcode='22023';
  end if;
  if v_id is not null then
    select section_id,course_id into v_old_sec,v_old_course from public.exams where id=v_id;
    if not found then raise exception 'exam not found' using errcode='P0002'; end if;
    if not (p_data ? 'section_id') then v_section:=v_old_sec; end if;
    if exists(select 1 from public.profiles where id=auth.uid() and role='course_manager') and v_old_course is null then
      raise exception 'course manager can only edit course exams' using errcode='42501';
    end if;
  end if;
  if exists(select 1 from public.profiles where id=auth.uid() and role='course_manager') and v_course is null then
    raise exception 'course manager must attach exam to a course' using errcode='22023';
  end if;
  if v_section is not null and (v_course is null or not exists(select 1 from public.course_sections where id=v_section and course_id=v_course)) then
    raise exception 'section does not belong to course' using errcode='22023';
  end if;
  if v_section is not null and (v_id is null or v_section is distinct from v_old_sec) then
    select greatest(coalesce((select max(position) from public.lessons where section_id=v_section),0),
      coalesce((select max(position) from public.exams where section_id=v_section),0))+1 into v_pos;
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

revoke all on function public.can_manage_course_content() from public,anon;
grant execute on function public.can_manage_course_content() to authenticated;
revoke all on function public.admin_save_exam(uuid,jsonb) from public,anon;
grant execute on function public.admin_save_exam(uuid,jsonb) to authenticated;

-- Course managers can upload/edit course covers and PDFs in the existing buckets.
drop policy if exists "course covers upload" on storage.objects;
create policy "course covers upload" on storage.objects for insert to authenticated
  with check (bucket_id='course-covers' and (public.is_teacher() or public.can_manage_course_content()));
drop policy if exists "course covers update" on storage.objects;
create policy "course covers update" on storage.objects for update to authenticated
  using (bucket_id='course-covers' and (public.is_teacher() or public.can_manage_course_content()));
drop policy if exists "course covers delete" on storage.objects;
create policy "course covers delete" on storage.objects for delete to authenticated
  using (bucket_id='course-covers' and (public.is_teacher() or public.can_manage_course_content()));

drop policy if exists "course pdf upload by owner" on storage.objects;
create policy "course pdf upload by owner" on storage.objects for insert to authenticated
  with check (bucket_id='course-pdfs' and exists(select 1 from public.courses c
    where c.id::text=(storage.foldername(name))[1] and (c.teacher_id=(select auth.uid()) or (select public.can_manage_course_content()))));

-- Staff account list/revocation covers all delegated roles, without exposing other roles.
drop function if exists public.admin_list_staff();
create function public.admin_list_staff()
returns table(user_id uuid,full_name text,email text,role text,created_at timestamptz)
language plpgsql security definer stable set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  return query select p.id,p.full_name,u.email::text,p.role,p.created_at from public.profiles p join auth.users u on u.id=p.id
    where p.role in ('essay_grader','course_manager') order by p.created_at desc;
end;
$$;

create or replace function public.admin_revoke_staff(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_user=auth.uid() then raise exception 'cannot change own role' using errcode='22023'; end if;
  update public.profiles set role='student' where id=p_user and role in ('essay_grader','course_manager');
  if not found then raise exception 'staff account not found' using errcode='P0002'; end if;
end;
$$;

revoke all on function public.admin_list_staff() from public,anon;
revoke all on function public.admin_revoke_staff(uuid) from public,anon;
grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_revoke_staff(uuid) to authenticated;

-- Include the identifying context on the grader queue and review modal.
create or replace function public.grader_list_essay_attempts()
returns json language plpgsql security definer stable set search_path=public as $$
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  return coalesce((select json_agg(json_build_object('id',a.id,'exam_title',a.exam_title,'student_name',p.full_name,
      'student_grade',p.grade,'submitted_at',a.submitted_at,'essay_count',(select count(*) from public.exam_attempt_details d,
        jsonb_array_elements(d.snapshot) as q(val) where d.attempt_id=a.id and q.val->>'question_type'='essay')) order by a.submitted_at)
    from public.exam_attempts a join public.profiles p on p.id=a.user_id where a.essay_pending and a.submitted_at is not null),'[]'::json);
end;
$$;

create or replace function public.admin_get_essay_attempt(p_attempt uuid)
returns json language plpgsql security definer stable set search_path=public as $$
declare v_data json;
begin
  if not public.can_grade_exam_essays() then raise exception 'not allowed' using errcode='42501'; end if;
  select json_build_object('attempt_id',a.id,'exam_title',a.exam_title,'student_name',p.full_name,'student_grade',p.grade,
    'submitted_at',a.submitted_at,'questions',coalesce((
      select json_agg(json_build_object('id',q.val->>'id','body',q.val->>'body','points',(q.val->>'points')::numeric,
        'answer',d.essay_answers->>(q.val->>'id'),'grade',d.essay_grades->(q.val->>'id')) order by q.ord)
      from public.exam_attempt_details d,jsonb_array_elements(d.snapshot) with ordinality q(val,ord)
      where d.attempt_id=a.id and q.val->>'question_type'='essay'
    ),'[]'::json)) into v_data from public.exam_attempts a join public.profiles p on p.id=a.user_id
  where a.id=p_attempt and a.submitted_at is not null and a.essay_pending;
  if v_data is null then raise exception 'essay attempt not found or already graded' using errcode='P0002'; end if;
  return v_data;
end;
$$;
