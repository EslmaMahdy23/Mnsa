-- الخطوة 16: قفل أقسام الكورس (القسم بيتفتح بس بعد النجاح في امتحان القسم اللي قبله)
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 02 لحد 15)
--
-- القاعدة:
--  1) القسم الأول دايماً مفتوح.
--  2) أي قسم بعده بيتفتح لما الطالب ينجح في كل امتحانات الأقسام اللي قبله (الامتحانات المنشورة اللي فيها أسئلة).
--     لو القسم اللي قبله مفيهوش امتحان، مفيش حاجة بتمنع.
--  3) الأدمن ومدرّس الكورس مفيش عليهم قفل.
--  4) القفل بيتطبق في الداتابيز نفسها (RLS): فيديوهات وملفات القسم المقفول مش بتتبعت للطالب أصلاً،
--     وكمان start_exam بترفض امتحان جوه قسم مقفول (كود الخطأ EH002).
--  5) دروس المعاينة المجانية (is_free_preview) بتفضل مفتوحة زي ما هي.
--  6) الامتحانات اللي من غير قسم (القديمة) ما اتغيّرش فيها حاجة.
--
-- تنبيه: كل طالب له محاولة واحدة في الامتحان (من ملف 13). لو طالب سقط، القسم اللي بعده هيفضل مقفول
-- لحد ما الأدمن يمسح محاولته من جدول exam_attempts (وده اللي بيسمحله يعيد).

-- ========== 1) هل القسم مفتوح للمستخدم الحالي؟ ==========
-- الترتيب بين الأقسام: position ثم تاريخ الإنشاء ثم id (لأن الأقسام القديمة كلها position = 1)
create or replace function public.is_section_unlocked(p_section uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select
    (select public.is_admin())
    or exists (
      select 1 from public.course_sections s
      join public.courses c on c.id = s.course_id
      where s.id = p_section and c.teacher_id = (select auth.uid())
    )
    or not exists (
      select 1
      from public.course_sections s
      join public.course_sections prev
        on prev.course_id = s.course_id
       and (prev.position, prev.created_at, prev.id) < (s.position, s.created_at, s.id)
      join public.exams e
        on e.section_id = prev.id and e.is_published and e.question_count > 0
      where s.id = p_section
        and not exists (
          select 1 from public.exam_attempts a
          where a.exam_id = e.id and a.user_id = (select auth.uid()) and a.passed is true
        )
    );
$$;

-- ========== 2) حالة قفل كل أقسام كورس (للواجهة) ==========
-- بترجّع صف لكل قسم: locked + أول امتحان ناقص نجاح (عشان نكتب للطالب يعمل إيه)
create or replace function public.get_course_section_locks(p_course uuid)
returns table (section_id uuid, locked boolean, blocking_exam_id uuid, blocking_exam_title text)
language sql security definer stable set search_path = public as $$
  select s.id, (b.id is not null), b.id, b.title
  from public.course_sections s
  join public.courses c on c.id = s.course_id
  left join lateral (
    select e.id, e.title
    from public.course_sections prev
    join public.exams e on e.section_id = prev.id and e.is_published and e.question_count > 0
    where prev.course_id = s.course_id
      and (prev.position, prev.created_at, prev.id) < (s.position, s.created_at, s.id)
      and not exists (
        select 1 from public.exam_attempts a
        where a.exam_id = e.id and a.user_id = (select auth.uid()) and a.passed is true
      )
    order by prev.position, prev.created_at, prev.id, e.position, e.created_at
    limit 1
  ) b on not (
    (select public.is_admin()) or c.teacher_id = (select auth.uid())
  )
  where s.course_id = p_course
    and (c.is_published or c.teacher_id = (select auth.uid()) or (select public.is_admin()))
  order by s.position, s.created_at, s.id;
$$;

-- ========== 3) سياسة قراءة الدروس: المسجّل يشوف بس دروس الأقسام المفتوحة ==========
drop policy if exists "lessons read" on public.lessons;
create policy "lessons read" on public.lessons for select
  using (exists (
    select 1 from public.courses c
    where c.id = lessons.course_id
      and (
        c.teacher_id = (select auth.uid()) or (select public.is_admin())
        or (c.is_published and (
          lessons.is_free_preview
          or (
            exists (select 1 from public.enrollments e
                    where e.course_id = c.id and e.user_id = (select auth.uid()))
            and public.is_section_unlocked(lessons.section_id)
          )
        ))
      )
  ));

-- ========== 4) بدء الامتحان (نفس دالة 13 + رفض الامتحان لو قسمه مقفول) ==========
-- أكواد الأخطاء: P0002 = الامتحان مش متاح | 23505 = اتحلّ قبل كده أو الوقت خلص | EH002 = القسم مقفول
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

  if v_exam.section_id is not null and not public.is_section_unlocked(v_exam.section_id) then
    raise exception 'section locked' using errcode = 'EH002';
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

-- ========== 5) الصلاحيات ==========
revoke all on function public.is_section_unlocked(uuid) from public, anon;
revoke all on function public.get_course_section_locks(uuid) from public, anon;
revoke all on function public.start_exam(uuid) from public, anon;

grant execute on function public.is_section_unlocked(uuid) to authenticated;
grant execute on function public.get_course_section_locks(uuid) to authenticated;
grant execute on function public.start_exam(uuid) to authenticated;
