-- طلبات التدريس (تسجيل المدرّس): جدول الطلبات + مخزن ملفات خاص + دوال الإرسال والمراجعة
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 50_exam_leaderboard.sql)
--
-- الفكرة:
--  * المدرّس بيعمل حساب عادي (دور student زي أي تسجيل)، وبيتسجّل له طلب تدريس بحالة pending.
--  * الأدمن بس هو اللي يوافق، وساعتها دور الحساب بيتحوّل لـ teacher. محدّش يرقّي نفسه.
--  * الرقم القومي والسيرة الذاتية والصورة بيانات حساسة: مفيش حد يقراها غير صاحب الطلب والأدمن،
--    والكتابة بتتم من خلال الدالة submit_teacher_application بس (مفيش insert/update مباشر).

-- ========== 1) الجدول ==========
create table if not exists public.teacher_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  national_id text not null,
  phone text not null,
  alt_phone text not null,
  email text not null,
  governorate text not null,
  city text not null,
  qualification text not null,
  graduation_year smallint not null,
  specialization text not null,
  postgraduate text,
  experience_range text not null,
  previous_workplaces text,
  subjects text not null,
  stages text[] not null,
  primary_grades smallint[] not null default '{}',
  cv_path text not null,
  photo_path text not null,
  status text not null default 'pending',
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_applications_status_check check (status in ('pending','approved','rejected')),
  constraint teacher_applications_experience_check check (experience_range in ('lt1','1_3','3_5','gt5')),
  constraint teacher_applications_nid_check check (national_id ~ '^[23][0-9]{13}$')
);

-- الرقم القومي مايتكررش بين حسابين
create unique index if not exists teacher_applications_national_id_key on public.teacher_applications (national_id);
create index if not exists teacher_applications_status_idx on public.teacher_applications (status, created_at desc);

-- ========== 2) الصلاحيات (RLS) ==========
alter table public.teacher_applications enable row level security;
revoke all on public.teacher_applications from anon, authenticated;
grant select on public.teacher_applications to authenticated;

drop policy if exists "teacher applications read" on public.teacher_applications;
create policy "teacher applications read" on public.teacher_applications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
-- مفيش سياسات insert/update/delete عن قصد: الكتابة بتتم من الدوال تحت بس

-- ========== 3) مخزن الملفات (خاص) ==========
-- السيرة الذاتية: PDF، الصورة: JPG/PNG/WEBP، الحد 5 ميجا للملف (والواجهة بتحدّ الصورة بـ 3)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('teacher-applications', 'teacher-applications', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- كل مستخدم يرفع ويقرا ملفاته هو بس (جوه فولدر باسم id بتاعه)، والأدمن يقرا الكل. مفيش حذف.
drop policy if exists "teacher app files insert" on storage.objects;
create policy "teacher app files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'teacher-applications' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "teacher app files update" on storage.objects;
create policy "teacher app files update" on storage.objects for update to authenticated
  using (bucket_id = 'teacher-applications' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'teacher-applications' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "teacher app files read" on storage.objects;
create policy "teacher app files read" on storage.objects for select to authenticated
  using (bucket_id = 'teacher-applications'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));

-- ========== 4) إرسال الطلب (صاحب الحساب بس) ==========
-- بترجّع id الطلب. أكواد الأخطاء نصوص ثابتة بتتحوّل لرسائل عربي في الواجهة.
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
  v_grades_raw text[];
  v_grades smallint[];
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

  -- صفوف الابتدائي (لو اختار ابتدائي لازم يحدد صف على الأقل)
  v_grades_raw := array(select x from jsonb_array_elements_text(coalesce(p->'primary_grades', '[]'::jsonb)) x);
  if exists (select 1 from unnest(v_grades_raw) g where g !~ '^[1-6]$') then raise exception 'bad_grades' using errcode = '22023'; end if;
  v_grades := array(select distinct g::smallint from unnest(v_grades_raw) g order by 1);
  if 'primary' = any(v_stages) then
    if cardinality(v_grades) = 0 then raise exception 'bad_grades' using errcode = '22023'; end if;
  else
    v_grades := '{}';
  end if;

  -- الملفات: لازم تكون مرفوعة فعلاً في فولدر المستخدم نفسه وبالأسماء الثابتة
  if v_cv <> v_uid::text || '/cv.pdf' or v_photo !~ ('^' || v_uid::text || '/photo\.(jpg|png|webp)$')
     or not exists (select 1 from storage.objects where bucket_id = 'teacher-applications' and name = v_cv)
     or not exists (select 1 from storage.objects where bucket_id = 'teacher-applications' and name = v_photo) then
    raise exception 'bad_files' using errcode = '22023';
  end if;

  insert into public.teacher_applications (
    user_id, full_name, national_id, phone, alt_phone, email, governorate, city, qualification,
    graduation_year, specialization, postgraduate, experience_range, previous_workplaces, subjects,
    stages, primary_grades, cv_path, photo_path
  ) values (
    v_uid, v_name, v_nid, v_phone, v_alt, coalesce(v_email, ''), v_gov, v_city, v_qual,
    v_year, v_spec, v_post, v_exp, v_work, v_subjects,
    v_stages, v_grades, v_cv, v_photo
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name, national_id = excluded.national_id, phone = excluded.phone,
    alt_phone = excluded.alt_phone, email = excluded.email, governorate = excluded.governorate,
    city = excluded.city, qualification = excluded.qualification, graduation_year = excluded.graduation_year,
    specialization = excluded.specialization, postgraduate = excluded.postgraduate,
    experience_range = excluded.experience_range, previous_workplaces = excluded.previous_workplaces,
    subjects = excluded.subjects, stages = excluded.stages, primary_grades = excluded.primary_grades,
    cv_path = excluded.cv_path, photo_path = excluded.photo_path,
    -- إعادة التقديم بعد الرفض بترجع الطلب للمراجعة
    status = 'pending', admin_note = null, reviewed_by = null, reviewed_at = null, updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ========== 5) مراجعة الأدمن (قبول / رفض) ==========
-- القبول بيحوّل دور الحساب من student لـ teacher. الرفض ما بيغيّرش الدور.
-- طلب مقبول مايتغيّرش من هنا (سحب صلاحية المدرّس بيتم يدوي من إدارة المستخدمين).
create or replace function public.admin_review_teacher_application(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid;
  v_old text;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'bad_status' using errcode = '22023'; end if;

  select user_id, status into v_user, v_old from public.teacher_applications where id = p_id for update;
  if not found then raise exception 'application not found' using errcode = 'P0002'; end if;
  if v_old = 'approved' then raise exception 'already_approved' using errcode = '22023'; end if;

  update public.teacher_applications
     set status = p_status,
         admin_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         updated_at = now()
   where id = p_id;

  if p_status = 'approved' then
    update public.profiles set role = 'teacher' where id = v_user and role = 'student';
  end if;
end;
$$;

revoke all on function public.submit_teacher_application(jsonb) from public, anon;
revoke all on function public.admin_review_teacher_application(uuid, text, text) from public, anon;
grant execute on function public.submit_teacher_application(jsonb) to authenticated;
grant execute on function public.admin_review_teacher_application(uuid, text, text) to authenticated;
