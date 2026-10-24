-- ترتيب الطلاب حسب متوسط النتيجة في كل الامتحانات المنشورة.
-- يظهر الطالب فقط بعد تسليم كل الامتحانات المنشورة، ولا تُحتسب المحاولات المعلّقة.

create or replace function public.get_exam_leaderboard(p_limit integer default 10)
returns json
language plpgsql security definer stable set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_exam_count integer;
  v_leaders json;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_user and role in ('student','admin')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select count(*) into v_exam_count from public.exams where is_published;
  if v_exam_count = 0 then
    return json_build_object('exam_count', 0, 'leaders', '[]'::json);
  end if;

  with complete_students as (
    select p.id as user_id, coalesce(nullif(trim(p.full_name), ''), 'طالب') as student_name,
      round(avg(a.percent)::numeric, 1) as average_percent,
      count(*)::integer as completed_exams
    from public.profiles p
    join public.exam_attempts a on a.user_id = p.id and a.submitted_at is not null and not a.essay_pending
    join public.exams e on e.id = a.exam_id and e.is_published
    where p.role = 'student'
    group by p.id, p.full_name
    having count(distinct e.id) = v_exam_count
  ), ranked as (
    select *, dense_rank() over (order by average_percent desc) as rank
    from complete_students
  ), selected as (
    select * from ranked
    where rank <= greatest(1, least(coalesce(p_limit, 10), 50)) or user_id = v_user
  )
  select coalesce(json_agg(json_build_object(
    'user_id', user_id, 'student_name', student_name, 'average_percent', average_percent,
    'completed_exams', completed_exams, 'rank', rank
  ) order by rank, student_name), '[]'::json) into v_leaders from selected;

  return json_build_object('exam_count', v_exam_count, 'leaders', v_leaders);
end;
$$;

revoke all on function public.get_exam_leaderboard(integer) from public, anon;
grant execute on function public.get_exam_leaderboard(integer) to authenticated;

-- السماح بقسم لوحة الصدارة في إعدادات لوحة الطالب.
create or replace function public.admin_save_student_dashboard_settings(p_settings jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or octet_length(p_settings::text) > 12000 then
    raise exception 'bad settings' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'recentCount') is distinct from 'number'
     or (p_settings ->> 'recentCount')::numeric < 1 or (p_settings ->> 'recentCount')::numeric > 6 then
    raise exception 'bad recent count' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'nav') is distinct from 'array' or jsonb_array_length(p_settings -> 'nav') <> 4 or exists (
    select 1 from jsonb_array_elements(p_settings -> 'nav') n(item)
    where n.item ->> 'key' not in ('home','courses','wallet','profile')
       or jsonb_typeof(n.item -> 'enabled') is distinct from 'boolean'
       or jsonb_typeof(n.item -> 'label') is distinct from 'string'
       or length(trim(n.item ->> 'label')) = 0 or length(n.item ->> 'label') > 60
  ) or (select count(distinct n.item ->> 'key') from jsonb_array_elements(p_settings -> 'nav') n(item)) <> 4 then
    raise exception 'bad navigation' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'sectionOrder') is distinct from 'array'
     or jsonb_array_length(p_settings -> 'sectionOrder') <> 4
     or (select count(distinct s.value) from jsonb_array_elements_text(p_settings -> 'sectionOrder') s(value)) <> 4
     or exists (select 1 from jsonb_array_elements_text(p_settings -> 'sectionOrder') s where s not in ('learning','recent','empty','leaderboard')) then
    raise exception 'bad section order' using errcode = '22023';
  end if;
  if jsonb_typeof(p_settings -> 'hiddenSections') is distinct from 'array'
     or exists (select 1 from jsonb_array_elements_text(p_settings -> 'hiddenSections') s where s not in ('learning','recent','empty','leaderboard')) then
    raise exception 'bad hidden sections' using errcode = '22023';
  end if;

  insert into public.student_dashboard_settings (id, settings, updated_at, updated_by)
  values (true, p_settings, now(), auth.uid())
  on conflict (id) do update set settings = excluded.settings, updated_at = now(), updated_by = auth.uid();
end;
$$;

revoke all on function public.admin_save_student_dashboard_settings(jsonb) from public, anon;
grant execute on function public.admin_save_student_dashboard_settings(jsonb) to authenticated;
