-- الخطوة 32: خط مخصّص للرئيسية + وضع الصيانة
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 31_home_content.sql)
--
--  1) مفتاحين جداد في home_content: 'font' (ملف الخط وأين يتطبّق) و'maintenance' (وضع الصيانة).
--  2) باكت site-fonts لرفع ملفات الخطوط (الأدمن بس، 3 ميجا، woff2/woff/ttf/otf).
--  3) دالة get_maintenance() خفيفة وبتتندهي من كل الصفحات (للزائر والمسجّل) عشان بوابة الصيانة.
--  4) تحديث دالة الحفظ: فحص رابط الخط (لازم من باكت site-fonts أو /fonts/ بس) وفحص إعدادات الصيانة.
--
-- تنبيه صريح: وضع الصيانة بيمنع الواجهة (الطالب يشوف صفحة الصيانة بدل المنصة). ده مش بيقفل الـ API
-- بتاع Supabase نفسه قدّام حد تقني بيكلّمه مباشرة.

-- ========== 1) توسيع المفاتيح المسموحة ==========
alter table public.home_content drop constraint if exists home_content_key_check;
alter table public.home_content add constraint home_content_key_check
  check (key in ('hero','marquee','subjects','how','stats','teach','faq','cta','footer','layout','font','maintenance'));

-- ========== 2) دالة الصيانة (خفيفة) ==========
create or replace function public.get_maintenance()
returns json
language sql security definer stable set search_path = public as $$
  select coalesce((select h.content::json from public.home_content h where h.key = 'maintenance'), '{}'::json);
$$;

revoke all on function public.get_maintenance() from public;
grant execute on function public.get_maintenance() to anon, authenticated;

-- ========== 3) دالة الحفظ (نسخة محدّثة من ملف 31) ==========
create or replace function public.admin_save_home_content(p_key text, p_content jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('hero','marquee','subjects','how','stats','teach','faq','cta','footer','layout','font','maintenance') then
    raise exception 'bad key' using errcode = '22023';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'bad content' using errcode = '22023';
  end if;
  if octet_length(p_content::text) > 60000 then
    raise exception 'content too large' using errcode = '22023';
  end if;
  if jsonb_path_exists(p_content, '$.** ? (@.type() == "array" && @.size() > 40)') then
    raise exception 'list too long' using errcode = '22023';
  end if;

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

  -- الخط: الرابط لازم من باكت site-fonts بتاعنا (أو /fonts/ في المشروع)، والصيغة والنطاق من قايمة معروفة
  if p_key = 'font' then
    if coalesce(p_content ->> 'url', '') <> ''
       and not (
         (p_content ->> 'url') ~ '^https://[^\s"''()\\]+/storage/v1/object/public/site-fonts/[^\s"''()\\]+$'
         or (p_content ->> 'url') ~ '^/fonts/[^\s"''()\\]+$'
       ) then
      raise exception 'bad font url' using errcode = '22023';
    end if;
    if coalesce(p_content ->> 'format', 'woff2') not in ('woff2','woff','truetype','opentype') then
      raise exception 'bad font format' using errcode = '22023';
    end if;
    if coalesce(p_content ->> 'scope', 'all') not in ('all','headings') then
      raise exception 'bad font scope' using errcode = '22023';
    end if;
  end if;

  -- الصيانة: enabled لازم true/false
  if p_key = 'maintenance' then
    if p_content ? 'enabled' and jsonb_typeof(p_content -> 'enabled') <> 'boolean' then
      raise exception 'bad maintenance flag' using errcode = '22023';
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

revoke all on function public.admin_save_home_content(text, jsonb) from public, anon;
grant execute on function public.admin_save_home_content(text, jsonb) to authenticated;

-- ========== 4) باكت الخطوط (الأدمن بس يرفع) ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-fonts', 'site-fonts', true, 3145728,
        -- بعض المتصفحات/الملفات بتتبعت كـ octet-stream رغم فحص التوقيع وتحديد contentType في الواجهة.
        -- الرفع ما زال مقفول للأدمن فقط بسياسات storage.objects تحت.
        array['font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'application/octet-stream'])
on conflict (id) do update
  set public = true,
      file_size_limit = 3145728,
      allowed_mime_types = array['font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'application/octet-stream'];

drop policy if exists "site fonts upload" on storage.objects;
create policy "site fonts upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-fonts' and public.is_admin());

drop policy if exists "site fonts update" on storage.objects;
create policy "site fonts update" on storage.objects for update to authenticated
  using (bucket_id = 'site-fonts' and public.is_admin());

drop policy if exists "site fonts delete" on storage.objects;
create policy "site fonts delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-fonts' and public.is_admin());
