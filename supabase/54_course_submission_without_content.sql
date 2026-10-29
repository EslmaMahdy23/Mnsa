-- السماح للمدرّس بإرسال الكورس للمراجعة قبل إضافة الأقسام والدروس.
-- شغّل الملف بعد supabase/53_course_approval.sql.
-- الموافقة ما زالت محمية بصلاحية الأدمن، والكورس لا يظهر للطلاب قبلها.

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

  select * into v
    from public.courses
   where id = p_id and teacher_id = auth.uid()
   for update;

  if not found then
    raise exception 'course_not_found' using errcode = 'P0002';
  end if;
  if v.approval_status not in ('draft', 'rejected') then
    raise exception 'bad_state' using errcode = '22023';
  end if;
  if v.subject is null then
    raise exception 'subject_required' using errcode = '22023';
  end if;

  perform set_config('app.course_review', '1', true);
  update public.courses
     set approval_status = 'pending',
         submitted_at = now(),
         approval_note = null,
         reviewed_at = null,
         reviewed_by = null
   where id = p_id;
end;
$$;

revoke all on function public.teacher_submit_course(uuid) from public, anon;
grant execute on function public.teacher_submit_course(uuid) to authenticated;
