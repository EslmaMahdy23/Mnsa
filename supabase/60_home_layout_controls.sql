-- Fix homepage section ordering/visibility validation for current sections.
-- Run after supabase/58_home_design_editor.sql.

create or replace function public.admin_save_home_content(p_key text, p_content jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('hero','marquee','subjects','how','stats','teach','faq','cta','footer','layout','font','maintenance','design') then
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

  for v in select x #>> '{}' from jsonb_path_query(p_content, '$.** ? (@.type() == "string")') as x loop
    if length(v) > 2000 then raise exception 'text too long' using errcode = '22023'; end if;
    if v ~* '^\s*(javascript|data|vbscript)\s*:' then raise exception 'unsafe link' using errcode = '22023'; end if;
  end loop;

  if p_key = 'layout' then
    if p_content ? 'order' and (
      jsonb_typeof(p_content -> 'order') <> 'array'
      or exists (
        select 1 from jsonb_array_elements_text(p_content -> 'order') o
        where o not in ('subjects','features','how','stats','teach','faq')
      )
    ) then
      raise exception 'bad layout order' using errcode = '22023';
    end if;
    if p_content ? 'hidden' and (
      jsonb_typeof(p_content -> 'hidden') <> 'array'
      or exists (
        select 1 from jsonb_array_elements_text(p_content -> 'hidden') h
        where h not in ('hero','marquee','subjects','features','how','stats','teach','faq','cta','footer')
      )
    ) then
      raise exception 'bad layout hidden' using errcode = '22023';
    end if;
  end if;

  if p_key = 'font' then
    if coalesce(p_content ->> 'url', '') <> '' and not (
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

  if p_key = 'design' then
    if coalesce(p_content ->> 'primaryColor', '') !~ '^#[0-9a-fA-F]{6}$'
       or coalesce(p_content ->> 'accentColor', '') !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'bad design color' using errcode = '22023';
    end if;
    if coalesce((p_content ->> 'heroHeight')::numeric, 0) not between 480 and 920
       or coalesce((p_content ->> 'heroTitleSize')::numeric, 0) not between 1.8 and 5
       or coalesce((p_content ->> 'sectionTitleSize')::numeric, 0) not between 1.3 and 3.5
       or coalesce((p_content ->> 'sectionSpacing')::numeric, 0) not between 35 and 180
       or coalesce((p_content ->> 'pageWidth')::numeric, 0) not between 900 and 1500
       or coalesce((p_content ->> 'cardRadius')::numeric, -1) not between 0 and 40 then
      raise exception 'bad design size' using errcode = '22023';
    end if;
  end if;

  if p_key = 'maintenance' and p_content ? 'enabled' and jsonb_typeof(p_content -> 'enabled') <> 'boolean' then
    raise exception 'bad maintenance flag' using errcode = '22023';
  end if;

  insert into public.home_content (key, content, updated_at, updated_by)
  values (p_key, p_content, now(), auth.uid())
  on conflict (key) do update
    set content = excluded.content, updated_at = now(), updated_by = auth.uid();
end;
$$;

revoke all on function public.admin_save_home_content(text, jsonb) from public, anon;
grant execute on function public.admin_save_home_content(text, jsonb) to authenticated;
