-- Step 33: add an editable features section to the public home page.
-- Run this in Supabase after 32_home_font_maintenance.sql.

alter table public.home_content drop constraint if exists home_content_key_check;
alter table public.home_content add constraint home_content_key_check
  check (key in ('hero','marquee','subjects','features','how','stats','teach','faq','cta','footer','layout','font','maintenance'));

create or replace function public.admin_save_home_content(p_key text, p_content jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('hero','marquee','subjects','features','how','stats','teach','faq','cta','footer','layout','font','maintenance') then
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
        where o not in ('subjects','features','how','stats','teach','faq')
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
        where h not in ('marquee','subjects','features','how','stats','teach','faq','cta')
      ) then
        raise exception 'bad layout hidden' using errcode = '22023';
      end if;
    end if;
  end if;

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
