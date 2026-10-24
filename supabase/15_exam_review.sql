-- الخطوة 15: مراجعة الامتحان بعد التسليم
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 02 لحد 14)
--
-- الأدمن بيختار لكل امتحان (وهو بيعمله) الطالب يشوف إيه بعد التسليم:
--   none  = النسبة والدرجة بس (زي دلوقتي، وده الافتراضي لكل الامتحانات الحالية)
--   marks = يشوف إجاباته وكل سؤال صح ولا غلط، من غير ما يعرف الإجابة الصح
--   full  = يشوف إجاباته + الإجابة الصح + شرح السؤال (لو الأدمن كتب شرح)
--
-- فكرة الأمان:
--  1) إجابات الطالب ونسخة من الأسئلة (بالإجابات الصح) بتتخزّن في جدول منفصل exam_attempt_details
--     اللي مفيش عليه أي صلاحية للطالب خالص (RLS من غير سياسات + سحب كل الصلاحيات).
--  2) الطالب مايوصلش للتفاصيل غير من دالة get_exam_review، وهي بتتأكد إن المحاولة بتاعته وإنها اتسلّمت،
--     وبترجّع الإجابة الصح والشرح بس لو وضع المراجعة "full".
--  3) النسخة المتخزّنة بتحمي المراجعة لو الأدمن عدّل الأسئلة أو الإجابات بعد ما الطالب سلّم.
--  4) المحاولات اللي اتسلّمت قبل تشغيل الملف ده ما فيهاش تفاصيل، فمفيش مراجعة ليها (النسبة بتفضل زي ما هي).

-- ========== 1) الأعمدة والجدول ==========
alter table public.exams add column if not exists review_mode text not null default 'none';
alter table public.exams drop constraint if exists exams_review_mode_check;
alter table public.exams add constraint exams_review_mode_check check (review_mode in ('none', 'marks', 'full'));

alter table public.exam_questions add column if not exists explanation text;

create table if not exists public.exam_attempt_details (
  attempt_id uuid primary key references public.exam_attempts(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,   -- {"<question_id>": رقم الاختيار}
  snapshot jsonb not null default '[]'::jsonb,  -- نسخة الأسئلة وقت التسليم (فيها الإجابة الصح)
  created_at timestamptz not null default now()
);
alter table public.exam_attempt_details enable row level security;
revoke all on public.exam_attempt_details from anon, authenticated;

-- ========== 2) الأدمن: حفظ امتحان (نفس دالة 14 + وضع المراجعة + شرح الأسئلة) ==========
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
  v_review  text := coalesce(nullif(p_data->>'review_mode', ''), 'none');
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
  if v_review not in ('none', 'marks', 'full') then
    raise exception 'bad review mode' using errcode = '22023';
  end if;
  if jsonb_typeof(v_qs) <> 'array' or jsonb_array_length(v_qs) > 200 then
    raise exception 'bad questions' using errcode = '22023';
  end if;
  if v_pub and jsonb_array_length(v_qs) = 0 then
    raise exception 'no questions' using errcode = '22023';
  end if;

  if v_id is not null then
    select e.section_id into v_old_sec from public.exams e where e.id = v_id;
    if not found then
      raise exception 'exam not found' using errcode = 'P0002';
    end if;
    if not (p_data ? 'section_id') then
      v_section := v_old_sec;
    end if;
  end if;

  if v_section is not null then
    if v_course is null
       or not exists (select 1 from public.course_sections s where s.id = v_section and s.course_id = v_course) then
      raise exception 'section does not belong to course' using errcode = '22023';
    end if;
  end if;

  if v_section is not null and (v_id is null or v_section is distinct from v_old_sec) then
    select greatest(
             coalesce((select max(l.position) from public.lessons l where l.section_id = v_section), 0),
             coalesce((select max(e.position) from public.exams e where e.section_id = v_section), 0)
           ) + 1
      into v_pos;
  end if;

  if v_id is null then
    insert into public.exams (title, description, course_id, grade, duration_minutes, pass_percent, is_published, created_by, section_id, position, review_mode)
    values (v_title, v_desc, v_course, v_grade, v_dur, v_pass, v_pub, auth.uid(), v_section, v_pos, v_review)
    returning id into v_id;
  else
    update public.exams
       set title = v_title, description = v_desc, course_id = v_course, grade = v_grade,
           duration_minutes = v_dur, pass_percent = v_pass, is_published = v_pub,
           section_id = v_section, review_mode = v_review,
           position = case when v_section is not distinct from v_old_sec then exams.position else v_pos end
     where id = v_id;
  end if;

  delete from public.exam_questions where exam_id = v_id;

  insert into public.exam_questions (exam_id, position, body, options, correct_index, points, explanation)
  select v_id,
         q.ord::int,
         trim(q.val->>'body'),
         array(select jsonb_array_elements_text(q.val->'options')),
         (q.val->>'correct_index')::int,
         coalesce(nullif(q.val->>'points', '')::int, 1),
         nullif(trim(coalesce(q.val->>'explanation', '')), '')
    from jsonb_array_elements(v_qs) with ordinality as q(val, ord);

  select count(*), coalesce(sum(points), 0) into v_count, v_points
    from public.exam_questions where exam_id = v_id;
  update public.exams set question_count = v_count, total_points = v_points where id = v_id;

  return v_id;
end;
$$;

-- ========== 3) الطالب: تسليم الإجابات (نفس دالة 13 + حفظ الإجابات ونسخة الأسئلة) ==========
create or replace function public.submit_exam(p_attempt uuid, p_answers jsonb)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_att   public.exam_attempts%rowtype;
  v_exam  public.exams%rowtype;
  v_late  boolean;
  v_ans   jsonb := case when jsonb_typeof(p_answers) = 'object' then p_answers else '{}'::jsonb end;
  v_score int;
  v_total int;
  v_pct   int;
  v_pass  boolean;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_att from public.exam_attempts where id = p_attempt and user_id = v_user for update;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;
  if v_att.submitted_at is not null then
    raise exception 'already submitted' using errcode = '23505';
  end if;

  select * into v_exam from public.exams where id = v_att.exam_id;
  if not found then
    raise exception 'exam not found' using errcode = 'P0002';
  end if;

  v_late := v_exam.duration_minutes is not null
            and now() > v_att.started_at + make_interval(mins => v_exam.duration_minutes) + interval '2 minutes';

  select coalesce(sum(q.points), 0),
         coalesce(sum(case when not v_late and (v_ans ->> q.id::text) = q.correct_index::text then q.points else 0 end), 0)
    into v_total, v_score
    from public.exam_questions q where q.exam_id = v_exam.id;

  v_pct  := case when v_total = 0 then 0 else round(v_score * 100.0 / v_total)::int end;
  v_pass := v_pct >= v_exam.pass_percent;

  update public.exam_attempts
     set submitted_at = now(), score = v_score, total = v_total, percent = v_pct, passed = v_pass
   where id = v_att.id;

  -- تفاصيل المراجعة: الإجابات (أرقام صحيحة بس، ولو متأخر مفيش إجابات اتحسبت) + نسخة الأسئلة
  insert into public.exam_attempt_details (attempt_id, answers, snapshot)
  select v_att.id,
         case when v_late then '{}'::jsonb
              else coalesce((
                select jsonb_object_agg(q.id::text, to_jsonb((v_ans ->> q.id::text)::int))
                  from public.exam_questions q
                 where q.exam_id = v_exam.id
                   and (v_ans ->> q.id::text) ~ '^(0|[1-9][0-9]{0,2})$'
              ), '{}'::jsonb)
         end,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', q.id, 'body', q.body, 'options', to_jsonb(q.options),
                    'correct_index', q.correct_index, 'points', q.points, 'explanation', q.explanation)
                  order by q.position)
             from public.exam_questions q where q.exam_id = v_exam.id
         ), '[]'::jsonb)
  on conflict (attempt_id) do nothing;

  return json_build_object('score', v_score, 'total', v_total, 'percent', v_pct, 'passed', v_pass, 'late', v_late);
end;
$$;

-- ========== 4) الطالب: مراجعة محاولته (حسب وضع المراجعة اللي الأدمن اختاره) ==========
-- بترجّع {"mode":"none"} لو مفيش مراجعة. وفي "marks" مابترجّعش الإجابة الصح ولا الشرح خالص.
create or replace function public.get_exam_review(p_attempt uuid)
returns json
language plpgsql security definer stable set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_att  public.exam_attempts%rowtype;
  v_mode text;
  v_det  public.exam_attempt_details%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_att from public.exam_attempts where id = p_attempt and user_id = v_user;
  if not found or v_att.submitted_at is null then
    raise exception 'attempt not found' using errcode = 'P0002';
  end if;

  select e.review_mode into v_mode from public.exams e where e.id = v_att.exam_id;
  if not found or v_mode is null or v_mode = 'none' then
    return json_build_object('mode', 'none');
  end if;

  select * into v_det from public.exam_attempt_details where attempt_id = p_attempt;
  if not found then
    return json_build_object('mode', 'none');
  end if;

  return json_build_object('mode', v_mode, 'questions', coalesce((
    select json_agg(
      case when v_mode = 'full' then
        json_build_object(
          'body', q.val->>'body',
          'options', q.val->'options',
          'points', (q.val->>'points')::int,
          'my_index', (v_det.answers ->> (q.val->>'id'))::int,
          'is_correct', coalesce((v_det.answers ->> (q.val->>'id')) = (q.val->>'correct_index'), false),
          'correct_index', (q.val->>'correct_index')::int,
          'explanation', q.val->>'explanation')
      else
        json_build_object(
          'body', q.val->>'body',
          'options', q.val->'options',
          'points', (q.val->>'points')::int,
          'my_index', (v_det.answers ->> (q.val->>'id'))::int,
          'is_correct', coalesce((v_det.answers ->> (q.val->>'id')) = (q.val->>'correct_index'), false))
      end
      order by q.ord)
    from jsonb_array_elements(v_det.snapshot) with ordinality as q(val, ord)
  ), '[]'::json));
end;
$$;

-- ========== 5) الصلاحيات ==========
revoke all on function public.admin_save_exam(uuid, jsonb) from public, anon;
revoke all on function public.submit_exam(uuid, jsonb) from public, anon;
revoke all on function public.get_exam_review(uuid) from public, anon;

grant execute on function public.admin_save_exam(uuid, jsonb) to authenticated;
grant execute on function public.submit_exam(uuid, jsonb) to authenticated;
grant execute on function public.get_exam_review(uuid) to authenticated;
