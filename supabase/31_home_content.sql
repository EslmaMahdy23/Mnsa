-- الخطوة 31: التحكم الكامل في محتوى الصفحة الرئيسية من لوحة الأدمن
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 30_public_course_catalog.sql)
--
-- الفكرة:
--  1) نص كل قسم في الرئيسية (الهيرو، الأسئلة، الفوتر...) بيتخزّن كـ JSON في جدول home_content.
--     لو مفيش صف لقسم معيّن، الصفحة بتستخدم النص الافتراضي اللي في الكود (فمفيش حاجة بتبوظ).
--  2) ترتيب الأقسام وإخفائها بيتخزّن في صف خاص اسمه 'layout'.
--  3) الزائر يقرا من دالة واحدة get_home_page() (المحتوى + إحصائيات الأعداد التلقائية).
--  4) الأدمن بس يكتب، من خلال دالة admin_save_home_content اللي بتتأكد إنه أدمن وبتفحص المحتوى.
--
-- الحماية:
--  - الجدول مقفول تماماً (RLS من غير أي سياسة + سحب الصلاحيات). مفيش وصول مباشر لا للقراءة ولا للكتابة.
--  - الكتابة للأدمن بس (is_admin) وبتتحقق من: اسم القسم، حجم المحتوى، طول كل نص، عدد عناصر القوائم،
--    ورفض أي نص بيبدأ بـ javascript: أو data: أو vbscript: (منع روابط XSS).
--  - الصفحة نفسها بتعرض كل النصوص كنص عادي (React بيهرّب HTML)، ومفيش dangerouslySetInnerHTML.
--  - رفع الصور لباكت home-media: الأدمن بس، 2 ميجا، jpg/png/webp.

-- ========== 1) الجدول (مقفول) ==========
create table if not exists public.home_content (
  key text primary key
    check (key in ('hero','marquee','subjects','how','stats','teach','faq','cta','footer','layout')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.home_content enable row level security;
revoke all on public.home_content from anon, authenticated;
-- (عمداً مفيش policies: الدوال تحت security definer هي الباب الوحيد)

-- ========== 2) قراءة الصفحة (للزائر والمسجّل) ==========
-- الأعداد (طلاب/دروس/امتحانات) بتتحسب من الداتابيز تلقائي، والأدمن يختار يعرضها بدل الرقم اليدوي.
create or replace function public.get_home_page()
returns json
language sql security definer stable set search_path = public as $$
  select json_build_object(
    'sections', coalesce((select json_object_agg(h.key, h.content) from public.home_content h), '{}'::json),
    'stats', json_build_object(
      'students', (select count(*) from public.profiles where role = 'student'),
      'lessons',  (select count(*) from public.lessons),
      'exams',    (select count(*) from public.exams where is_published and question_count > 0)
    )
  );
$$;

-- ========== 3) حفظ قسم (أدمن بس) ==========
create or replace function public.admin_save_home_content(p_key text, p_content jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('hero','marquee','subjects','how','stats','teach','faq','cta','footer','layout') then
    raise exception 'bad key' using errcode = '22023';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'bad content' using errcode = '22023';
  end if;
  if octet_length(p_content::text) > 60000 then
    raise exception 'content too large' using errcode = '22023';
  end if;
  -- أي قائمة أطول من 40 عنصر مرفوضة
  if jsonb_path_exists(p_content, '$.** ? (@.type() == "array" && @.size() > 40)') then
    raise exception 'list too long' using errcode = '22023';
  end if;

  -- فحص كل النصوص جوه المحتوى (على أي عمق)
  for v in
    select x #>> '{}' from jsonb_path_query(p_content, '$.** ? (@.type() == "string")') as x
  loop
    if length(v) > 2000 then
      raise exception 'text too long' using errcode = '22023';
    end if;
    if v ~* '^\s*(javascript|data|vbscript)\s*:' then
      raise exception 'unsafe link' using errcode = '22023';
    end if;
  end loop;

  -- الترتيب والإخفاء: أسماء أقسام معروفة بس
  if p_key = 'layout' then
    if p_content ? 'order' then
      if jsonb_typeof(p_content -> 'order') <> 'array' then
        raise exception 'bad layout' using errcode = '22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(p_content -> 'order') o
        where o not in ('subjects','how','stats','teach','faq')
      ) then
        raise exception 'bad layout order' using errcode = '22023';
      end if;
    end if;
    if p_content ? 'hidden' then
      if jsonb_typeof(p_content -> 'hidden') <> 'array' then
        raise exception 'bad layout' using errcode = '22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(p_content -> 'hidden') h
        where h not in ('marquee','subjects','how','stats','teach','faq','cta')
      ) then
        raise exception 'bad layout hidden' using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.home_content (key, content, updated_at, updated_by)
  values (p_key, p_content, now(), auth.uid())
  on conflict (key) do update
    set content = excluded.content,
        updated_at = now(),
        updated_by = auth.uid();
end;
$$;

-- ========== 4) رجوع قسم للنص الافتراضي (أدمن بس) ==========
create or replace function public.admin_reset_home_content(p_key text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.home_content where key = p_key;
end;
$$;

-- ========== 5) الصلاحيات ==========
revoke all on function public.get_home_page() from public;
revoke all on function public.admin_save_home_content(text, jsonb) from public, anon;
revoke all on function public.admin_reset_home_content(text) from public, anon;

grant execute on function public.get_home_page() to anon, authenticated;
grant execute on function public.admin_save_home_content(text, jsonb) to authenticated;
grant execute on function public.admin_reset_home_content(text) to authenticated;

-- ========== 6) باكت صور الرئيسية (الأدمن بس يرفع) ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('home-media', 'home-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "home media upload" on storage.objects;
create policy "home media upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'home-media' and public.is_admin());

drop policy if exists "home media update" on storage.objects;
create policy "home media update" on storage.objects for update to authenticated
  using (bucket_id = 'home-media' and public.is_admin());

drop policy if exists "home media delete" on storage.objects;
create policy "home media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'home-media' and public.is_admin());
