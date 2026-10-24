-- Step 34: admin-managed student dashboard content and layout.
-- Run in Supabase SQL Editor after the existing dashboard migrations.

create table if not exists public.student_dashboard_settings (
  id boolean primary key default true check (id),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.student_dashboard_settings enable row level security;
revoke all on public.student_dashboard_settings from anon, authenticated;

create or replace function public.get_student_dashboard_settings()
returns json
language sql security definer stable set search_path = public as $$
  select coalesce((select s.settings::json from public.student_dashboard_settings s where s.id = true),
    '{"welcomeTitle":"أهلاً بك في لوحة الطالب","welcomeMessage":"تابع دراستك وإنجازك وكورساتك من مكان واحد.","recentCount":3,"nav":[{"key":"home","label":"الرئيسية","enabled":true},{"key":"courses","label":"الكورسات","enabled":true},{"key":"wallet","label":"المحفظة","enabled":true},{"key":"profile","label":"حسابي والفواتير","enabled":true}],"sectionOrder":["stats","learning","recent","empty"],"hiddenSections":[]}'::json);
$$;

create or replace function public.admin_save_student_dashboard_settings(p_settings jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or octet_length(p_settings::text) > 12000 then
    raise exception 'bad settings' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'welcomeTitle') is distinct from 'string'
     or length(p_settings ->> 'welcomeTitle') > 100
     or jsonb_typeof(p_settings -> 'welcomeMessage') is distinct from 'string'
     or length(p_settings ->> 'welcomeMessage') > 240 then
    raise exception 'bad welcome text' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'recentCount') is distinct from 'number' then
    raise exception 'bad recent count' using errcode = '22023';
  end if;
  if (p_settings ->> 'recentCount')::numeric < 1 or (p_settings ->> 'recentCount')::numeric > 6 then
    raise exception 'bad recent count' using errcode = '22023';
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
  if jsonb_array_length(p_settings -> 'sectionOrder') <> 4
     or (select count(distinct s.value) from jsonb_array_elements_text(p_settings -> 'sectionOrder') as s(value)) <> 4 then
    raise exception 'bad section order' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_array_elements_text(p_settings -> 'sectionOrder') s
       where s not in ('stats','learning','recent','empty')
     ) then
    raise exception 'bad section order' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'hiddenSections') is distinct from 'array' then
    raise exception 'bad hidden sections' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_array_elements_text(p_settings -> 'hiddenSections') s
       where s not in ('stats','learning','recent','empty')
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
