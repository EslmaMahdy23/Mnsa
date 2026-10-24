-- الخطوة 6: لوحة الأدمن
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 02 و03 و04 و05)
--
-- فكرة الأمان: الموقع بيستخدم المفتاح العام بس، فكل صلاحيات الأدمن بتتحمي هنا في الداتابيز.
-- الدوال اللي تحت بتتأكد إن اللي بيندهها أدمن فعلاً (is_admin) قبل ما تعمل أي حاجة،
-- فحتى لو حد فتح الصفحة بالغلط أو لعب في الكود، الداتابيز هترفض.

-- ========== 1) الأدمن يضيف ويعدّل كورس لأي مدرّس ==========
-- قبل كده الإضافة كانت باسم صاحب الحساب بس. دلوقتي الأدمن يختار المدرّس (مدرّس أو أدمن بس).
drop policy if exists "courses insert" on public.courses;
create policy "courses insert" on public.courses for insert
  with check (
    (public.is_admin()
      and exists (select 1 from public.profiles t where t.id = teacher_id and t.role in ('teacher', 'admin')))
    or (teacher_id = auth.uid() and public.is_teacher())
  );

drop policy if exists "courses update" on public.courses;
create policy "courses update" on public.courses for update
  using (teacher_id = auth.uid() or public.is_admin())
  with check (
    (public.is_admin()
      and exists (select 1 from public.profiles t where t.id = teacher_id and t.role in ('teacher', 'admin')))
    or (teacher_id = auth.uid() and public.is_teacher())
  );

-- ========== 2) فهارس عشان القوائم والبحث يفضلوا سريعين ==========
create index if not exists courses_created_idx on public.courses (created_at desc);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_created_idx on public.profiles (created_at desc);

-- ========== 3) إحصائيات اللوحة في طلب واحد ==========
create or replace function public.admin_stats()
returns json
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return json_build_object(
    'students',    (select count(*) from public.profiles where role = 'student'),
    'teachers',    (select count(*) from public.profiles where role = 'teacher'),
    'admins',      (select count(*) from public.profiles where role = 'admin'),
    'courses',     (select count(*) from public.courses),
    'published',   (select count(*) from public.courses where is_published),
    'lessons',     (select count(*) from public.lessons),
    'enrollments', (select count(*) from public.enrollments)
  );
end;
$$;

-- ========== 4) قائمة المستخدمين (بالإيميل) مع بحث وصفحات ==========
-- الإيميل موجود في auth.users وده مش مفتوح للموقع، فبنجيبه من هنا للأدمن بس.
create or replace function public.admin_list_users(
  p_search text default null,
  p_role text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  email text,
  full_name text,
  phone text,
  parent_phone text,
  grade smallint,
  role text,
  created_at timestamptz,
  enrollments_count bigint,
  total_count bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  q text := nullif(trim(coalesce(p_search, '')), '');
  pat text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if q is not null then
    pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
    select p.id, u.email::text, p.full_name, p.phone, p.parent_phone, p.grade, p.role, p.created_at,
           (select count(*) from public.enrollments e where e.user_id = p.id),
           count(*) over ()
    from public.profiles p
    join auth.users u on u.id = p.id
    where (nullif(p_role, '') is null or p.role = p_role)
      and (pat is null
           or p.full_name ilike pat
           or u.email ilike pat
           or p.phone ilike pat
           or p.parent_phone ilike pat)
    order by p.created_at desc
    limit least(greatest(p_limit, 1), 100)
    offset greatest(p_offset, 0);
end;
$$;

-- ========== 5) تغيير دور مستخدم (طالب / مدرّس / أدمن) ==========
-- الأدمن مايقدرش يغيّر دور نفسه (عشان ما يقفلش اللوحة على نفسه بالغلط).
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_role not in ('student', 'teacher', 'admin') then
    raise exception 'bad role' using errcode = '22023';
  end if;
  if p_user = auth.uid() then
    raise exception 'cannot change own role' using errcode = '22023';
  end if;

  update public.profiles set role = p_role where id = p_user;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ========== 6) تعديل بيانات مستخدم (الاسم، الهاتفين، السنة) ==========
-- ده المكان الوحيد اللي بيتغيّر منه الهاتف ورقم ولي الأمر (الطالب نفسه مقفول عليه).
create or replace function public.admin_update_user(
  p_user uuid,
  p_full_name text,
  p_grade smallint,
  p_phone text,
  p_parent_phone text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  n  text := nullif(trim(coalesce(p_full_name, '')), '');
  ph text := nullif(trim(coalesce(p_phone, '')), '');
  pp text := nullif(trim(coalesce(p_parent_phone, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if ph is not null and ph !~ '^01[0125][0-9]{8}$' then
    raise exception 'bad phone' using errcode = '22023';
  end if;
  if pp is not null and pp !~ '^01[0125][0-9]{8}$' then
    raise exception 'bad parent phone' using errcode = '22023';
  end if;
  if ph is not null and ph = pp then
    raise exception 'phones must differ' using errcode = '22023';
  end if;
  if p_grade is not null and (p_grade < 1 or p_grade > 9) then
    raise exception 'bad grade' using errcode = '22023';
  end if;

  update public.profiles
     set full_name = n, phone = ph, parent_phone = pp, grade = p_grade
   where id = p_user;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ========== 7) المسجّلين في كورس معيّن (بالإيميل) مع صفحات ==========
create or replace function public.admin_course_enrollments(
  p_course uuid,
  p_limit int default 10,
  p_offset int default 0
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  phone text,
  grade smallint,
  enrolled_at timestamptz,
  total_count bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
    select e.user_id, u.email::text, p.full_name, p.phone, p.grade, e.enrolled_at,
           count(*) over ()
    from public.enrollments e
    join public.profiles p on p.id = e.user_id
    join auth.users u on u.id = e.user_id
    where e.course_id = p_course
    order by e.enrolled_at desc
    limit least(greatest(p_limit, 1), 100)
    offset greatest(p_offset, 0);
end;
$$;

-- ========== 8) الصلاحيات: المسجّلين بس يقدروا يندهوا الدوال (والدوال نفسها بتتأكد إنه أدمن) ==========
revoke all on function public.admin_stats() from public, anon;
revoke all on function public.admin_list_users(text, text, int, int) from public, anon;
revoke all on function public.admin_set_role(uuid, text) from public, anon;
revoke all on function public.admin_update_user(uuid, text, smallint, text, text) from public, anon;
revoke all on function public.admin_course_enrollments(uuid, int, int) from public, anon;

grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_list_users(text, text, int, int) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_update_user(uuid, text, smallint, text, text) to authenticated;
grant execute on function public.admin_course_enrollments(uuid, int, int) to authenticated;

-- ========== ترقية أول أدمن (لو لسه مفيش) — غيّر الإيميل وشغّل السطرين لوحدهم ==========
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'PUT_YOUR_EMAIL_HERE');
