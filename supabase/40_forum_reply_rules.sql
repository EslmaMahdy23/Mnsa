-- Step 40: restrict student replies to questions posted by admins.
-- Run in Supabase SQL Editor after 39_student_forum.sql.

alter table public.forum_questions
  add column if not exists author_role text not null default 'student'
  check (author_role in ('student','admin'));

update public.forum_questions fq
set author_role = case when p.role = 'admin' then 'admin' else 'student' end
from public.profiles p
where p.id = fq.author_id and fq.author_role <> case when p.role = 'admin' then 'admin' else 'student' end;

create or replace function public.get_forum_questions(p_status text default null)
returns json language plpgsql security definer stable set search_path = public as $$
declare v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('pending','published','rejected') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  v_is_admin := public.is_admin();
  return coalesce((
    select json_agg(row_to_json(q) order by q.sort_rank, q.updated_at desc)
    from (
      select fq.id, fq.author_id, fq.author_role, fq.title, fq.body, fq.status, fq.created_at, fq.updated_at,
        coalesce(p.full_name, 'طالب') as author_name, p.grade,
        (select count(*)::integer from public.forum_replies fr where fr.question_id = fq.id) as reply_count,
        (select fr.body from public.forum_replies fr where fr.question_id = fq.id order by fr.created_at desc limit 1) as last_reply,
        case when fq.status = 'pending' then 0 else 1 end as sort_rank
      from public.forum_questions fq
      left join public.profiles p on p.id = fq.author_id
      where (p_status is null or fq.status = p_status)
        and (v_is_admin or fq.status = 'published' or fq.author_id = auth.uid())
    ) q
  ), '[]'::json);
end;
$$;

create or replace function public.student_reply_forum_question(p_question_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_reply_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_body is null or length(trim(p_body)) not between 1 and 3000 then raise exception 'bad reply' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.forum_questions fq
    where fq.id = p_question_id and fq.status = 'published' and fq.author_role = 'admin'
  ) then raise exception 'students may only reply to admin questions' using errcode = '42501'; end if;
  insert into public.forum_replies(question_id,author_id,author_role,body)
    values(p_question_id,auth.uid(),'student',trim(p_body)) returning id into v_reply_id;
  update public.forum_questions set updated_at = now() where id = p_question_id;
  return v_reply_id;
end;
$$;

create or replace function public.admin_create_forum_question(p_title text,p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_question_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_title is null or length(trim(p_title)) not between 4 and 140
     or p_body is null or length(trim(p_body)) not between 5 and 4000 then
    raise exception 'bad question' using errcode = '22023';
  end if;
  insert into public.forum_questions(author_id,author_role,title,body,status)
    values(auth.uid(),'admin',trim(p_title),trim(p_body),'published') returning id into v_question_id;
  return v_question_id;
end;
$$;

revoke all on function public.get_forum_questions(text) from public, anon;
revoke all on function public.student_reply_forum_question(uuid,text) from public, anon;
revoke all on function public.admin_create_forum_question(text,text) from public, anon;
grant execute on function public.get_forum_questions(text) to authenticated;
grant execute on function public.student_reply_forum_question(uuid,text) to authenticated;
grant execute on function public.admin_create_forum_question(text,text) to authenticated;
