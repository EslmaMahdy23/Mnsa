-- الخطوة 5: قفل الهاتفين + كروت الكورسات (السنة والسعر) + حماية التسجيل والسعر
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 02 و03 و04)

-- 1) الهاتف ورقم ولي الأمر مايتعدلوش من الطالب (لو كنت شغّلت 04 قبل كده)
revoke update (phone, parent_phone) on public.profiles from authenticated;

-- 2) السنة الدراسية والسعر للكورسات
--    grade فاضي = الكورس لكل السنوات، price = 0 يعني مجاني
alter table public.courses
  add column if not exists grade smallint,
  add column if not exists price numeric(10,2) not null default 0;

alter table public.courses drop constraint if exists courses_grade_check;
alter table public.courses
  add constraint courses_grade_check check (grade is null or grade between 1 and 9);

alter table public.courses drop constraint if exists courses_price_check;
alter table public.courses
  add constraint courses_price_check check (price >= 0);

-- 3) السعر يتغيّر من الأدمن بس.
--    أي مدرّس غير أدمن: السعر بيتثبّت على صفر عند الإضافة، وما بيتغيّرش عند التعديل.
--    (auth.uid() فاضي = تشغيل من SQL Editor أو من السيرفر، وده مسموح)
create or replace function public.guard_course_price()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.price := 0;
    elsif new.price is distinct from old.price then
      new.price := old.price;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists courses_price_guard on public.courses;
create trigger courses_price_guard
  before insert or update on public.courses
  for each row execute function public.guard_course_price();

-- 4) التسجيل:
--    - الطالب يسجّل نفسه في كورس منشور ومجاني بس
--    - المدفوع: الأدمن بس هو اللي يسجّل (بعد الدفع، هنعمل لوحته بعدين)
drop policy if exists "enrollments insert" on public.enrollments;
drop policy if exists "enrollments insert free" on public.enrollments;
drop policy if exists "enrollments admin insert" on public.enrollments;

create policy "enrollments insert free" on public.enrollments for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.courses c
      where c.id = course_id and c.is_published and c.price = 0
    )
  );

create policy "enrollments admin insert" on public.enrollments for insert
  with check (public.is_admin());

-- 5) اللي يسجّل مرة يتحفظ تسجيله: الطالب مايقدرش يلغي تسجيله بنفسه (الأدمن بس)
drop policy if exists "enrollments delete" on public.enrollments;
drop policy if exists "enrollments admin delete" on public.enrollments;
create policy "enrollments admin delete" on public.enrollments for delete
  using (public.is_admin());
