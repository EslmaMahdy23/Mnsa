-- Admin-only operational and security overview, based on existing database records.
-- Run this migration in Supabase SQL Editor after the existing project migrations.

create or replace function public.admin_platform_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with metrics as (
    select
      (select count(*) from auth.users) as accounts_total,
      (select count(*) from auth.users where last_sign_in_at >= now() - interval '24 hours') as signins_24h,
      (select count(*) from auth.users where email_confirmed_at is null) as unconfirmed_emails,
      (select count(*) from public.profiles where role='student') as students,
      (select count(*) from public.profiles where role='teacher') as teachers,
      (select count(*) from public.courses where is_published) as published_courses,
      (select count(*) from public.courses where not is_published) as unpublished_courses,
      (select count(*) from public.courses where approval_status='pending') as courses_pending_review,
      (select count(*) from public.teacher_applications where status='pending') as teacher_applications_pending,
      (select count(*) from public.wallet_topups where status='pending') as topups_pending,
      (select count(*) from public.wallet_topups where status='pending' and created_at < now() - interval '48 hours') as topups_stale,
      (select count(*) from public.support_tickets where status <> 'closed') as support_open,
      (select count(*) from public.exam_attempts where submitted_at >= now() - interval '24 hours' and submitted_at is not null) as exams_submitted_24h,
      (select count(*) from public.student_notifications where read_at is null and created_at >= now() - interval '7 days') as unread_notifications_7d,
      (select max(last_sign_in_at) from auth.users) as latest_signin
  ), events as (
    select u.last_sign_in_at as occurred_at, 'signin'::text as event_type,
           'تسجيل دخول ناجح'::text as title,
           coalesce(p.full_name, u.email, 'حساب')::text as detail,
           'normal'::text as severity
      from auth.users u left join public.profiles p on p.id=u.id
     where u.last_sign_in_at is not null
    union all
    select p.created_at, 'account', 'إنشاء حساب جديد',
           coalesce(p.full_name, u.email, 'حساب')::text,
           'normal'
      from public.profiles p join auth.users u on u.id=p.id
    union all
    select c.created_at, 'course',
           case when c.is_published then 'إنشاء كورس منشور' else 'إنشاء كورس غير منشور' end,
           c.title::text,
           case when c.is_published then 'normal' else 'notice' end
      from public.courses c
    union all
    select a.submitted_at, 'exam', 'تسليم امتحان',
           coalesce(p.full_name, 'طالب') || ' · ' || a.exam_title,
           'normal'
      from public.exam_attempts a left join public.profiles p on p.id=a.user_id
     where a.submitted_at is not null
    union all
    select t.created_at, 'topup',
           case when t.status='pending' then 'طلب شحن بانتظار المراجعة' else 'طلب شحن جديد' end,
           coalesce(p.full_name, 'طالب') || ' · ' || t.amount::text || ' جنيه',
           case when t.status='pending' then 'notice' else 'normal' end
      from public.wallet_topups t left join public.profiles p on p.id=t.user_id
    union all
    select st.created_at, 'support', 'فتح تذكرة دعم',
           coalesce(p.full_name, 'مستخدم') || ' · ' || st.subject,
           'notice'
      from public.support_tickets st left join public.profiles p on p.id=st.user_id
    union all
    select ta.updated_at, 'teacher',
           case when ta.status='pending' then 'طلب تدريس قيد المراجعة' else 'تحديث طلب تدريس' end,
           coalesce(ta.full_name, p.full_name, 'مدرس')::text,
           case when ta.status='pending' then 'notice' else 'normal' end
      from public.teacher_applications ta left join public.profiles p on p.id=ta.user_id
  )
  select jsonb_build_object(
    'checked_at', now(),
    'metrics', to_jsonb(m),
    'alerts', jsonb_build_array(
      jsonb_build_object('key','topups','severity',case when m.topups_stale>0 then 'critical' when m.topups_pending>0 then 'warning' else 'ok' end,
        'title',case when m.topups_stale>0 then 'طلبات شحن متأخرة' when m.topups_pending>0 then 'طلبات شحن تنتظر المراجعة' else 'طلبات الشحن تحت السيطرة' end,
        'detail',m.topups_pending::text || ' طلب معلّق، منها ' || m.topups_stale::text || ' أقدم من 48 ساعة','href','/dashboard/admin/topups'),
      jsonb_build_object('key','courses','severity',case when m.courses_pending_review>0 then 'warning' else 'ok' end,
        'title',case when m.courses_pending_review>0 then 'كورسات تنتظر المراجعة' else 'مراجعة الكورسات مكتملة' end,
        'detail',m.courses_pending_review::text || ' كورس في قائمة المراجعة','href','/dashboard/admin/courses'),
      jsonb_build_object('key','teachers','severity',case when m.teacher_applications_pending>0 then 'warning' else 'ok' end,
        'title',case when m.teacher_applications_pending>0 then 'طلبات مدرسين جديدة' else 'طلبات المدرسين محدثة' end,
        'detail',m.teacher_applications_pending::text || ' طلب قيد المراجعة','href','/dashboard/admin/teacher-applications'),
      jsonb_build_object('key','support','severity',case when m.support_open>0 then 'warning' else 'ok' end,
        'title',case when m.support_open>0 then 'تذاكر دعم مفتوحة' else 'صندوق الدعم هادئ' end,
        'detail',m.support_open::text || ' تذكرة غير مغلقة','href','/dashboard/admin/support'),
      jsonb_build_object('key','email','severity',case when m.unconfirmed_emails>0 then 'notice' else 'ok' end,
        'title',case when m.unconfirmed_emails>0 then 'حسابات بريدها غير مؤكد' else 'تأكيد البريد مكتمل' end,
        'detail',m.unconfirmed_emails::text || ' حساب غير مؤكد','href','/dashboard/admin/users')
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('occurred_at',e.occurred_at,'event_type',e.event_type,'title',e.title,'detail',e.detail,'severity',e.severity)
        order by e.occurred_at desc)
      from (select * from events order by occurred_at desc limit 24) e
    ), '[]'::jsonb)
  ) into result
  from metrics m;

  return result;
end;
$$;

revoke all on function public.admin_platform_status() from public, anon;
grant execute on function public.admin_platform_status() to authenticated;
