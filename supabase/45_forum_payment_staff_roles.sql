-- Add forum moderators and payment request reviewers as restricted staff roles.
-- Run in Supabase SQL Editor after 44_course_manager_role.sql.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('student','teacher','admin','essay_grader','course_manager','forum_moderator','payment_manager'));

create or replace function public.can_moderate_forum()
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','forum_moderator'));
$$;

create or replace function public.can_review_payment_requests()
returns boolean language sql security definer stable set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','payment_manager'));
$$;

-- Delegated staff accounts are not student exam accounts.
create or replace function public.start_exam(p_exam uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_exam public.exams%rowtype; v_att public.exam_attempts%rowtype;
begin
  if v_user is null then raise exception 'not authenticated' using errcode='28000'; end if;
  if exists(select 1 from public.profiles where id=v_user and role in ('essay_grader','course_manager','forum_moderator','payment_manager')) then
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

revoke all on function public.can_moderate_forum() from public,anon;
revoke all on function public.can_review_payment_requests() from public,anon;
grant execute on function public.can_moderate_forum() to authenticated;
grant execute on function public.can_review_payment_requests() to authenticated;

-- The forum manager posts and replies as a moderator; students can respond to
-- official questions from either an admin or a forum moderator.
alter table public.forum_questions drop constraint if exists forum_questions_author_role_check;
alter table public.forum_questions add constraint forum_questions_author_role_check
  check (author_role in ('student','admin','forum_moderator'));
alter table public.forum_replies drop constraint if exists forum_replies_author_role_check;
alter table public.forum_replies add constraint forum_replies_author_role_check
  check (author_role in ('student','admin','forum_moderator'));

create or replace function public.get_forum_questions(p_status text default null)
returns json language plpgsql security definer stable set search_path=public as $$
declare v_can_moderate boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('pending','published','rejected') then
    raise exception 'bad status' using errcode='22023';
  end if;
  v_can_moderate:=public.can_moderate_forum();
  return coalesce((
    select json_agg(row_to_json(q) order by q.sort_rank,q.updated_at desc)
    from (
      select fq.id,fq.author_id,fq.author_role,fq.title,fq.body,fq.image_path,fq.status,fq.created_at,fq.updated_at,
        coalesce(p.full_name,'طالب') as author_name,p.grade,
        (select count(*)::integer from public.forum_replies fr where fr.question_id=fq.id) as reply_count,
        (select fr.body from public.forum_replies fr where fr.question_id=fq.id order by fr.created_at desc limit 1) as last_reply,
        case when fq.status='pending' then 0 else 1 end as sort_rank
      from public.forum_questions fq left join public.profiles p on p.id=fq.author_id
      where (p_status is null or fq.status=p_status)
        and (v_can_moderate or fq.status='published' or fq.author_id=auth.uid())
    ) q
  ),'[]'::json);
end;
$$;

create or replace function public.get_forum_replies(p_question_id uuid)
returns json language plpgsql security definer stable set search_path=public as $$
declare v_can_moderate boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_can_moderate:=public.can_moderate_forum();
  if not exists(select 1 from public.forum_questions fq where fq.id=p_question_id
    and (v_can_moderate or fq.status='published' or fq.author_id=auth.uid())) then
    raise exception 'not allowed' using errcode='42501';
  end if;
  return coalesce((
    select json_agg(row_to_json(r) order by r.created_at)
    from (
      select fr.id,fr.author_id,fr.author_role,fr.body,fr.created_at,
        coalesce(p.full_name,case fr.author_role when 'admin' then 'إدارة المنصة' when 'forum_moderator' then 'مسؤول المنتدى' else 'طالب' end) as author_name
      from public.forum_replies fr left join public.profiles p on p.id=fr.author_id where fr.question_id=p_question_id
    ) r
  ),'[]'::json);
end;
$$;

create or replace function public.admin_moderate_forum_question(p_question_id uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_moderate_forum() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_status is null or p_status not in ('pending','published','rejected') then raise exception 'bad status' using errcode='22023'; end if;
  update public.forum_questions set status=p_status,updated_at=now() where id=p_question_id;
  if not found then raise exception 'question unavailable' using errcode='22023'; end if;
end;
$$;

create or replace function public.admin_reply_forum_question(p_question_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_reply_id uuid; v_author_id uuid; v_title text; v_role text; v_staff_label text;
begin
  if not public.can_moderate_forum() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_body is null or length(trim(p_body)) not between 1 and 3000 then raise exception 'bad reply' using errcode='22023'; end if;
  select role into v_role from public.profiles where id=auth.uid();
  v_staff_label:=case when v_role='forum_moderator' then 'مسؤول المنتدى' else 'إدارة المنصة' end;
  update public.forum_questions set status='published',updated_at=now()
    where id=p_question_id returning author_id,title into v_author_id,v_title;
  if not found then raise exception 'question unavailable' using errcode='22023'; end if;
  insert into public.forum_replies(question_id,author_id,author_role,body)
    values(p_question_id,auth.uid(),case when v_role='forum_moderator' then 'forum_moderator' else 'admin' end,trim(p_body)) returning id into v_reply_id;
  insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    select v_author_id,'forum_answer',v_reply_id,v_staff_label||' رد على سؤالك: '||left(v_title,100),left(trim(p_body),220),'/dashboard/forum?question='||p_question_id::text
    where exists(select 1 from public.profiles p where p.id=v_author_id and p.role='student')
    on conflict(user_id,source_type,source_id) do nothing;
  return v_reply_id;
end;
$$;

create or replace function public.admin_create_forum_question(p_title text,p_body text,p_image_path text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_question_id uuid; v_role text;
begin
  if not public.can_moderate_forum() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_title is null or length(trim(p_title)) not between 4 and 140
     or p_body is null or length(trim(p_body)) not between 5 and 4000 then raise exception 'bad question' using errcode='22023'; end if;
  if p_image_path is not null and p_image_path !~ ('^'||auth.uid()::text||'/[0-9a-f-]{36}[.](jpg|jpeg|png|webp|gif)$') then
    raise exception 'bad image path' using errcode='22023';
  end if;
  select role into v_role from public.profiles where id=auth.uid();
  insert into public.forum_questions(author_id,author_role,title,body,status,image_path)
    values(auth.uid(),case when v_role='forum_moderator' then 'forum_moderator' else 'admin' end,trim(p_title),trim(p_body),'published',p_image_path)
    returning id into v_question_id;
  return v_question_id;
end;
$$;

create or replace function public.student_reply_forum_question(p_question_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_reply_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='student') then
    raise exception 'not allowed' using errcode='42501';
  end if;
  if p_body is null or length(trim(p_body)) not between 1 and 3000 then raise exception 'bad reply' using errcode='22023'; end if;
  if not exists(select 1 from public.forum_questions fq where fq.id=p_question_id and fq.status='published' and fq.author_role in ('admin','forum_moderator')) then
    raise exception 'students may only reply to official questions' using errcode='42501';
  end if;
  insert into public.forum_replies(question_id,author_id,author_role,body) values(p_question_id,auth.uid(),'student',trim(p_body)) returning id into v_reply_id;
  update public.forum_questions set updated_at=now() where id=p_question_id;
  return v_reply_id;
end;
$$;

create or replace function public.can_read_forum_image(p_path text)
returns boolean language sql security definer stable set search_path=public as $$
  select auth.uid() is not null and exists(select 1 from public.forum_questions fq where fq.image_path=p_path
    and (public.can_moderate_forum() or fq.status='published' or fq.author_id=auth.uid()));
$$;

drop policy if exists "proofs read own or admin" on storage.objects;
create policy "proofs read own or payment staff" on storage.objects for select to authenticated
  using (bucket_id='payment-proofs' and ((storage.foldername(name))[1]=auth.uid()::text or public.can_review_payment_requests()));

-- Payment staff use the same atomic review RPCs as admins; all direct table access stays restricted.
create or replace function public.admin_list_topups(p_status text default null,p_limit int default 20,p_offset int default 0)
returns table(id uuid,user_id uuid,email text,full_name text,phone text,amount numeric,sender_phone text,screenshot_path text,
  status text,approved_amount numeric,admin_note text,created_at timestamptz,reviewed_at timestamptz,total_count bigint)
language plpgsql security definer stable set search_path=public as $$
begin
  if not public.can_review_payment_requests() then raise exception 'not allowed' using errcode='42501'; end if;
  return query select w.id,w.user_id,u.email::text,p.full_name,p.phone,w.amount,w.sender_phone,w.screenshot_path,w.status,
    w.approved_amount,w.admin_note,w.created_at,w.reviewed_at,count(*) over ()
    from public.wallet_topups w join public.profiles p on p.id=w.user_id join auth.users u on u.id=w.user_id
    where (nullif(p_status,'') is null or w.status=p_status)
    order by (w.status='pending') desc,w.created_at desc
    limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end;
$$;

create or replace function public.admin_review_topup(p_id uuid,p_approve boolean,p_amount numeric default null,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_topup public.wallet_topups%rowtype; v_amount numeric(10,2); v_note text:=nullif(trim(coalesce(p_note,'')),'');
begin
  if not public.can_review_payment_requests() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_amount is not null and (p_amount<=0 or p_amount>100000) then raise exception 'bad amount' using errcode='22023'; end if;
  select * into v_topup from public.wallet_topups where id=p_id for update;
  if not found then raise exception 'topup not found' using errcode='P0002'; end if;
  if v_topup.status<>'pending' then raise exception 'already reviewed' using errcode='55000'; end if;
  if p_approve then
    v_amount:=coalesce(p_amount,v_topup.amount);
    update public.profiles set balance=balance+v_amount where id=v_topup.user_id;
    insert into public.wallet_transactions(user_id,amount,kind,topup_id,note,created_by)
      values(v_topup.user_id,v_amount,'topup',v_topup.id,v_note,auth.uid());
    update public.wallet_topups set status='approved',approved_amount=v_amount,admin_note=v_note,reviewed_by=auth.uid(),reviewed_at=now() where id=v_topup.id;
  else
    update public.wallet_topups set status='rejected',admin_note=v_note,reviewed_by=auth.uid(),reviewed_at=now() where id=v_topup.id;
  end if;
end;
$$;

drop function if exists public.admin_list_staff();
create function public.admin_list_staff()
returns table(user_id uuid,full_name text,email text,role text,created_at timestamptz)
language plpgsql security definer stable set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  return query select p.id,p.full_name,u.email::text,p.role,p.created_at from public.profiles p join auth.users u on u.id=p.id
    where p.role in ('essay_grader','course_manager','forum_moderator','payment_manager') order by p.created_at desc;
end;
$$;

create or replace function public.admin_revoke_staff(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_user=auth.uid() then raise exception 'cannot change own role' using errcode='22023'; end if;
  update public.profiles set role='student' where id=p_user and role in ('essay_grader','course_manager','forum_moderator','payment_manager');
  if not found then raise exception 'staff account not found' using errcode='P0002'; end if;
end;
$$;

revoke all on function public.get_forum_questions(text) from public,anon;
revoke all on function public.get_forum_replies(uuid) from public,anon;
revoke all on function public.admin_moderate_forum_question(uuid,text) from public,anon;
revoke all on function public.admin_reply_forum_question(uuid,text) from public,anon;
revoke all on function public.admin_create_forum_question(text,text,text) from public,anon;
revoke all on function public.student_reply_forum_question(uuid,text) from public,anon;
revoke all on function public.can_read_forum_image(text) from public,anon;
revoke all on function public.admin_list_topups(text,int,int) from public,anon;
revoke all on function public.admin_review_topup(uuid,boolean,numeric,text) from public,anon;
revoke all on function public.admin_list_staff() from public,anon;
revoke all on function public.admin_revoke_staff(uuid) from public,anon;
grant execute on function public.get_forum_questions(text) to authenticated;
grant execute on function public.get_forum_replies(uuid) to authenticated;
grant execute on function public.admin_moderate_forum_question(uuid,text) to authenticated;
grant execute on function public.admin_reply_forum_question(uuid,text) to authenticated;
grant execute on function public.admin_create_forum_question(text,text,text) to authenticated;
grant execute on function public.student_reply_forum_question(uuid,text) to authenticated;
grant execute on function public.can_read_forum_image(text) to authenticated;
grant execute on function public.admin_list_topups(text,int,int) to authenticated;
grant execute on function public.admin_review_topup(uuid,boolean,numeric,text) to authenticated;
grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_revoke_staff(uuid) to authenticated;
