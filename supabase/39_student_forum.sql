-- Step 39: moderated student forum with admin replies and student notifications.
-- Run in Supabase SQL Editor after 38_support_attachments.sql.

create table if not exists public.forum_questions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 4 and 140),
  body text not null check (length(trim(body)) between 5 and 4000),
  status text not null default 'pending' check (status in ('pending','published','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.forum_replies (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.forum_questions(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_role text not null check (author_role in ('student','admin')),
  body text not null check (length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);

create index if not exists forum_questions_status_updated_idx on public.forum_questions(status, updated_at desc);
create index if not exists forum_questions_author_created_idx on public.forum_questions(author_id, created_at desc);
create index if not exists forum_replies_question_created_idx on public.forum_replies(question_id, created_at);

alter table public.forum_questions enable row level security;
alter table public.forum_replies enable row level security;
revoke all on public.forum_questions, public.forum_replies from anon, authenticated;

alter table public.student_notifications drop constraint if exists student_notifications_source_type_check;
alter table public.student_notifications add constraint student_notifications_source_type_check
  check (source_type in ('course','exam','lecture_schedule','admin_broadcast','forum_answer'));

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
      select fq.id, fq.author_id, fq.title, fq.body, fq.status, fq.created_at, fq.updated_at,
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

create or replace function public.get_forum_replies(p_question_id uuid)
returns json language plpgsql security definer stable set search_path = public as $$
declare v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_is_admin := public.is_admin();
  if not exists (
    select 1 from public.forum_questions fq where fq.id = p_question_id
      and (v_is_admin or fq.status = 'published' or fq.author_id = auth.uid())
  ) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select json_agg(row_to_json(r) order by r.created_at)
    from (
      select fr.id, fr.author_id, fr.author_role, fr.body, fr.created_at,
        coalesce(p.full_name, case when fr.author_role = 'admin' then 'إدارة المنصة' else 'طالب' end) as author_name
      from public.forum_replies fr left join public.profiles p on p.id = fr.author_id
      where fr.question_id = p_question_id
    ) r
  ), '[]'::json);
end;
$$;

create or replace function public.student_create_forum_question(p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_question_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_title is null or length(trim(p_title)) not between 4 and 140
     or p_body is null or length(trim(p_body)) not between 5 and 4000 then
    raise exception 'bad question' using errcode = '22023';
  end if;
  insert into public.forum_questions(author_id,title,body) values(auth.uid(),trim(p_title),trim(p_body)) returning id into v_question_id;
  return v_question_id;
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
  if not exists (select 1 from public.forum_questions fq where fq.id = p_question_id and fq.status = 'published') then
    raise exception 'question unavailable' using errcode = '42501';
  end if;
  insert into public.forum_replies(question_id,author_id,author_role,body)
    values(p_question_id,auth.uid(),'student',trim(p_body)) returning id into v_reply_id;
  update public.forum_questions set updated_at = now() where id = p_question_id;
  return v_reply_id;
end;
$$;

create or replace function public.admin_moderate_forum_question(p_question_id uuid,p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('pending','published','rejected') then raise exception 'bad status' using errcode = '22023'; end if;
  update public.forum_questions set status = p_status, updated_at = now() where id = p_question_id;
  if not found then raise exception 'question unavailable' using errcode = '22023'; end if;
end;
$$;

create or replace function public.admin_reply_forum_question(p_question_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_reply_id uuid; v_author_id uuid; v_title text;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_body is null or length(trim(p_body)) not between 1 and 3000 then raise exception 'bad reply' using errcode = '22023'; end if;
  update public.forum_questions set status = 'published', updated_at = now()
    where id = p_question_id returning author_id,title into v_author_id,v_title;
  if not found then raise exception 'question unavailable' using errcode = '22023'; end if;
  insert into public.forum_replies(question_id,author_id,author_role,body)
    values(p_question_id,auth.uid(),'admin',trim(p_body)) returning id into v_reply_id;
  insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    select v_author_id,'forum_answer',v_reply_id,'الأدمن رد على سؤالك: ' || left(v_title,100),left(trim(p_body),220),'/dashboard/forum?question=' || p_question_id::text
    where exists (select 1 from public.profiles p where p.id = v_author_id and p.role = 'student')
    on conflict (user_id,source_type,source_id) do nothing;
  return v_reply_id;
end;
$$;

revoke all on function public.get_forum_questions(text) from public, anon;
revoke all on function public.get_forum_replies(uuid) from public, anon;
revoke all on function public.student_create_forum_question(text,text) from public, anon;
revoke all on function public.student_reply_forum_question(uuid,text) from public, anon;
revoke all on function public.admin_moderate_forum_question(uuid,text) from public, anon;
revoke all on function public.admin_reply_forum_question(uuid,text) from public, anon;
grant execute on function public.get_forum_questions(text) to authenticated;
grant execute on function public.get_forum_replies(uuid) to authenticated;
grant execute on function public.student_create_forum_question(text,text) to authenticated;
grant execute on function public.student_reply_forum_question(uuid,text) to authenticated;
grant execute on function public.admin_moderate_forum_question(uuid,text) to authenticated;
grant execute on function public.admin_reply_forum_question(uuid,text) to authenticated;
