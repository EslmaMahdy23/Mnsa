-- Step 37: student help center with a private support inbox for admins.
-- Run in Supabase SQL Editor after 36_student_dashboard_font.sql.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (length(trim(subject)) between 1 and 120),
  status text not null default 'waiting_admin'
    check (status in ('waiting_admin','waiting_student','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('student','admin')),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_user_updated_idx
  on public.support_tickets(user_id, updated_at desc);
create index if not exists support_tickets_status_updated_idx
  on public.support_tickets(status, updated_at desc);
create index if not exists support_messages_ticket_created_idx
  on public.support_messages(ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_tickets, public.support_messages from anon, authenticated;

create or replace function public.get_my_support_tickets()
returns json language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return coalesce((
    select json_agg(row_to_json(t) order by t.updated_at desc)
    from (
      select st.id, st.subject, st.status, st.created_at, st.updated_at,
        (select sm.body from public.support_messages sm where sm.ticket_id = st.id order by sm.created_at desc limit 1) as last_message
      from public.support_tickets st where st.user_id = auth.uid()
    ) t
  ), '[]'::json);
end;
$$;

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
      select sm.id, sm.sender_id, sm.sender_role, sm.body, sm.created_at,
        case when sm.sender_role = 'admin' then 'فريق الدعم' else coalesce(p.full_name, 'الطالب') end as sender_name
      from public.support_messages sm
      left join public.profiles p on p.id = sm.sender_id
      where sm.ticket_id = p_ticket_id
    ) m
  ), '[]'::json);
end;
$$;

create or replace function public.create_support_ticket(p_subject text, p_message text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ticket_id uuid;
begin
  if auth.uid() is null or public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_subject is null or length(trim(p_subject)) not between 1 and 120
     or p_message is null or length(trim(p_message)) not between 1 and 2000 then
    raise exception 'bad ticket content' using errcode = '22023';
  end if;
  insert into public.support_tickets(user_id, subject) values (auth.uid(), trim(p_subject)) returning id into v_ticket_id;
  insert into public.support_messages(ticket_id, sender_id, sender_role, body)
    values (v_ticket_id, auth.uid(), 'student', trim(p_message));
  return v_ticket_id;
end;
$$;

create or replace function public.reply_support_ticket(p_ticket_id uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_message is null or length(trim(p_message)) not between 1 and 2000 then
    raise exception 'bad message' using errcode = '22023';
  end if;
  update public.support_tickets set status = 'waiting_admin', updated_at = now()
    where id = p_ticket_id and user_id = auth.uid() and status <> 'closed';
  if not found then raise exception 'ticket unavailable' using errcode = '42501'; end if;
  insert into public.support_messages(ticket_id, sender_id, sender_role, body)
    values (p_ticket_id, auth.uid(), 'student', trim(p_message));
end;
$$;

create or replace function public.admin_get_support_tickets(p_status text default null)
returns json language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('waiting_admin','waiting_student','closed') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  return coalesce((
    select json_agg(row_to_json(t) order by t.updated_at desc)
    from (
      select st.id, st.user_id, st.subject, st.status, st.created_at, st.updated_at,
        coalesce(p.full_name, 'طالب') as student_name, u.email as student_email,
        (select sm.body from public.support_messages sm where sm.ticket_id = st.id order by sm.created_at desc limit 1) as last_message
      from public.support_tickets st
      left join public.profiles p on p.id = st.user_id
      left join auth.users u on u.id = st.user_id
      where p_status is null or st.status = p_status
    ) t
  ), '[]'::json);
end;
$$;

create or replace function public.admin_reply_support_ticket(p_ticket_id uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_message is null or length(trim(p_message)) not between 1 and 2000 then
    raise exception 'bad message' using errcode = '22023';
  end if;
  update public.support_tickets set status = 'waiting_student', updated_at = now()
    where id = p_ticket_id and status <> 'closed';
  if not found then raise exception 'ticket unavailable' using errcode = '22023'; end if;
  insert into public.support_messages(ticket_id, sender_id, sender_role, body)
    values (p_ticket_id, auth.uid(), 'admin', trim(p_message));
end;
$$;

create or replace function public.admin_set_support_ticket_status(p_ticket_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('waiting_admin','waiting_student','closed') then raise exception 'bad status' using errcode = '22023'; end if;
  update public.support_tickets set status = p_status, updated_at = now() where id = p_ticket_id;
  if not found then raise exception 'ticket unavailable' using errcode = '22023'; end if;
end;
$$;

revoke all on function public.get_my_support_tickets() from public, anon;
revoke all on function public.get_support_messages(uuid) from public, anon;
revoke all on function public.create_support_ticket(text,text) from public, anon;
revoke all on function public.reply_support_ticket(uuid,text) from public, anon;
revoke all on function public.admin_get_support_tickets(text) from public, anon;
revoke all on function public.admin_reply_support_ticket(uuid,text) from public, anon;
revoke all on function public.admin_set_support_ticket_status(uuid,text) from public, anon;
grant execute on function public.get_my_support_tickets() to authenticated;
grant execute on function public.get_support_messages(uuid) to authenticated;
grant execute on function public.create_support_ticket(text,text) to authenticated;
grant execute on function public.reply_support_ticket(uuid,text) to authenticated;
grant execute on function public.admin_get_support_tickets(text) to authenticated;
grant execute on function public.admin_reply_support_ticket(uuid,text) to authenticated;
grant execute on function public.admin_set_support_ticket_status(uuid,text) to authenticated;
