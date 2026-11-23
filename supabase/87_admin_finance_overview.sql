-- Password-confirmed financial overview for administrators.
-- Run after 85_teacher_course_revenue.sql. The course-review migration 86 is independent.

-- Financial rows are read through scoped SECURITY DEFINER functions only.
revoke select on public.course_sales from authenticated;

create or replace function public.admin_finance_overview()
returns jsonb
language plpgsql security definer stable set search_path = public, auth as $$
declare
  v_user uuid := auth.uid();
  v_iat_text text;
  v_iat bigint;
  v_result jsonb;
begin
  if v_user is null or not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_iat_text := auth.jwt()->>'iat';
  if v_iat_text is null or v_iat_text !~ '^[0-9]+$' then
    raise exception 'recent_auth_required' using errcode = '42501';
  end if;
  v_iat := v_iat_text::bigint;
  if to_timestamp(v_iat::double precision) < now() - interval '5 minutes'
     or to_timestamp(v_iat::double precision) > now() + interval '1 minute' then
    raise exception 'recent_auth_required' using errcode = '42501';
  end if;

  with sales as (
    select * from public.course_sales where status = 'paid'
  ), teacher_totals as (
    select s.teacher_id, coalesce(p.full_name, 'مدرس بدون اسم') as teacher_name,
           sum(s.teacher_amount) as amount_due, count(*)::bigint as sales_count
    from sales s
    left join public.profiles p on p.id = s.teacher_id
    where s.teacher_id is not null
    group by s.teacher_id, p.full_name
  ), recent as (
    select s.invoice_no, s.course_title, s.amount_paid, s.teacher_amount,
           s.platform_amount, s.created_at,
           coalesce(p.full_name, 'المنصة') as teacher_name
    from sales s
    left join public.profiles p on p.id = s.teacher_id
    order by s.created_at desc
    limit 100
  )
  select jsonb_build_object(
    'sales_count', (select count(*) from sales),
    'gross_sales', coalesce((select sum(amount_paid) from sales), 0),
    'platform_share', coalesce((select sum(platform_amount) from sales), 0),
    'teacher_due', coalesce((select sum(teacher_amount) from sales), 0),
    'student_wallet_balances', coalesce((
      select sum(balance) from public.profiles where role = 'student'
    ), 0),
    'teacher_totals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'teacher_id', t.teacher_id,
        'teacher_name', t.teacher_name,
        'amount_due', t.amount_due,
        'sales_count', t.sales_count
      ) order by t.amount_due desc, t.teacher_name)
      from teacher_totals t
    ), '[]'::jsonb),
    'recent_sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'invoice_no', r.invoice_no,
        'course_title', r.course_title,
        'teacher_name', r.teacher_name,
        'amount_paid', r.amount_paid,
        'teacher_amount', r.teacher_amount,
        'platform_amount', r.platform_amount,
        'created_at', r.created_at
      ) order by r.created_at desc)
      from recent r
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_finance_overview() from public, anon;
grant execute on function public.admin_finance_overview() to authenticated;
