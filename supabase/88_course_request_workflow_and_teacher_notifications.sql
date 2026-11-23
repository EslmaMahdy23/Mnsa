-- Create teacher course requests directly in the admin queue, notify teachers
-- after review, and keep approved courses hidden until the teacher finishes content.
-- Run after 86_restore_teacher_course_review.sql.

create or replace function public.guard_course_approval()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  if auth.uid() is null or public.is_admin()
     or current_setting('app.course_review', true) = '1' then
    return new;
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
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

  new.approval_status := old.approval_status;
  new.approval_note := old.approval_note;
  new.submitted_at := old.submitted_at;
  new.reviewed_at := old.reviewed_at;
  new.reviewed_by := old.reviewed_by;
  new.teacher_id := old.teacher_id;
  new.price := old.price;
  new.show_on_home := old.show_on_home;
  if new.approval_status <> 'approved' then new.is_published := false; end if;
  return new;
end;
$$;

create or replace function public.teacher_submit_course(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.courses%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v from public.courses
  where id = p_id and teacher_id = auth.uid() for update;
  if not found then raise exception 'course_not_found' using errcode = 'P0002'; end if;
  if v.approval_status not in ('draft', 'rejected') then raise exception 'bad_state' using errcode = '22023'; end if;
  if char_length(trim(coalesce(v.subject, ''))) < 2 then raise exception 'subject_required' using errcode = '22023'; end if;

  perform set_config('app.course_review', '1', true);
  update public.courses
     set approval_status = 'pending', submitted_at = now(), approval_note = null,
         reviewed_at = null, reviewed_by = null, is_published = false
   where id = p_id;
end;
$$;

-- Creating and submitting are one transaction. A failed submission cannot leave a half-created course.
create or replace function public.teacher_create_course_request(
  p_title text,
  p_description text,
  p_cover_url text,
  p_subject text,
  p_grade smallint default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_course uuid;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_title, ''))) < 3 then raise exception 'title_required' using errcode = '22023'; end if;
  if char_length(trim(coalesce(p_subject, ''))) < 2 then raise exception 'subject_required' using errcode = '22023'; end if;

  insert into public.courses (title, description, cover_url, teacher_id, subject, grade, is_published)
  values (trim(p_title), nullif(trim(coalesce(p_description, '')), ''), nullif(trim(coalesce(p_cover_url, '')), ''),
          v_user, trim(p_subject), p_grade, false)
  returning id into v_course;

  perform public.teacher_submit_course(v_course);
  return v_course;
end;
$$;

create or replace function public.admin_review_course(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_course public.courses%rowtype;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'bad_status' using errcode = '22023'; end if;

  select * into v_course from public.courses where id = p_id for update;
  if not found then raise exception 'course_not_found' using errcode = 'P0002'; end if;
  if v_course.approval_status <> 'pending' then raise exception 'not_pending' using errcode = '22023'; end if;
  if p_status = 'rejected' and char_length(coalesce(v_note, '')) < 3 then
    raise exception 'rejection_note_required' using errcode = '22023';
  end if;

  perform set_config('app.course_review', '1', true);
  update public.courses
     set approval_status = p_status,
         approval_note = v_note,
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         is_published = false
   where id = p_id;

  insert into public.student_notifications (user_id, source_type, source_id, title, message, href)
  values (
    v_course.teacher_id, 'course', v_course.id,
    case when p_status = 'approved' then 'تمت الموافقة على الكورس' else 'الكورس يحتاج إلى تعديل' end,
    case when p_status = 'approved'
      then 'تم اعتماد «' || v_course.title || '». السعر حدده الأدمن، وتقدر الآن تكمل المحتوى من صفحة كورساتك.'
      else 'ملاحظة الأدمن على «' || v_course.title || '»: ' || coalesce(v_note, 'راجع بيانات الكورس ثم أرسله مرة أخرى.') end,
    '/teacher/courses/' || v_course.id
  )
  on conflict (user_id, source_type, source_id) do update
    set title = excluded.title, message = excluded.message, href = excluded.href,
        created_at = now(), read_at = null;
end;
$$;

revoke all on function public.teacher_submit_course(uuid) from public, anon;
revoke all on function public.teacher_create_course_request(text, text, text, text, smallint) from public, anon;
revoke all on function public.admin_review_course(uuid, text, text) from public, anon;
grant execute on function public.teacher_submit_course(uuid) to authenticated;
grant execute on function public.teacher_create_course_request(text, text, text, text, smallint) to authenticated;
grant execute on function public.admin_review_course(uuid, text, text) to authenticated;
