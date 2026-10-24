-- الخطوة 11: أقسام الكورس (أسابيع/وحدات) وعناصر الدروس (فيديو أو ملف)
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 02 لحد 10)
--
-- الهيكل: كورس ← أقسام (course_sections) ← عناصر (lessons: فيديو أو ملف)
-- الدروس القديمة بتتنقل تلقائياً لقسم اسمه "الدروس" جوه نفس الكورس، فمفيش حاجة بتضيع.

-- ========== 1) جدول الأقسام ==========
create table if not exists public.course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  description text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists course_sections_course_idx on public.course_sections (course_id, position);

-- ========== 2) الدروس: ربطها بقسم + نوع العنصر (فيديو/ملف) + رابط الملف ==========
alter table public.lessons
  add column if not exists section_id uuid references public.course_sections(id) on delete cascade,
  add column if not exists kind text not null default 'video',
  add column if not exists file_url text;

alter table public.lessons drop constraint if exists lessons_kind_check;
alter table public.lessons add constraint lessons_kind_check check (kind in ('video', 'file'));
create index if not exists lessons_section_idx on public.lessons (section_id, position);

-- ========== 3) نقل الدروس القديمة لقسم افتراضي (مرة واحدة) ==========
insert into public.course_sections (course_id, title, position)
select distinct l.course_id, 'الدروس', 1
from public.lessons l
where l.section_id is null;

update public.lessons l
   set section_id = s.id
  from public.course_sections s
 where l.section_id is null and s.course_id = l.course_id;

alter table public.lessons alter column section_id set not null;

-- ========== 4) الأمان (RLS) ==========
alter table public.course_sections enable row level security;

-- أسماء الأقسام تظهر لأي حد شايف الكورس المنشور (زي فهرس الكورس).
-- العناصر نفسها (الفيديو والملف) بتفضل محمية: للمسجّلين وصاحب الكورس والأدمن ودروس المعاينة بس (سياسة lessons read).
drop policy if exists "sections read" on public.course_sections;
create policy "sections read" on public.course_sections for select
  using (exists (
    select 1 from public.courses c
    where c.id = course_sections.course_id
      and (c.is_published or c.teacher_id = auth.uid() or public.is_admin())
  ));

drop policy if exists "sections write" on public.course_sections;
create policy "sections write" on public.course_sections for all
  using (exists (
    select 1 from public.courses c
    where c.id = course_sections.course_id and (c.teacher_id = auth.uid() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.courses c
    where c.id = course_sections.course_id and (c.teacher_id = auth.uid() or public.is_admin())
  ));
