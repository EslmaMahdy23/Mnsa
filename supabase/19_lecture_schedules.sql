-- الخطوة 19: جداول المحاضرات التي يديرها الأدمن ويشاهدها الطالب في حسابه
-- شغّله في Supabase SQL Editor بعد ملفات المشروع السابقة.

create table if not exists public.lecture_schedules (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (char_length(trim(subject)) >= 2),
  grade smallint not null check (grade between 1 and 9),
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  term_title text not null default 'جدول المحاضرات',
  description text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lecture_schedules_student_idx
  on public.lecture_schedules (grade, is_published, subject, teacher_id);

create table if not exists public.lecture_schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.lecture_schedules(id) on delete cascade,
  title text not null check (char_length(trim(title)) >= 2),
  scheduled_at timestamptz,
  topic text,
  position integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists lecture_schedule_items_order_idx
  on public.lecture_schedule_items (schedule_id, position, scheduled_at);

alter table public.lecture_schedules enable row level security;
alter table public.lecture_schedule_items enable row level security;

drop policy if exists "lecture schedules student read" on public.lecture_schedules;
create policy "lecture schedules student read" on public.lecture_schedules
  for select to authenticated
  using (
    public.is_admin()
    or (is_published and grade = (
      select p.grade from public.profiles p where p.id = (select auth.uid())
    ))
  );

drop policy if exists "lecture schedules admin insert" on public.lecture_schedules;
create policy "lecture schedules admin insert" on public.lecture_schedules
  for insert to authenticated with check (public.is_admin());

drop policy if exists "lecture schedules admin update" on public.lecture_schedules;
create policy "lecture schedules admin update" on public.lecture_schedules
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "lecture schedules admin delete" on public.lecture_schedules;
create policy "lecture schedules admin delete" on public.lecture_schedules
  for delete to authenticated using (public.is_admin());

drop policy if exists "lecture items student read" on public.lecture_schedule_items;
create policy "lecture items student read" on public.lecture_schedule_items
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.lecture_schedules s
      join public.profiles p on p.id = (select auth.uid()) and p.grade = s.grade
      where s.id = lecture_schedule_items.schedule_id and s.is_published
    )
  );

drop policy if exists "lecture items admin insert" on public.lecture_schedule_items;
create policy "lecture items admin insert" on public.lecture_schedule_items
  for insert to authenticated with check (public.is_admin());

drop policy if exists "lecture items admin update" on public.lecture_schedule_items;
create policy "lecture items admin update" on public.lecture_schedule_items
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "lecture items admin delete" on public.lecture_schedule_items;
create policy "lecture items admin delete" on public.lecture_schedule_items
  for delete to authenticated using (public.is_admin());

revoke all on public.lecture_schedules, public.lecture_schedule_items from anon;
grant select on public.lecture_schedules, public.lecture_schedule_items to authenticated;
grant insert, update, delete on public.lecture_schedules, public.lecture_schedule_items to authenticated;
