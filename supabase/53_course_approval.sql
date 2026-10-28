-- موافقة الأدمن على كورسات المدرّسين + مادة الكورس
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 52_teacher_stage_grades.sql)
--
-- الفكرة:
--  * المدرّس بيعمل كورس بحالة draft (مسودة) ومايقدرش ينشره بنفسه.
--  * لما يخلّص المحتوى بيبعت الكورس للمراجعة (teacher_submit_course) فيبقى pending.
--  * الأدمن يوافق (فيتنشر الكورس) أو يرفض بملاحظة (admin_review_course).
--  * بعد الموافقة المدرّس يقدر يخفي كورسه وينشره تاني.
--  * الكورسات الموجودة قبل الملف ده والكورسات اللي بيعملها الأدمن ومدير المحتوى بتفضل approved زي ما هي.

-- ========== 1) الأعمدة ==========
alter table public.courses
  add column if not exists subject text,
  add column if not exists approval_status text not null default 'approved',
  add column if not exists approval_note text,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

alter table public.courses drop constraint if exists courses_approval_status_check;
alter table public.courses
  add constraint courses_approval_status_check check (approval_status in ('draft', 'pending', 'approved', 'rejected'));

alter table public.courses drop constraint if exists courses_subject_check;
alter table public.courses
  add constraint courses_subject_check check (subject is null or char_length(subject) between 2 and 80);

create index if not exists courses_approval_idx on public.courses (approval_status, submitted_at) where approval_status = 'pending';

-- ========== 2) حماية: المدرّس مايغيّرش حالة الموافقة ولا ينشر قبل الموافقة ==========
-- (auth.uid() فاضي = SQL Editor أو السيرفر، والأدمن ومدير المحتوى مسموح لهم،
--  ودوال المراجعة تحت بتعدّي من العلم app.course_review)
create or replace function public.guard_course_approval()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null
     or public.can_manage_course_content()
     or current_setting('app.course_review', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.approval_status := 'draft';
    new.approval_note := null;
    new.submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.is_published := false;
  else
    new.approval_status := old.approval_status;
    new.approval_note := old.approval_note;
    new.submitted_at := old.submitted_at;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.teacher_id := old.teacher_id;
    -- RLS allows teachers to update their course row; keep admin-only fields locked here too.
    new.price := old.price;
    new.show_on_home := old.show_on_home;
    if new.approval_status <> 'approved' then
      new.is_published := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists courses_approval_guard on public.courses;
create trigger courses_approval_guard
  before insert or update on public.courses
  for each row execute function public.guard_course_approval();

-- ========== 3) المدرّس يبعت الكورس للمراجعة ==========
-- أكواد الأخطاء نصوص ثابتة بتتحوّل لرسائل عربي في الواجهة:
--   course_not_found | bad_state | subject_required | empty_course
create or replace function public.teacher_submit_course(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v public.courses%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v from public.courses where id = p_id and teacher_id = auth.uid() for update;
  if not found then raise exception 'course_not_found' using errcode = 'P0002'; end if;
  if v.approval_status not in ('draft', 'rejected') then raise exception 'bad_state' using errcode = '22023'; end if;
  if v.subject is null then raise exception 'subject_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.lessons where course_id = p_id) then
    raise exception 'empty_course' using errcode = '22023';
  end if;

  perform set_config('app.course_review', '1', true);
  update public.courses
     set approval_status = 'pending', submitted_at = now(),
         approval_note = null, reviewed_at = null, reviewed_by = null
   where id = p_id;
end;
$$;

-- ========== 4) الأدمن يوافق أو يرفض ==========
-- الموافقة بتنشر الكورس. الرفض بيرجّعه للمدرّس بالملاحظة عشان يعدّل ويبعته تاني.
create or replace function public.admin_review_course(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_old text;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'bad_status' using errcode = '22023'; end if;

  select approval_status into v_old from public.courses where id = p_id for update;
  if not found then raise exception 'course_not_found' using errcode = 'P0002'; end if;
  if v_old <> 'pending' then raise exception 'not_pending' using errcode = '22023'; end if;

  perform set_config('app.course_review', '1', true);
  update public.courses
     set approval_status = p_status,
         approval_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         is_published = (p_status = 'approved')
   where id = p_id;
end;
$$;

revoke all on function public.teacher_submit_course(uuid) from public, anon;
revoke all on function public.admin_review_course(uuid, text, text) from public, anon;
grant execute on function public.teacher_submit_course(uuid) to authenticated;
grant execute on function public.admin_review_course(uuid, text, text) to authenticated;
