-- صفوف المدرّس لكل مرحلة (ابتدائي 1-6، وإعدادي/ثانوي عام/أزهر/لغات 1-3) بدل الابتدائي بس
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 51_teacher_applications.sql)
--
-- بيعمل 3 حاجات:
--  1) عمود stage_grades (JSON) في طلبات التدريس: مثال {"primary":[1,2],"preparatory":[1,2,3],"secondary_general":[3]}
--  2) بينقل صفوف الابتدائي القديمة للعمود الجديد (الطلبات اللي اتقدّمت قبل كده)
--  3) بيحدّث دالة submit_teacher_application عشان تتحقق من الصفوف لكل مرحلة
--     (عمود primary_grades القديم بيفضل متعبّي لوحده من صفوف الابتدائي)

-- ========== 1) العمود الجديد ==========
alter table public.teacher_applications
  add column if not exists stage_grades jsonb not null default '{}'::jsonb;

-- ========== 2) نقل البيانات القديمة ==========
update public.teacher_applications
   set stage_grades = jsonb_build_object('primary', to_jsonb(primary_grades))
 where stage_grades = '{}'::jsonb and cardinality(primary_grades) > 0;

-- ========== 3) دالة الإرسال (نفس 51 + الصفوف لكل مرحلة) ==========
create or replace function public.submit_teacher_application(p jsonb)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_role text;
  v_old text;
  v_name text := regexp_replace(trim(coalesce(p->>'full_name', '')), '\s+', ' ', 'g');
  v_nid text := trim(coalesce(p->>'national_id', ''));
  v_phone text := trim(coalesce(p->>'phone', ''));
  v_alt text := trim(coalesce(p->>'alt_phone', ''));
  v_gov text := trim(coalesce(p->>'governorate', ''));
  v_city text := trim(coalesce(p->>'city', ''));
  v_qual text := trim(coalesce(p->>'qualification', ''));
  v_year int;
  v_spec text := trim(coalesce(p->>'specialization', ''));
  v_post text := nullif(trim(coalesce(p->>'postgraduate', '')), '');
  v_exp text := coalesce(p->>'experience_range', '');
  v_work text := nullif(trim(coalesce(p->>'previous_workplaces', '')), '');
  v_subjects text := trim(coalesce(p->>'subjects', ''));
  v_stages text[];
  v_sg jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_stage text;
  v_max int;
  v_grades_raw text[];
  v_grades smallint[];
  v_prim smallint[] := '{}';
  v_cv text := coalesce(p->>'cv_path', '');
  v_photo text := coalesce(p->>'photo_path', '');
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role = 'teacher' then raise exception 'already_approved' using errcode = '22023'; end if;
  if v_role is distinct from 'student' then raise exception 'not_student' using errcode = '42501'; end if;

  select status into v_old from public.teacher_applications where user_id = v_uid;
  if v_old = 'approved' then raise exception 'already_approved' using errcode = '22023'; end if;

  select email into v_email from auth.users where id = v_uid;

  -- الاسم: ثلاث كلمات على الأقل
  if char_length(v_name) < 8 or char_length(v_name) > 100 or array_length(string_to_array(v_name, ' '), 1) < 3 then
    raise exception 'bad_name' using errcode = '22023';
  end if;

  -- الرقم القومي: 14 رقم + تاريخ ميلاد صحيح
  if v_nid !~ '^[23][0-9]{13}$' then raise exception 'bad_national_id' using errcode = '22023'; end if;
  begin
    perform make_date(
      (case when left(v_nid, 1) = '2' then 1900 else 2000 end) + substr(v_nid, 2, 2)::int,
      substr(v_nid, 4, 2)::int,
      substr(v_nid, 6, 2)::int);
  exception when others then
    raise exception 'bad_national_id' using errcode = '22023';
  end;
  if exists (select 1 from public.teacher_applications where national_id = v_nid and user_id <> v_uid) then
    raise exception 'national_id_taken' using errcode = '23505';
  end if;

  -- الهواتف: موبايل مصري، ومختلفين عن بعض
  if v_phone !~ '^01[0125][0-9]{8}$' or v_alt !~ '^01[0125][0-9]{8}$' or v_phone = v_alt then
    raise exception 'bad_phone' using errcode = '22023';
  end if;

  if char_length(v_gov) not between 2 and 40 or char_length(v_city) not between 2 and 80 then
    raise exception 'bad_location' using errcode = '22023';
  end if;
  if char_length(v_qual) not between 3 and 200 or char_length(v_spec) not between 2 and 100 then
    raise exception 'bad_qualification' using errcode = '22023';
  end if;
  if coalesce(p->>'graduation_year', '') !~ '^[0-9]{4}$' then raise exception 'bad_year' using errcode = '22023'; end if;
  v_year := (p->>'graduation_year')::int;
  if v_year < 1970 or v_year > extract(year from now())::int then raise exception 'bad_year' using errcode = '22023'; end if;

  if v_post is not null and char_length(v_post) > 500 then raise exception 'bad_postgraduate' using errcode = '22023'; end if;
  if v_work is not null and char_length(v_work) > 1000 then raise exception 'bad_workplaces' using errcode = '22023'; end if;
  if v_exp not in ('lt1', '1_3', '3_5', 'gt5') then raise exception 'bad_experience' using errcode = '22023'; end if;
  if char_length(v_subjects) not between 2 and 200 then raise exception 'bad_subjects' using errcode = '22023'; end if;

  -- المراحل
  if jsonb_typeof(p->'stages') is distinct from 'array' then raise exception 'bad_stages' using errcode = '22023'; end if;
  v_stages := array(select distinct x from jsonb_array_elements_text(p->'stages') x order by x);
  if cardinality(v_stages) = 0
     or not (v_stages <@ array['primary', 'preparatory', 'secondary_general', 'secondary_azhar', 'secondary_languages', 'university']) then
    raise exception 'bad_stages' using errcode = '22023';
  end if;

  -- الصفوف لكل مرحلة: ابتدائي 1-6، إعدادي/ثانوي (عام/أزهر/لغات) 1-3، والجامعي مالوش صفوف.
  -- كل مرحلة مختارة (غير الجامعي) لازم يكون ليها صف واحد على الأقل.
  v_sg := coalesce(p->'stage_grades', '{}'::jsonb);
  if jsonb_typeof(v_sg) is distinct from 'object' then raise exception 'bad_grades' using errcode = '22023'; end if;
  -- توافق مع النسخة القديمة من الفورم (كانت بتبعت primary_grades بس)
  if not (v_sg ? 'primary') and jsonb_typeof(p->'primary_grades') = 'array' and jsonb_array_length(p->'primary_grades') > 0 then
    v_sg := v_sg || jsonb_build_object('primary', p->'primary_grades');
  end if;

  foreach v_stage in array v_stages loop
    v_max := case v_stage when 'primary' then 6 when 'university' then 0 else 3 end;
    if v_max = 0 then continue; end if;

    if jsonb_typeof(v_sg -> v_stage) is distinct from 'array' then raise exception 'bad_grades' using errcode = '22023'; end if;
    v_grades_raw := array(select x from jsonb_array_elements_text(v_sg -> v_stage) x);
    -- كل قيمة لازم تكون رقم من 1 لحد الحد الأقصى للمرحلة
    if exists (
      select 1 from unnest(v_grades_raw) g
      where g !~ '^[1-9]$' or (case when g ~ '^[1-9]$' then g::int else 0 end) > v_max
    ) then
      raise exception 'bad_grades' using errcode = '22023';
    end if;
    v_grades := array(select distinct g::smallint from unnest(v_grades_raw) g order by 1);
    if cardinality(v_grades) = 0 then raise exception 'bad_grades' using errcode = '22023'; end if;

    v_clean := v_clean || jsonb_build_object(v_stage, to_jsonb(v_grades));
    if v_stage = 'primary' then v_prim := v_grades; end if;
  end loop;

  -- الملفات: لازم تكون مرفوعة فعلاً في فولدر المستخدم نفسه وبالأسماء الثابتة
  if v_cv <> v_uid::text || '/cv.pdf' or v_photo !~ ('^' || v_uid::text || '/photo\.(jpg|png|webp)$')
     or not exists (select 1 from storage.objects where bucket_id = 'teacher-applications' and name = v_cv)
     or not exists (select 1 from storage.objects where bucket_id = 'teacher-applications' and name = v_photo) then
    raise exception 'bad_files' using errcode = '22023';
  end if;

  insert into public.teacher_applications (
    user_id, full_name, national_id, phone, alt_phone, email, governorate, city, qualification,
    graduation_year, specialization, postgraduate, experience_range, previous_workplaces, subjects,
    stages, primary_grades, stage_grades, cv_path, photo_path
  ) values (
    v_uid, v_name, v_nid, v_phone, v_alt, coalesce(v_email, ''), v_gov, v_city, v_qual,
    v_year, v_spec, v_post, v_exp, v_work, v_subjects,
    v_stages, v_prim, v_clean, v_cv, v_photo
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name, national_id = excluded.national_id, phone = excluded.phone,
    alt_phone = excluded.alt_phone, email = excluded.email, governorate = excluded.governorate,
    city = excluded.city, qualification = excluded.qualification, graduation_year = excluded.graduation_year,
    specialization = excluded.specialization, postgraduate = excluded.postgraduate,
    experience_range = excluded.experience_range, previous_workplaces = excluded.previous_workplaces,
    subjects = excluded.subjects, stages = excluded.stages, primary_grades = excluded.primary_grades,
    stage_grades = excluded.stage_grades,
    cv_path = excluded.cv_path, photo_path = excluded.photo_path,
    -- إعادة التقديم بعد الرفض بترجع الطلب للمراجعة
    status = 'pending', admin_note = null, reviewed_by = null, reviewed_at = null, updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_teacher_application(jsonb) from public, anon;
grant execute on function public.submit_teacher_application(jsonb) to authenticated;
