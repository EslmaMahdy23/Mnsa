-- الخطوة 14: الامتحان يبقى جوه قسم الكورس (مع الفيديوهات والملفات)
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 02 لحد 13)
--
-- الفكرة:
--  1) جدول exams بياخد عمودين: section_id (القسم) وposition (الترتيب جوه القسم).
--  2) الترتيب بيتشارك مع lessons: الامتحان الجديد بياخد رقم بعد آخر عنصر (فيديو/ملف/امتحان) في القسم.
--  3) الامتحانات القديمة section_id بتاعها فاضي، فبتفضل شغالة وبتظهر تحت الدروس زي ما كانت.
--  4) لو القسم اتحذف، الامتحان مابيتحذفش: section_id بيتفضّى (on delete set null) ويرجع "من غير قسم".
--  5) الأمان ما اتغيّرش: سياسات exams وexam_questions وexam_attempts زي ما هي، والإجابات الصح للأدمن بس.
--     الدالة الوحيدة اللي اتعدّلت هي admin_save_exam (بتستقبل section_id كمان).

-- ========== 1) الأعمدة ==========
alter table public.exams
  add column if not exists section_id uuid references public.course_sections(id) on delete set null,
  add column if not exists position int not null default 0;

create index if not exists exams_section_idx on public.exams (section_id, position);

-- ========== 2) حفظ الامتحان (نفس دالة 13 + القسم والترتيب) ==========
-- p_data ممكن يحتوي section_id:
--   * موجود بقيمة   = الامتحان يتحط في القسم ده (لازم القسم يكون تابع لنفس الكورس)
--   * موجود وفاضي   = من غير قسم
--   * مش موجود خالص = نسيب القسم زي ما هو (في التعديل)
create or replace function public.admin_save_exam(p_id uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid := p_id;
  v_title   text := trim(coalesce(p_data->>'title', ''));
  v_desc    text := nullif(trim(coalesce(p_data->>'description', '')), '');
  v_qs      jsonb := coalesce(p_data->'questions', '[]'::jsonb);
  v_pub     boolean := coalesce((p_data->>'is_published')::boolean, false);
  v_course  uuid := nullif(p_data->>'course_id', '')::uuid;
  v_grade   smallint := nullif(p_data->>'grade', '')::smallint;
  v_dur     int := nullif(p_data->>'duration_minutes', '')::int;
  v_pass    int := coalesce(nullif(p_data->>'pass_percent', '')::int, 50);
  v_section uuid := nullif(p_data->>'section_id', '')::uuid;
  v_old_sec uuid;
  v_pos     int := 0;
  v_count   int;
  v_points  int;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(v_title) < 3 then
    raise exception 'bad title' using errcode = '22023';
  end if;
  if jsonb_typeof(v_qs) <> 'array' or jsonb_array_length(v_qs) > 200 then
    raise exception 'bad questions' using errcode = '22023';
  end if;
  if v_pub and jsonb_array_length(v_qs) = 0 then
    raise exception 'no questions' using errcode = '22023';
  end if;

  -- في التعديل: نعرف القسم القديم، ولو section_id مش مبعوت نسيبه زي ما هو
  if v_id is not null then
    select e.section_id into v_old_sec from public.exams e where e.id = v_id;
    if not found then
      raise exception 'exam not found' using errcode = 'P0002';
    end if;
    if not (p_data ? 'section_id') then
      v_section := v_old_sec;
    end if;
  end if;

  -- القسم لازم يكون تابع لنفس كورس الامتحان
  if v_section is not null then
    if v_course is null
       or not exists (select 1 from public.course_sections s where s.id = v_section and s.course_id = v_course) then
      raise exception 'section does not belong to course' using errcode = '22023';
    end if;
  end if;

  -- الترتيب: بعد آخر عنصر في القسم (فيديو/ملف/امتحان)، أو 0 لو من غير قسم
  if v_section is not null and (v_id is null or v_section is distinct from v_old_sec) then
    select greatest(
             coalesce((select max(l.position) from public.lessons l where l.section_id = v_section), 0),
             coalesce((select max(e.position) from public.exams e where e.section_id = v_section), 0)
           ) + 1
      into v_pos;
  end if;

  if v_id is null then
    insert into public.exams (title, description, course_id, grade, duration_minutes, pass_percent, is_published, created_by, section_id, position)
    values (v_title, v_desc, v_course, v_grade, v_dur, v_pass, v_pub, auth.uid(), v_section, v_pos)
    returning id into v_id;
  else
    update public.exams
       set title = v_title, description = v_desc, course_id = v_course, grade = v_grade,
           duration_minutes = v_dur, pass_percent = v_pass, is_published = v_pub,
           section_id = v_section,
           position = case when v_section is not distinct from v_old_sec then exams.position else v_pos end
     where id = v_id;
  end if;

  delete from public.exam_questions where exam_id = v_id;

  insert into public.exam_questions (exam_id, position, body, options, correct_index, points)
  select v_id,
         q.ord::int,
         trim(q.val->>'body'),
         array(select jsonb_array_elements_text(q.val->'options')),
         (q.val->>'correct_index')::int,
         coalesce(nullif(q.val->>'points', '')::int, 1)
    from jsonb_array_elements(v_qs) with ordinality as q(val, ord);

  select count(*), coalesce(sum(points), 0) into v_count, v_points
    from public.exam_questions where exam_id = v_id;
  update public.exams set question_count = v_count, total_points = v_points where id = v_id;

  return v_id;
end;
$$;

-- نفس الصلاحيات بتاعة 13 (بنأكّدها تاني احتياطي)
revoke all on function public.admin_save_exam(uuid, jsonb) from public, anon;
grant execute on function public.admin_save_exam(uuid, jsonb) to authenticated;
