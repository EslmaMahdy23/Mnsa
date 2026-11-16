-- إصلاح teacher_assistant_courses: النسخة اللي في ملف 76 كانت بتستخدم
-- SELECT DISTINCT مع ORDER BY على عمود (created_at) مش موجود في القايمة، وPostgres بيرفض ده وقت التشغيل.
-- النسخة دي من غير DISTINCT (الصلاحيات نفسها: كورسات المدرّس المربوط بيه المساعد بس).
-- شغّله بعد 76_teacher_assistant_permissions.sql

create or replace function public.teacher_assistant_courses()
returns table(id uuid, title text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or not public.is_teacher_assistant() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select c.id, c.title
    from public.courses c
    where c.teacher_id in (
      select g.teacher_id from public.teacher_exam_graders g where g.grader_id = v_user
    )
    order by c.created_at desc;
end;
$$;

revoke all on function public.teacher_assistant_courses() from public, anon;
grant execute on function public.teacher_assistant_courses() to authenticated;
