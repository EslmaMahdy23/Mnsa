-- Restore admin approval for teacher-created courses after 63_teacher_direct_publish.sql.
-- Run this migration in Supabase after the other course migrations.

create or replace function public.guard_course_approval()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null
     or public.is_admin()
     or current_setting('app.course_review', true) = '1' then
    return new;
  end if;

  select role into v_role from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    -- A teacher saves a draft first, then explicitly submits it from My Courses.
    -- Non-admin staff-created courses enter the same admin review queue immediately.
    if v_role = 'teacher' then
      new.approval_status := 'draft';
      new.submitted_at := null;
    else
      new.approval_status := 'pending';
      new.submitted_at := now();
    end if;
    new.approval_note := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.is_published := false;
    return new;
  end if;

  -- Only an administrator (or the protected review RPC) can change approval fields.
  new.approval_status := old.approval_status;
  new.approval_note := old.approval_note;
  new.submitted_at := old.submitted_at;
  new.reviewed_at := old.reviewed_at;
  new.reviewed_by := old.reviewed_by;
  new.teacher_id := old.teacher_id;
  new.price := old.price;
  new.show_on_home := old.show_on_home;
  if new.approval_status <> 'approved' then
    new.is_published := false;
  end if;
  return new;
end;
$$;

create or replace function public.teacher_submit_course(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v public.courses%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v
  from public.courses
  where id = p_id and teacher_id = auth.uid()
  for update;
  if not found then raise exception 'course_not_found' using errcode = 'P0002'; end if;
  if v.approval_status not in ('draft', 'rejected') then
    raise exception 'bad_state' using errcode = '22023';
  end if;
  if v.subject is null then raise exception 'subject_required' using errcode = '22023'; end if;

  perform set_config('app.course_review', '1', true);
  update public.courses
     set approval_status = 'pending', submitted_at = now(), approval_note = null,
         reviewed_at = null, reviewed_by = null, is_published = false
   where id = p_id;
end;
$$;

revoke all on function public.teacher_submit_course(uuid) from public, anon;
grant execute on function public.teacher_submit_course(uuid) to authenticated;
