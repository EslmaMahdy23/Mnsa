-- الخطوة 13: الامتحانات (الأدمن يعملها، الطالب يحلّها، والنتيجة تظهر في حسابه)
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 02 لحد 12)
--
-- فكرة الأمان:
--  1) الأسئلة وإجاباتها الصح (exam_questions) الأدمن بس هو اللي يقرأها من الموقع.
--     الطالب بياخد الأسئلة من دالة start_exam من غير الإجابات الصح.
--  2) التصحيح بيتم هنا في الداتابيز (دالة submit_exam)، فالطالب مايقدرش يعدّل درجته.
--  3) كل طالب له محاولة واحدة في كل امتحان. الأدمن يقدر يمسح المحاولة عشان يسمحله يعيد.
--  4) لو الامتحان له وقت، الداتابيز بتحسب الوقت من عندها (مش من ساعة جهاز الطالب).

-- ========== 1) الجداول ==========
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 200),
  description text,
  course_id uuid references public.courses(id) on delete set null, -- فاضي = متاح لأي طالب
  grade smallint check (grade is null or grade between 1 and 9),   -- فاضي = كل السنوات
  duration_minutes int check (duration_minutes is null or duration_minutes between 1 and 600), -- فاضي = من غير وقت
  pass_percent int not null default 50 check (pass_percent between 0 and 100),
  is_published boolean not null default false,
  question_count int not null default 0,
  total_points int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists exams_pub_idx on public.exams (is_published, created_at desc);
create index if not exists exams_course_idx on public.exams (course_id);

create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  position int not null default 0,
  body text not null check (char_length(trim(body)) > 0),
  options text[] not null check (array_length(options, 1) between 2 and 6),
  correct_index int not null check (correct_index >= 0),
  points int not null default 1 check (points between 1 and 100),
  check (correct_index < array_length(options, 1))
);
create index if not exists exam_questions_exam_idx on public.exam_questions (exam_id, position);

-- النتيجة بتفضل محفوظة حتى لو الامتحان اتحذف (عشان كده exam_id بيتفضّى واسم الامتحان متخزّن)
create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references public.exams(id) on delete set null,
  exam_title text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score int,
  total int,
  percent int,
  passed boolean,
  unique (exam_id, user_id)
);
create index if not exists exam_attempts_user_idx on public.exam_attempts (user_id, submitted_at desc);
create index if not exists exam_attempts_exam_idx on public.exam_attempts (exam_id, started_at desc);

-- ========== 2) الأمان (RLS) ==========
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_attempts enable row level security;

-- الامتحان المنشور يظهر للطالب (ولو مربوط بكورس، لازم يكون مشترك فيه). الأدمن يشوف كله.
drop policy if exists "exams read" on public.exams;
create policy "exams read" on public.exams for select
  using (
    (select public.is_admin())
    or (is_published and (
      course_id is null
      or exists (select 1 from public.enrollments e
                 where e.course_id = exams.course_id and e.user_id = (select auth.uid()))
    ))
  );

-- التعديل والحذف من الأدمن بس (الإضافة والحفظ الكامل بيتم من دالة admin_save_exam)
drop policy if exists "exams update" on public.exams;
create policy "exams update" on public.exams for update
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "exams delete" on public.exams;
create policy "exams delete" on public.exams for delete
  using ((select public.is_admin()));

-- الأسئلة مع الإجابات الصح: الأدمن يقرأ بس. الكتابة من الدالة بس.
drop policy if exists "questions admin read" on public.exam_questions;
create policy "questions admin read" on public.exam_questions for select
  using ((select public.is_admin()));

-- المحاولات: الطالب يشوف بتاعته، والأدمن يشوف الكل ويقدر يمسح محاولة (يسمح بإعادة الامتحان)
drop policy if exists "attempts read" on public.exam_attempts;
create policy "attempts read" on public.exam_attempts for select
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "attempts admin delete" on public.exam_attempts;
create policy "attempts admin delete" on public.exam_attempts for delete
  using ((select public.is_admin()));

-- مفيش أي إضافة أو تعديل مباشر في الأسئلة والمحاولات من الموقع، والإضافة في exams من الدالة بس
revoke insert on public.exams from anon, authenticated;
revoke insert, update, delete on public.exam_questions from anon, authenticated;
revoke insert, update on public.exam_attempts from anon, authenticated;

-- ========== 3) الأدمن: حفظ امتحان كامل (بياناته + أسئلته) في عملية واحدة ==========
-- p_id فاضي = امتحان جديد. الأسئلة بتتستبدل كلها بالقايمة المبعوتة.
create or replace function public.admin_save_exam(p_id uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := p_id;
  v_title  text := trim(coalesce(p_data->>'title', ''));
  v_desc   text := nullif(trim(coalesce(p_data->>'description', '')), '');
  v_qs     jsonb := coalesce(p_data->'questions', '[]'::jsonb);
  v_pub    boolean := coalesce((p_data->>'is_published')::boolean, false);
  v_course uuid := nullif(p_data->>'course_id', '')::uuid;
  v_grade  smallint := nullif(p_data->>'grade', '')::smallint;
  v_dur    int := nullif(p_data->>'duration_minutes', '')::int;
  v_pass   int := coalesce(nullif(p_data->>'pass_percent', '')::int, 50);
  v_count  int;
  v_points int;
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

  if v_id is null then
    insert into public.exams (title, description, course_id, grade, duration_minutes, pass_percent, is_published, created_by)
    values (v_title, v_desc, v_course, v_grade, v_dur, v_pass, v_pub, auth.uid())
    returning id into v_id;
  else
    update public.exams
       set title = v_title, description = v_desc, course_id = v_course, grade = v_grade,
           duration_minutes = v_dur, pass_percent = v_pass, is_published = v_pub
     where id = v_id;
    if not found then
      raise exception 'exam not found' using errcode = 'P0002';
    end if;
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

-- ========== 4) الطالب: بدء الامتحان (بيرجّع الأسئلة من غير الإجابات الصح) ==========
-- أكواد الأخطاء: P0002 = الامتحان مش متاح | 23505 = اتحلّ قبل كده أو الوقت خلص
create or replace function public.start_exam(p_exam uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_exam public.exams%rowtype;
  v_att  public.exam_attempts%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_exam from public.exams e
   where e.id = p_exam and e.is_published
     and (e.course_id is null
          or exists (select 1 from public.enrollments en where en.course_id = e.course_id and en.user_id = v_user));
  if not found then
    raise exception 'exam not available' using errcode = 'P0002';
  end if;

  select * into v_att from public.exam_attempts where exam_id = p_exam and user_id = v_user;
  if not found then
    insert into public.exam_attempts (exam_id, exam_title, user_id)
    values (p_exam, v_exam.title, v_user)
    on conflict (exam_id, user_id) do nothing;
    select * into v_att from public.exam_attempts where exam_id = p_exam and user_id = v_user;
  end if;

  if v_att.submitted_at is not null then
    raise exception 'already submitted' using errcode = '23505';
  end if;

  -- محاولة مفتوحة والوقت خلص (قفل التاب ومارجعش): نقفلها بصفر
  if v_exam.duration_minutes is not null
     and now() > v_att.started_at + make_interval(mins => v_exam.duration_minutes) + interval '2 minutes' then
    update public.exam_attempts
       set submitted_at = now(), score = 0, total = v_exam.total_points, percent = 0, passed = false
     where id = v_att.id;
    raise exception 'time is over' using errcode = '23505';
  end if;

  return json_build_object(
    'attempt_id', v_att.id,
    'title', v_exam.title,
    'started_at', v_att.started_at,
    'server_now', now(),
    'duration_minutes', v_exam.duration_minutes,
    'questions', coalesce((
      select json_agg(json_build_object('id', q.id, 'body', q.body, 'options', to_json(q.options), 'points', q.points)
                      order by q.position)
        from public.exam_questions q where q.exam_id = v_exam.id
    ), '[]'::json)
  );
end;
$$;

-- ========== 5) الطالب: تسليم الإجابات (التصحيح هنا) ==========
-- p_answers شكلها: {"<question_id>": رقم الاختيار (من 0)}
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

  -- مهلة دقيقتين زيادة عن الوقت (لتأخير الشبكة). بعد كده الإجابات بتتتجاهل.
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

  return json_build_object('score', v_score, 'total', v_total, 'percent', v_pct, 'passed', v_pass, 'late', v_late);
end;
$$;

-- ========== 6) الصلاحيات ==========
revoke all on function public.admin_save_exam(uuid, jsonb) from public, anon;
revoke all on function public.start_exam(uuid) from public, anon;
revoke all on function public.submit_exam(uuid, jsonb) from public, anon;

grant execute on function public.admin_save_exam(uuid, jsonb) to authenticated;
grant execute on function public.start_exam(uuid) to authenticated;
grant execute on function public.submit_exam(uuid, jsonb) to authenticated;
