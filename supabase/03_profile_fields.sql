-- الخطوة 3: بيانات الطالب (الهاتف، ولي الأمر، السنة الدراسية) + حماية الخصوصية
-- شغّله في Supabase: SQL Editor > New query > Run

-- 1) الأعمدة الجديدة
alter table public.profiles
  add column if not exists phone text,
  add column if not exists parent_phone text,
  add column if not exists grade smallint;

alter table public.profiles drop constraint if exists profiles_grade_check;
alter table public.profiles
  add constraint profiles_grade_check check (grade is null or grade between 3 and 6);

-- 2) إنشاء البروفايل تلقائياً بكل البيانات عند التسجيل (الدور دايماً student)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, parent_phone, grade)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    nullif(trim(new.raw_user_meta_data->>'parent_phone'), ''),
    nullif(new.raw_user_meta_data->>'grade', '')::smallint
  );
  return new;
end;
$$;

-- 3) الخصوصية: أرقام الهواتف ما تتشافش غير لصاحبها والأدمن
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists "authenticated read profiles" on public.profiles;
drop policy if exists "admin read profiles" on public.profiles;
create policy "admin read profiles" on public.profiles
  for select using (public.is_admin());

-- لعرض اسم المدرّس للطلاب من غير كشف بيانات حد (مدرّسين وأدمن بس، اسم ودور بس)
create or replace view public.public_profiles as
  select id, full_name, role from public.profiles where role in ('teacher', 'admin');
grant select on public.public_profiles to authenticated;
