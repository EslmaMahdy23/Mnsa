-- Step 38: private image attachments for support chat messages.
-- Run in Supabase SQL Editor after 37_support_chat.sql.

alter table public.support_messages add column if not exists attachment_path text;

create or replace function public.can_access_support_ticket(p_ticket_id uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (
      select 1 from public.support_tickets st
      where st.id = p_ticket_id and st.user_id = auth.uid()
    )
  );
$$;
revoke all on function public.can_access_support_ticket(uuid) from public, anon;
grant execute on function public.can_access_support_ticket(uuid) to authenticated;

create or replace function public.get_support_messages(p_ticket_id uuid)
returns json language plpgsql security definer stable set search_path = public as $$
declare v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_is_admin := public.is_admin();
  if not v_is_admin and not exists (
    select 1 from public.support_tickets st where st.id = p_ticket_id and st.user_id = auth.uid()
  ) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select json_agg(row_to_json(m) order by m.created_at)
    from (
      select sm.id, sm.sender_id, sm.sender_role, sm.body, sm.attachment_path, sm.created_at,
        case when sm.sender_role = 'admin' then 'فريق الدعم' else coalesce(p.full_name, 'الطالب') end as sender_name
      from public.support_messages sm
      left join public.profiles p on p.id = sm.sender_id
      where sm.ticket_id = p_ticket_id
    ) m
  ), '[]'::json);
end;
$$;
revoke all on function public.get_support_messages(uuid) from public, anon;
grant execute on function public.get_support_messages(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "support attachments read" on storage.objects;
create policy "support attachments read" on storage.objects for select to authenticated
  using (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.can_access_support_ticket(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "support attachments upload" on storage.objects;
create policy "support attachments upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_access_support_ticket(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "support attachments delete own" on storage.objects;
create policy "support attachments delete own" on storage.objects for delete to authenticated
  using (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.can_access_support_ticket(((storage.foldername(name))[1])::uuid)
  );

-- Remove the old RPC signatures so PostgREST can resolve the new optional attachment argument.
drop function if exists public.reply_support_ticket(uuid,text);
drop function if exists public.admin_reply_support_ticket(uuid,text);

create or replace function public.reply_support_ticket(p_ticket_id uuid, p_message text, p_attachment_path text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_prefix text;
begin
  if auth.uid() is null or public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_message is null or length(trim(p_message)) not between 1 and 2000 then
    raise exception 'bad message' using errcode = '22023';
  end if;
  if p_attachment_path is not null then
    v_prefix := p_ticket_id::text || '/' || auth.uid()::text || '/';
    if left(p_attachment_path, length(v_prefix)) <> v_prefix
       or length(p_attachment_path) > 400
       or position('/' in substring(p_attachment_path from length(v_prefix) + 1)) > 0
       or p_attachment_path !~* '[.](jpg|jpeg|png|webp|gif)$' then
      raise exception 'bad attachment path' using errcode = '22023';
    end if;
  end if;
  update public.support_tickets set status = 'waiting_admin', updated_at = now()
    where id = p_ticket_id and user_id = auth.uid() and status <> 'closed';
  if not found then raise exception 'ticket unavailable' using errcode = '42501'; end if;
  insert into public.support_messages(ticket_id, sender_id, sender_role, body, attachment_path)
    values (p_ticket_id, auth.uid(), 'student', trim(p_message), p_attachment_path);
end;
$$;

create or replace function public.admin_reply_support_ticket(p_ticket_id uuid, p_message text, p_attachment_path text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_prefix text;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_message is null or length(trim(p_message)) not between 1 and 2000 then
    raise exception 'bad message' using errcode = '22023';
  end if;
  if p_attachment_path is not null then
    v_prefix := p_ticket_id::text || '/' || auth.uid()::text || '/';
    if left(p_attachment_path, length(v_prefix)) <> v_prefix
       or length(p_attachment_path) > 400
       or position('/' in substring(p_attachment_path from length(v_prefix) + 1)) > 0
       or p_attachment_path !~* '[.](jpg|jpeg|png|webp|gif)$' then
      raise exception 'bad attachment path' using errcode = '22023';
    end if;
  end if;
  update public.support_tickets set status = 'waiting_student', updated_at = now()
    where id = p_ticket_id and status <> 'closed';
  if not found then raise exception 'ticket unavailable' using errcode = '22023'; end if;
  insert into public.support_messages(ticket_id, sender_id, sender_role, body, attachment_path)
    values (p_ticket_id, auth.uid(), 'admin', trim(p_message), p_attachment_path);
end;
$$;

revoke all on function public.reply_support_ticket(uuid,text,text) from public, anon;
revoke all on function public.admin_reply_support_ticket(uuid,text,text) from public, anon;
grant execute on function public.reply_support_ticket(uuid,text,text) to authenticated;
grant execute on function public.admin_reply_support_ticket(uuid,text,text) to authenticated;
