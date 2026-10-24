-- Step 36: add the admin-only custom font upload setting for the student dashboard.
-- Requires the site-fonts bucket and policies from 32_home_font_maintenance.sql.

create or replace function public.get_student_dashboard_settings()
returns json
language sql security definer stable set search_path = public as $$
  select coalesce((select s.settings::json from public.student_dashboard_settings s where s.id = true),
    '{"recentCount":3,"font":{"url":"","format":"woff2","fileName":"","scope":"all"},"nav":[{"key":"home","label":"الرئيسية","enabled":true},{"key":"courses","label":"الكورسات","enabled":true},{"key":"wallet","label":"المحفظة","enabled":true},{"key":"profile","label":"حسابي والفواتير","enabled":true}],"sectionOrder":["learning","recent","empty"],"hiddenSections":[]}'::json);
$$;

create or replace function public.admin_save_student_dashboard_settings(p_settings jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_font_url text;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or octet_length(p_settings::text) > 12000 then
    raise exception 'bad settings' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'recentCount') is distinct from 'number' then
    raise exception 'bad recent count' using errcode = '22023';
  end if;
  if (p_settings ->> 'recentCount')::numeric < 1 or (p_settings ->> 'recentCount')::numeric > 6 then
    raise exception 'bad recent count' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'font') is distinct from 'object'
     or jsonb_typeof(p_settings #> '{font,url}') is distinct from 'string'
     or jsonb_typeof(p_settings #> '{font,format}') is distinct from 'string'
     or jsonb_typeof(p_settings #> '{font,fileName}') is distinct from 'string'
     or jsonb_typeof(p_settings #> '{font,scope}') is distinct from 'string' then
    raise exception 'bad font settings' using errcode = '22023';
  end if;
  v_font_url := p_settings #>> '{font,url}';
  if v_font_url <> '' and v_font_url !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/site-fonts/[A-Za-z0-9_-]+[.](woff2|woff|ttf|otf)$'
     and v_font_url !~ '^/fonts/[A-Za-z0-9_-]+[.](woff2|woff|ttf|otf)$' then
    raise exception 'bad font url' using errcode = '22023';
  end if;
  if p_settings #>> '{font,format}' not in ('woff2','woff','truetype','opentype')
     or length(p_settings #>> '{font,fileName}') > 120
     or p_settings #>> '{font,scope}' not in ('all','headings') then
    raise exception 'bad font settings' using errcode = '22023';
  end if;

  if jsonb_typeof(p_settings -> 'nav') is distinct from 'array' then
    raise exception 'bad navigation' using errcode = '22023';
  end if;
  if jsonb_array_length(p_settings -> 'nav') <> 4 or exists (
       select 1 from jsonb_array_elements(p_settings -> 'nav') as n(item)
       where n.item ->> 'key' not in ('home','courses','wallet','profile')
          or jsonb_typeof(n.item -> 'enabled') is distinct from 'boolean'
          or jsonb_typeof(n.item -> 'label') is distinct from 'string'
          or length(trim(n.item ->> 'label')) = 0
          or length(n.item ->> 'label') > 60
     ) then
    raise exception 'bad navigation' using errcode = '22023';
  end if;
  if (select count(distinct n.item ->> 'key') from jsonb_array_elements(p_settings -> 'nav') as n(item)) <> 4 then
    raise exception 'bad navigation keys' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'sectionOrder') is distinct from 'array' then
    raise exception 'bad section order' using errcode = '22023';
  end if;
  if jsonb_array_length(p_settings -> 'sectionOrder') <> 3
     or (select count(distinct s.value) from jsonb_array_elements_text(p_settings -> 'sectionOrder') as s(value)) <> 3
     or exists (
       select 1 from jsonb_array_elements_text(p_settings -> 'sectionOrder') s
       where s not in ('learning','recent','empty')
     ) then
    raise exception 'bad section order' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'hiddenSections') is distinct from 'array' then
    raise exception 'bad hidden sections' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_array_elements_text(p_settings -> 'hiddenSections') s
       where s not in ('learning','recent','empty')
     ) then
    raise exception 'bad hidden sections' using errcode = '22023';
  end if;

  insert into public.student_dashboard_settings (id, settings, updated_at, updated_by)
  values (true, p_settings, now(), auth.uid())
  on conflict (id) do update
    set settings = excluded.settings, updated_at = now(), updated_by = auth.uid();
end;
$$;

revoke all on function public.get_student_dashboard_settings() from public;
revoke all on function public.admin_save_student_dashboard_settings(jsonb) from public, anon;
grant execute on function public.get_student_dashboard_settings() to anon, authenticated;
grant execute on function public.admin_save_student_dashboard_settings(jsonb) to authenticated;
