-- امتحانات المدرّسين بموافقة الأدمن
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 53 و54 وباقي الملفات)
--
-- الفكرة (زي موافقة الكورسات):
--  * المدرّس بيعمل امتحان لكورس بتاعه بحالة draft (مسودة) وبأسئلة اختيار من متعدد بس.
--  * بيبعته للمراجعة (teacher_submit_exam) فيبقى pending ومبيتعدّلش.
--  * الأدمن يوافق (فالامتحان بيتنشر لطلاب الكورس) أو يرفض بملاحظة (admin_review_exam).
--  * الامتحان المعتمد مقفول على المدرّس، وأي تعديل بعد كده من الأدمن.
--  * admin_save_exam (دالة الأدمن) ما اتغيّرتش، والامتحانات القديمة بتفضل approved زي ما هي.
--  * الأسئلة المقالية للأدمن بس دلوقتي (تصحيحها من الأدمن أو مصحّح المقالي).

-- ========== 1) الأعمدة ==========
alter table public.exams
  add column if not exists approval_status text not null default 'approved',
  add column if not exists approval_note text,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

alter table public.exams drop constraint if exists exams_approval_status_check;
alter table public.exams
  add constraint exams_approval_status_check check (approval_status in ('draft', 'pending', 'approved', 'rejected'));

create index if not exists exams_approval_idx on public.exams (submitted_at) where approval_status = 'pending';

-- ========== 2) المدرّس يقرأ امتحانات وأسئلة كورساته (سياسات إضافية، ما بنلمسش القديم) ==========
drop policy if exists "exams teacher read own" on public.exams;
create policy "exams teacher read own" on public.exams for select to authenticated
  using (
    course_id is not null
    and exists (select 1 from public.courses c where c.id = exams.course_id and c.teacher_id = (select auth.uid()))
  );

drop policy if exists "questions teacher read own" on public.exam_questions;
create policy "questions teacher read own" on public.exam_questions for select to authenticated
  using (
    exists (
      select 1 from public.exams e
      join public.courses c on c.id = e.course_id
      where e.id = exam_questions.exam_id and c.teacher_id = (select auth.uid())
    )
  );

-- ========== 3) المدرّس يحفظ امتحان (مسودة) ==========
-- أكواد الأخطاء نصوص ثابتة بتتحوّل لرسائل عربي في الواجهة:
--   course_required | course_not_found | exam_not_found | locked | essay_not_allowed | bad_question
create or replace function public.teacher_save_exam(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id      uuid := p_id;
  v_title   text := trim(coalesce(p_data->>'title', ''));
  v_desc    text := nullif(trim(coalesce(p_data->>'description', '')), '');
  v_qs      jsonb := coalesce(p_data->'questions', '[]'::jsonb);
  v_course  uuid := nullif(p_data->>'course_id', '')::uuid;
  v_section uuid := nullif(p_data->>'section_id', '')::uuid;
  v_dur     int := nullif(p_data->>'duration_minutes', '')::int;
  v_pass    int := coalesce(nullif(p_data->>'pass_percent', '')::int, 50);
  v_review  text := coalesce(nullif(p_data->>'review_mode', ''), 'none');
  v_lock    boolean := coalesce((p_data->>'lock_following')::boolean, false);
  v_grade   smallint;
  v_old_sec uuid;
  v_old_course uuid;
  v_status  text;
  v_pos     int := 0;
  v_count   int;
  v_points  numeric;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if char_length(v_title) < 3 then raise exception 'bad title' using errcode = '22023'; end if;
  if v_review not in ('none', 'marks', 'full') then raise exception 'bad review mode' using errcode = '22023'; end if;
  if jsonb_typeof(v_qs) <> 'array' or jsonb_array_length(v_qs) > 200 then
    raise exception 'bad questions' using errcode = '22023';
  end if;
  if v_course is null then raise exception 'course_required' using errcode = '22023'; end if;

  -- الكورس لازم يكون بتاع المدرّس (والسنة بتتاخد منه)
  select c.grade into v_grade from public.courses c where c.id = v_course and c.teacher_id = auth.uid();
  if not found then raise exception 'course_not_found' using errcode = 'P0002'; end if;

  if exists (
    select 1
    from jsonb_array_elements(v_qs) q(val)
    cross join lateral (
      select case when jsonb_typeof(q.val->'options') = 'array' then jsonb_array_length(q.val->'options') else 0 end as n
    ) o
    where char_length(trim(coalesce(q.val->>'body', ''))) = 0
       or (coalesce(q.val->>'question_type','choice')='choice' and (o.n not between 2 and 6
           or coalesce((q.val->>'correct_index')::int, -1) not between 0 and o.n - 1))
       or coalesce(q.val->>'question_type','choice') not in ('choice','essay')
       or coalesce(nullif(q.val->>'points', '')::int, 1) not between 1 and 100
  ) then
    raise exception 'bad_question' using errcode = '22023';
  end if;

  -- التعديل: الامتحان لازم يكون بتاع المدرّس وفي حالة مسودة أو مرفوض بس
  if v_id is not null then
    select e.section_id, e.course_id, e.approval_status
      into v_old_sec, v_old_course, v_status
      from public.exams e where e.id = v_id;
    if not found
       or not exists (select 1 from public.courses c where c.id = v_old_course and c.teacher_id = auth.uid()) then
      raise exception 'exam_not_found' using errcode = 'P0002';
    end if;
    if v_status not in ('draft', 'rejected', 'pending', 'approved') then raise exception 'locked' using errcode = '22023'; end if;
    if v_old_course is distinct from v_course then raise exception 'course_not_found' using errcode = 'P0002'; end if;
    if not (p_data ? 'section_id') then v_section := v_old_sec; end if;
  end if;

  if v_section is not null
     and not exists (select 1 from public.course_sections s where s.id = v_section and s.course_id = v_course) then
    raise exception 'section does not belong to course' using errcode = '22023';
  end if;

  -- الترتيب: بعد آخر عنصر في القسم (فيديو/ملف/امتحان)
  if v_section is not null and (v_id is null or v_section is distinct from v_old_sec) then
    select greatest(
             coalesce((select max(l.position) from public.lessons l where l.section_id = v_section), 0),
             coalesce((select max(e.position) from public.exams e where e.section_id = v_section), 0)
           ) + 1
      into v_pos;
  end if;

  if v_id is null then
    insert into public.exams (title, description, course_id, grade, duration_minutes, pass_percent, is_published,
                              created_by, section_id, position, review_mode, lock_following, approval_status)
    values (v_title, v_desc, v_course, v_grade, v_dur, v_pass, true,
            auth.uid(), v_section, v_pos, v_review, v_lock, 'approved')
    returning id into v_id;
  else
    update public.exams
       set title = v_title, description = v_desc, grade = v_grade, duration_minutes = v_dur, pass_percent = v_pass,
           is_published = true, approval_status = 'approved', approval_note = null,
           reviewed_at = now(), reviewed_by = auth.uid(), section_id = v_section, review_mode = v_review, lock_following = v_lock,
           position = case when v_section is not distinct from v_old_sec then exams.position else v_pos end
     where id = v_id;
  end if;

  delete from public.exam_questions where exam_id = v_id;

  insert into public.exam_questions (exam_id, position, body, options, correct_index, points, explanation, question_type)
  select v_id,
         q.ord::int,
         trim(q.val->>'body'),
         case when coalesce(q.val->>'question_type','choice')='essay' then array['','']::text[] else array(select jsonb_array_elements_text(q.val->'options')) end,
         case when coalesce(q.val->>'question_type','choice')='essay' then 0 else (q.val->>'correct_index')::int end,
         coalesce(nullif(q.val->>'points', '')::int, 1),
         nullif(trim(coalesce(q.val->>'explanation', '')), ''),
         coalesce(q.val->>'question_type','choice')
    from jsonb_array_elements(v_qs) with ordinality as q(val, ord);

  select count(*), coalesce(sum(points), 0) into v_count, v_points from public.exam_questions where exam_id = v_id;
  update public.exams set question_count = v_count, total_points = v_points where id = v_id;

  return v_id;
end;
$$;

-- ========== 4) المدرّس يبعت الامتحان للمراجعة ==========
--   exam_not_found | bad_state | no_questions
create or replace function public.teacher_submit_exam(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_count  int;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select e.approval_status, e.question_count into v_status, v_count
    from public.exams e
    join public.courses c on c.id = e.course_id
   where e.id = p_id and c.teacher_id = auth.uid()
   for update of e;
  if not found then raise exception 'exam_not_found' using errcode = 'P0002'; end if;
  if v_status not in ('draft', 'rejected') then raise exception 'bad_state' using errcode = '22023'; end if;
  if v_count < 1 then raise exception 'no_questions' using errcode = '22023'; end if;

  update public.exams
     set approval_status = 'pending', submitted_at = now(),
         approval_note = null, reviewed_at = null, reviewed_by = null, is_published = false
   where id = p_id;
end;
$$;

-- ========== 5) المدرّس يمسح امتحان لسه مسودة أو مرفوض ==========
create or replace function public.teacher_delete_exam(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select e.approval_status into v_status
    from public.exams e
    join public.courses c on c.id = e.course_id
   where e.id = p_id and c.teacher_id = auth.uid()
   for update of e;
  if not found then raise exception 'exam_not_found' using errcode = 'P0002'; end if;
  if v_status not in ('draft', 'rejected', 'pending', 'approved') then raise exception 'locked' using errcode = '22023'; end if;

  delete from public.exams where id = p_id;
end;
$$;

-- ========== 6) الأدمن يوافق أو يرفض ==========
-- الموافقة بتنشر الامتحان لطلاب الكورس. الرفض بيرجّعه للمدرّس بملاحظتك.
create or replace function public.admin_review_exam(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_old text;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'bad_status' using errcode = '22023'; end if;

  select approval_status into v_old from public.exams where id = p_id for update;
  if not found then raise exception 'exam_not_found' using errcode = 'P0002'; end if;
  if v_old <> 'pending' then raise exception 'not_pending' using errcode = '22023'; end if;

  update public.exams
     set approval_status = p_status,
         approval_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         is_published = (p_status = 'approved')
   where id = p_id;
end;
$$;

revoke all on function public.teacher_save_exam(uuid, jsonb) from public, anon;
revoke all on function public.teacher_submit_exam(uuid) from public, anon;
revoke all on function public.teacher_delete_exam(uuid) from public, anon;
revoke all on function public.admin_review_exam(uuid, text, text) from public, anon;
grant execute on function public.teacher_save_exam(uuid, jsonb) to authenticated;
grant execute on function public.teacher_submit_exam(uuid) to authenticated;
grant execute on function public.teacher_delete_exam(uuid) to authenticated;
grant execute on function public.admin_review_exam(uuid, text, text) to authenticated;
