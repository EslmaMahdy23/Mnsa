-- Owner-only cleanup for explicitly selected, unused course and exam content.
-- Run after 48_exam_result_snapshots.sql. This intentionally cannot delete users,
-- exam attempts/results, invoices, wallet data, support tickets, or notifications.

create table if not exists public.platform_owner (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index if not exists platform_owner_single_account on public.platform_owner ((true));

alter table public.platform_owner enable row level security;
revoke all on public.platform_owner from public, anon, authenticated;

create or replace function public.is_platform_owner()
returns boolean
language sql security definer stable set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.platform_owner where user_id = auth.uid()
  );
$$;

create or replace function public.admin_cleanup_preview()
returns json
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_platform_owner() then raise exception 'owner only' using errcode='42501'; end if;
  return json_build_object(
    'courses', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'title', c.title, 'created_at', c.created_at,
        'lessons', (select count(*) from public.lessons l where l.course_id=c.id),
        'sections', (select count(*) from public.course_sections s where s.course_id=c.id)
      ) order by c.created_at desc)
      from public.courses c
      where not exists (select 1 from public.enrollments e where e.course_id=c.id)
        and not exists (select 1 from public.invoice_items i where i.course_id=c.id)
        and not exists (select 1 from public.course_promo_codes pc where pc.course_id=c.id)
        and not exists (select 1 from public.course_promo_redemptions pr where pr.course_id=c.id)
        and not exists (select 1 from public.exams ex where ex.course_id=c.id)
    ), '[]'::json),
    'exams', coalesce((
      select json_agg(json_build_object('id', e.id, 'title', e.title, 'created_at', e.created_at)
        order by e.created_at desc)
      from public.exams e
      where not exists (select 1 from public.exam_attempts a where a.exam_id=e.id)
    ), '[]'::json),
    'support_tickets', coalesce((
      select json_agg(json_build_object(
        'id', st.id, 'title', st.subject, 'created_at', st.created_at,
        'student_name', coalesce(p.full_name, u.email, 'طالب'),
        'message_count', (select count(*) from public.support_messages sm where sm.ticket_id=st.id),
        'attachments', coalesce((select json_agg(sm.attachment_path) from public.support_messages sm
          where sm.ticket_id=st.id and sm.attachment_path is not null), '[]'::json)
      ) order by st.updated_at asc)
      from public.support_tickets st
      left join public.profiles p on p.id=st.user_id
      left join auth.users u on u.id=st.user_id
      where st.status='closed'
    ), '[]'::json)
  );
end;
$$;

drop function if exists public.admin_cleanup_delete(uuid[], uuid[]);
create or replace function public.admin_cleanup_delete(
  p_course_ids uuid[] default '{}', p_exam_ids uuid[] default '{}', p_support_ticket_ids uuid[] default '{}'
)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_courses uuid[] := coalesce(p_course_ids, '{}');
  v_exams uuid[] := coalesce(p_exam_ids, '{}');
  v_tickets uuid[] := coalesce(p_support_ticket_ids, '{}');
  v_count integer;
begin
  if not public.is_platform_owner() then raise exception 'owner only' using errcode='42501'; end if;
  if cardinality(v_courses) > 100 or cardinality(v_exams) > 100 or cardinality(v_tickets) > 100 then
    raise exception 'too many selected rows' using errcode='22023';
  end if;
  if cardinality(v_courses) + cardinality(v_exams) + cardinality(v_tickets) = 0 then
    raise exception 'nothing selected' using errcode='22023';
  end if;

  -- Lock and recheck eligibility inside the same transaction to avoid stale previews.
  perform 1 from public.courses where id = any(v_courses) for update;
  select count(*) into v_count from public.courses c
    where c.id = any(v_courses)
      and not exists (select 1 from public.enrollments e where e.course_id=c.id)
      and not exists (select 1 from public.invoice_items i where i.course_id=c.id)
      and not exists (select 1 from public.course_promo_codes pc where pc.course_id=c.id)
      and not exists (select 1 from public.course_promo_redemptions pr where pr.course_id=c.id)
      and not exists (select 1 from public.exams ex where ex.course_id=c.id);
  if v_count <> cardinality(v_courses) then
    raise exception 'course is missing or has linked student/business data; refresh preview' using errcode='55000';
  end if;

  perform 1 from public.exams where id = any(v_exams) for update;
  select count(*) into v_count from public.exams e
    where e.id = any(v_exams)
      and not exists (select 1 from public.exam_attempts a where a.exam_id=e.id);
  if v_count <> cardinality(v_exams) then
    raise exception 'exam is missing or has student attempts; refresh preview' using errcode='55000';
  end if;

  perform 1 from public.support_tickets where id = any(v_tickets) for update;
  select count(*) into v_count from public.support_tickets st
    where st.id = any(v_tickets) and st.status='closed';
  if v_count <> cardinality(v_tickets) then
    raise exception 'support ticket is missing or not closed; refresh preview' using errcode='55000';
  end if;

  delete from public.exams where id = any(v_exams);
  delete from public.courses where id = any(v_courses);
  delete from public.support_tickets where id = any(v_tickets);
  return json_build_object('deleted_courses', cardinality(v_courses), 'deleted_exams', cardinality(v_exams),
    'deleted_support_tickets', cardinality(v_tickets));
end;
$$;

-- The owner can remove attachment blobs for tickets that were deleted by the cleanup RPC.
drop policy if exists "owner cleanup support attachments" on storage.objects;
create policy "owner cleanup support attachments" on storage.objects for delete to authenticated
  using (bucket_id='support-attachments' and public.is_platform_owner());

revoke all on function public.is_platform_owner() from public, anon;
revoke all on function public.admin_cleanup_preview() from public, anon;
revoke all on function public.admin_cleanup_delete(uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.is_platform_owner() to authenticated;
grant execute on function public.admin_cleanup_preview() to authenticated;
grant execute on function public.admin_cleanup_delete(uuid[], uuid[], uuid[]) to authenticated;

-- Register the platform owner account. Keep this email aligned with the admin login.
insert into public.platform_owner(user_id)
select id from auth.users where lower(email) = lower('eslamahmedsayed43@gmail.com')
on conflict (user_id) do nothing;
