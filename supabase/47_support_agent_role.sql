-- Restricted support accounts. Run after 46_course_notifications_audience.sql.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student','teacher','admin','essay_grader','course_manager','forum_moderator','payment_manager','support_agent'));

create or replace function public.can_manage_support_tickets()
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','support_agent'));
$$;

create or replace function public.can_access_support_ticket(p_ticket_id uuid)
returns boolean language sql security definer stable set search_path=public as $$
  select auth.uid() is not null and (
    public.can_manage_support_tickets()
    or exists(select 1 from public.support_tickets where id=p_ticket_id and user_id=auth.uid())
  );
$$;

create or replace function public.get_support_messages(p_ticket_id uuid)
returns json language plpgsql security definer stable set search_path=public as $$
begin
  if not public.can_access_support_ticket(p_ticket_id) then raise exception 'not allowed' using errcode='42501'; end if;
  return coalesce((
    select json_agg(row_to_json(m) order by m.created_at)
    from (
      select sm.id,sm.sender_id,sm.sender_role,sm.body,sm.attachment_path,sm.created_at,
        case when sm.sender_role='admin' then 'فريق الدعم' else coalesce(p.full_name,'الطالب') end as sender_name
      from public.support_messages sm left join public.profiles p on p.id=sm.sender_id
      where sm.ticket_id=p_ticket_id
    ) m
  ),'[]'::json);
end;
$$;

create or replace function public.create_support_ticket(p_subject text,p_message text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_ticket_id uuid;
begin
  if auth.uid() is null or exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','support_agent')) then
    raise exception 'not allowed' using errcode='42501';
  end if;
  if p_subject is null or length(trim(p_subject)) not between 1 and 120
     or p_message is null or length(trim(p_message)) not between 1 and 2000 then
    raise exception 'bad ticket content' using errcode='22023';
  end if;
  insert into public.support_tickets(user_id,subject) values(auth.uid(),trim(p_subject)) returning id into v_ticket_id;
  insert into public.support_messages(ticket_id,sender_id,sender_role,body) values(v_ticket_id,auth.uid(),'student',trim(p_message));
  return v_ticket_id;
end;
$$;

create or replace function public.reply_support_ticket(p_ticket_id uuid,p_message text,p_attachment_path text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_prefix text;
begin
  if auth.uid() is null or exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','support_agent')) then
    raise exception 'not allowed' using errcode='42501';
  end if;
  if p_message is null or length(trim(p_message)) not between 1 and 2000 then raise exception 'bad message' using errcode='22023'; end if;
  if p_attachment_path is not null then
    v_prefix:=p_ticket_id::text||'/'||auth.uid()::text||'/';
    if left(p_attachment_path,length(v_prefix))<>v_prefix or length(p_attachment_path)>400
       or position('/' in substring(p_attachment_path from length(v_prefix)+1))>0
       or p_attachment_path !~* '[.](jpg|jpeg|png|webp|gif)$' then raise exception 'bad attachment path' using errcode='22023'; end if;
  end if;
  update public.support_tickets set status='waiting_admin',updated_at=now()
    where id=p_ticket_id and user_id=auth.uid() and status<>'closed';
  if not found then raise exception 'ticket unavailable' using errcode='42501'; end if;
  insert into public.support_messages(ticket_id,sender_id,sender_role,body,attachment_path)
    values(p_ticket_id,auth.uid(),'student',trim(p_message),p_attachment_path);
end;
$$;

create or replace function public.admin_get_support_tickets(p_status text default null)
returns json language plpgsql security definer stable set search_path=public as $$
begin
  if not public.can_manage_support_tickets() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('waiting_admin','waiting_student','closed') then raise exception 'bad status' using errcode='22023'; end if;
  return coalesce((
    select json_agg(row_to_json(t) order by t.updated_at desc)
    from (
      select st.id,st.user_id,st.subject,st.status,st.created_at,st.updated_at,
        coalesce(p.full_name,'طالب') as student_name,u.email as student_email,
        (select sm.body from public.support_messages sm where sm.ticket_id=st.id order by sm.created_at desc limit 1) as last_message
      from public.support_tickets st left join public.profiles p on p.id=st.user_id left join auth.users u on u.id=st.user_id
      where p_status is null or st.status=p_status
    ) t
  ),'[]'::json);
end;
$$;

create or replace function public.admin_reply_support_ticket(p_ticket_id uuid,p_message text,p_attachment_path text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_prefix text;
begin
  if not public.can_manage_support_tickets() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_message is null or length(trim(p_message)) not between 1 and 2000 then raise exception 'bad message' using errcode='22023'; end if;
  if p_attachment_path is not null then
    v_prefix:=p_ticket_id::text||'/'||auth.uid()::text||'/';
    if left(p_attachment_path,length(v_prefix))<>v_prefix or length(p_attachment_path)>400
       or position('/' in substring(p_attachment_path from length(v_prefix)+1))>0
       or p_attachment_path !~* '[.](jpg|jpeg|png|webp|gif)$' then raise exception 'bad attachment path' using errcode='22023'; end if;
  end if;
  update public.support_tickets set status='waiting_student',updated_at=now() where id=p_ticket_id and status<>'closed';
  if not found then raise exception 'ticket unavailable' using errcode='22023'; end if;
  insert into public.support_messages(ticket_id,sender_id,sender_role,body,attachment_path)
    values(p_ticket_id,auth.uid(),'admin',trim(p_message),p_attachment_path);
end;
$$;

create or replace function public.admin_set_support_ticket_status(p_ticket_id uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_manage_support_tickets() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_status is null or p_status not in ('waiting_admin','waiting_student','closed') then raise exception 'bad status' using errcode='22023'; end if;
  update public.support_tickets set status=p_status,updated_at=now() where id=p_ticket_id;
  if not found then raise exception 'ticket unavailable' using errcode='22023'; end if;
end;
$$;

create or replace function public.start_exam(p_exam uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_exam public.exams%rowtype; v_att public.exam_attempts%rowtype;
begin
  if v_user is null then raise exception 'not authenticated' using errcode='28000'; end if;
  if exists(select 1 from public.profiles where id=v_user and role in ('essay_grader','course_manager','forum_moderator','payment_manager','support_agent')) then
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
      'options',to_json(q.options),'points',q.points,'question_type',q.question_type) order by q.position)
      from public.exam_questions q where q.exam_id=v_exam.id),'[]'::json));
end;
$$;

drop function if exists public.admin_list_staff();
create function public.admin_list_staff()
returns table(user_id uuid,full_name text,email text,role text,created_at timestamptz)
language plpgsql security definer stable set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  return query select p.id,p.full_name,u.email::text,p.role,p.created_at from public.profiles p join auth.users u on u.id=p.id
    where p.role in ('essay_grader','course_manager','forum_moderator','payment_manager','support_agent') order by p.created_at desc;
end;
$$;

create or replace function public.admin_revoke_staff(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_user=auth.uid() then raise exception 'cannot change own role' using errcode='22023'; end if;
  update public.profiles set role='student' where id=p_user and role in ('essay_grader','course_manager','forum_moderator','payment_manager','support_agent');
  if not found then raise exception 'staff account not found' using errcode='P0002'; end if;
end;
$$;

revoke all on function public.can_manage_support_tickets() from public,anon;
revoke all on function public.can_access_support_ticket(uuid) from public,anon;
revoke all on function public.get_support_messages(uuid) from public,anon;
revoke all on function public.create_support_ticket(text,text) from public,anon;
revoke all on function public.reply_support_ticket(uuid,text,text) from public,anon;
revoke all on function public.admin_get_support_tickets(text) from public,anon;
revoke all on function public.admin_reply_support_ticket(uuid,text,text) from public,anon;
revoke all on function public.admin_set_support_ticket_status(uuid,text) from public,anon;
revoke all on function public.start_exam(uuid) from public,anon;
revoke all on function public.admin_list_staff() from public,anon;
revoke all on function public.admin_revoke_staff(uuid) from public,anon;
grant execute on function public.can_manage_support_tickets() to authenticated;
grant execute on function public.can_access_support_ticket(uuid) to authenticated;
grant execute on function public.get_support_messages(uuid) to authenticated;
grant execute on function public.create_support_ticket(text,text) to authenticated;
grant execute on function public.reply_support_ticket(uuid,text,text) to authenticated;
grant execute on function public.admin_get_support_tickets(text) to authenticated;
grant execute on function public.admin_reply_support_ticket(uuid,text,text) to authenticated;
grant execute on function public.admin_set_support_ticket_status(uuid,text) to authenticated;
grant execute on function public.start_exam(uuid) to authenticated;
grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_revoke_staff(uuid) to authenticated;
