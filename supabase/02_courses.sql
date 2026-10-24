-- الخطوة 2: الدورات والدروس والتسجيل والتقدّم
-- شغّله في Supabase: SQL Editor > New query > Run (بعد schema.sql)

-- ========== دوال مساعدة للصلاحيات ==========
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_teacher()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'));
$$;

-- أي مستخدم مسجّل يقدر يشوف الاسم والدور (عشان يظهر اسم المدرّس)
create policy "authenticated read profiles" on public.profiles
  for select to authenticated using (true);

-- ========== الجداول ==========
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  cover_url text,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  content text,
  video_url text,
  position int not null default 0,
  is_free_preview boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.enrollments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table public.lesson_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create index on public.courses (teacher_id);
create index on public.lessons (course_id, position);
create index on public.enrollments (course_id);

-- ========== الأمان (RLS) ==========
alter table public.courses enable row level security;
alter table public.lessons enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_progress enable row level security;

-- الدورات: المنشورة للكل، وغير المنشورة لصاحبها والأدمن
create policy "courses read" on public.courses for select
  using (is_published or teacher_id = auth.uid() or public.is_admin());
create policy "courses insert" on public.courses for insert
  with check (teacher_id = auth.uid() and public.is_teacher());
create policy "courses update" on public.courses for update
  using (teacher_id = auth.uid() or public.is_admin());
create policy "courses delete" on public.courses for delete
  using (teacher_id = auth.uid() or public.is_admin());

-- الدروس: المسجّل في الدورة، أو درس المعاينة المجاني، أو صاحب الدورة والأدمن
create policy "lessons read" on public.lessons for select
  using (exists (
    select 1 from public.courses c
    where c.id = lessons.course_id
      and (
        c.teacher_id = auth.uid() or public.is_admin()
        or (c.is_published and (
          lessons.is_free_preview
          or exists (select 1 from public.enrollments e
                     where e.course_id = c.id and e.user_id = auth.uid())
        ))
      )
  ));
create policy "lessons write" on public.lessons for all
  using (exists (select 1 from public.courses c
                 where c.id = lessons.course_id
                   and (c.teacher_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.courses c
                      where c.id = lessons.course_id
                        and (c.teacher_id = auth.uid() or public.is_admin())));

-- التسجيل: الطالب يسجّل نفسه في دورة منشورة (مجاني حالياً)
create policy "enrollments read" on public.enrollments for select
  using (user_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.courses c
                    where c.id = enrollments.course_id and c.teacher_id = auth.uid()));
create policy "enrollments insert" on public.enrollments for insert
  with check (user_id = auth.uid()
              and exists (select 1 from public.courses c
                          where c.id = course_id and c.is_published));
create policy "enrollments delete" on public.enrollments for delete
  using (user_id = auth.uid());

-- التقدّم: كل طالب يشوف ويعدّل تقدّمه هو بس
create policy "progress own" on public.lesson_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ========== ترقية مستخدم لمدرّس (غيّر الإيميل وشغّله لوحده) ==========
-- update public.profiles set role = 'teacher'
-- where id = (select id from auth.users where email = 'teacher@example.com');
