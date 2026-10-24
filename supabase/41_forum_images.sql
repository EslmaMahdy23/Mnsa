-- Step 41: allow image attachments on forum questions.
-- Run in Supabase SQL Editor after 40_forum_reply_rules.sql.

alter table public.forum_questions
  add column if not exists image_path text;

create or replace function public.can_read_forum_image(p_path text)
returns boolean
language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1
    from public.forum_questions fq
    where fq.image_path = p_path
      and (public.is_admin() or fq.status = 'published' or fq.author_id = auth.uid())
  );
$$;
revoke all on function public.can_read_forum_image(text) from public, anon;
grant execute on function public.can_read_forum_image(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('forum-images', 'forum-images', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "forum images read" on storage.objects;
create policy "forum images read" on storage.objects for select to authenticated
  using (bucket_id = 'forum-images' and public.can_read_forum_image(name));

drop policy if exists "forum images upload own" on storage.objects;
create policy "forum images upload own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'forum-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.filename(name)) ~* '^[0-9a-f-]{36}[.](jpg|jpeg|png|webp|gif)$'
  );

drop policy if exists "forum images delete own" on storage.objects;
create policy "forum images delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'forum-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop function if exists public.student_create_forum_question(text,text);
create or replace function public.student_create_forum_question(p_title text, p_body text, p_image_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_question_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student'
  ) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_title is null or length(trim(p_title)) not between 4 and 140
     or p_body is null or length(trim(p_body)) not between 5 and 4000 then
    raise exception 'bad question' using errcode = '22023';
  end if;
  if p_image_path is not null and (
    p_image_path !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}[.](jpg|jpeg|png|webp|gif)$')
  ) then raise exception 'bad image path' using errcode = '22023'; end if;
  insert into public.forum_questions(author_id,title,body,image_path)
    values(auth.uid(),trim(p_title),trim(p_body),p_image_path) returning id into v_question_id;
  return v_question_id;
end;
$$;

drop function if exists public.admin_create_forum_question(text,text);
create or replace function public.admin_create_forum_question(p_title text, p_body text, p_image_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_question_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_title is null or length(trim(p_title)) not between 4 and 140
     or p_body is null or length(trim(p_body)) not between 5 and 4000 then
    raise exception 'bad question' using errcode = '22023';
  end if;
  if p_image_path is not null and (
    p_image_path !~ ('^' || auth.uid()::text || '/[0-9a-f-]{36}[.](jpg|jpeg|png|webp|gif)$')
  ) then raise exception 'bad image path' using errcode = '22023'; end if;
  insert into public.forum_questions(author_id,author_role,title,body,status,image_path)
    values(auth.uid(),'admin',trim(p_title),trim(p_body),'published',p_image_path) returning id into v_question_id;
  return v_question_id;
end;
$$;

revoke all on function public.student_create_forum_question(text,text,text) from public, anon;
revoke all on function public.admin_create_forum_question(text,text,text) from public, anon;
grant execute on function public.student_create_forum_question(text,text,text) to authenticated;
grant execute on function public.admin_create_forum_question(text,text,text) to authenticated;

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
      select fq.id, fq.author_id, fq.author_role, fq.title, fq.body, fq.image_path,
        fq.status, fq.created_at, fq.updated_at,
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

revoke all on function public.get_forum_questions(text) from public, anon;
grant execute on function public.get_forum_questions(text) to authenticated;
