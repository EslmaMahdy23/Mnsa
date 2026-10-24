-- الخطوة 4: تعديل الطالب لبياناته + السنوات (ابتدائي 1-6، إعدادي 7-9)
-- شغّله في Supabase: SQL Editor > New query > Run

-- 1) السنة الدراسية من 1 لـ 9
alter table public.profiles drop constraint if exists profiles_grade_check;
alter table public.profiles
  add constraint profiles_grade_check check (grade is null or grade between 1 and 9);

-- 2) سياسة التعديل: المستخدم يعدّل صفه هو بس
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 3) الأهم للأمان: نحدد الأعمدة اللي يقدر يعدّلها.
--    role و id و created_at مقفولين، فالطالب مايقدرش يرقّي نفسه لأدمن.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, grade) on public.profiles to authenticated;
