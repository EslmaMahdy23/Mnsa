-- Admin controls for automatic student notifications.
-- Run after 81_certificate_image_templates.sql.

alter table public.student_notifications
  drop constraint if exists student_notifications_source_type_check;
alter table public.student_notifications
  add constraint student_notifications_source_type_check
  check (source_type in (
    'course', 'lesson', 'exam', 'exam_result', 'exam_essay_review',
    'lecture_schedule', 'live_session', 'subscription', 'wallet_topup',
    'certificate', 'forum_answer', 'admin_broadcast'
  ));

create table if not exists public.student_notification_settings (
  source_type text primary key check (source_type in (
    'course', 'lesson', 'exam', 'exam_result', 'exam_essay_review',
    'lecture_schedule', 'live_session', 'subscription', 'wallet_topup',
    'certificate', 'forum_answer', 'admin_broadcast'
  )),
  label text not null,
  description text not null,
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.student_notification_settings enable row level security;
revoke all on public.student_notification_settings from public, anon, authenticated;

insert into public.student_notification_settings(source_type,label,description) values
  ('course','نشر كورس جديد','إبلاغ الطلاب المناسبين عند نشر كورس.'),
  ('lesson','إضافة درس أو ملف','إبلاغ المشتركين عند إضافة محتوى جديد لكورس منشور.'),
  ('exam','امتحان جديد','إبلاغ طلاب الكورس أو الصف عند نشر امتحان.'),
  ('exam_result','نتيجة امتحان','إبلاغ الطالب بعد تسليم الامتحان وظهور نتيجته.'),
  ('exam_essay_review','تصحيح سؤال مقالي','إبلاغ الطالب بعد اعتماد تصحيح الإجابات المقالية.'),
  ('lecture_schedule','جدول محاضرات','إبلاغ الطلاب المشتركين عند نشر جدول محاضرات للكورس أو الصف.'),
  ('live_session','حصة مباشرة','تأكيد حجز الحصة وإبلاغ الطالب بتعديل موعدها.'),
  ('subscription','اشتراك كورس','تأكيد تسجيل اشتراك الطالب في الكورس.'),
  ('wallet_topup','طلب شحن المحفظة','إبلاغ الطالب بقبول طلب الشحن أو رفضه.'),
  ('certificate','شهادة جديدة','إبلاغ الطالب عند إرسال شهادة النجاح.'),
  ('forum_answer','رد على سؤال المنتدى','إبلاغ الطالب عند الرد على سؤاله.'),
  ('admin_broadcast','رسالة من الإدارة','الرسائل التي يرسلها الأدمن يدويًا للطلاب.')
on conflict(source_type) do update set label=excluded.label,description=excluded.description;

create or replace function public.student_notification_is_enabled(p_source_type text)
returns boolean language sql security definer stable set search_path=public as $$
  select coalesce((select s.enabled from public.student_notification_settings s where s.source_type=p_source_type),true);
$$;
revoke all on function public.student_notification_is_enabled(text) from public, anon, authenticated;

create or replace function public.filter_disabled_student_notification()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.student_notification_is_enabled(new.source_type) then return null; end if;
  return new;
end;
$$;
revoke all on function public.filter_disabled_student_notification() from public, anon, authenticated;
drop trigger if exists student_notifications_filter_disabled on public.student_notifications;
create trigger student_notifications_filter_disabled
  before insert on public.student_notifications
  for each row execute function public.filter_disabled_student_notification();

create or replace function public.admin_set_student_notification_setting(p_source_type text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'invalid setting' using errcode='22023'; end if;
  update public.student_notification_settings
    set enabled=p_enabled,updated_by=auth.uid(),updated_at=now()
    where source_type=p_source_type;
  if not found then raise exception 'unknown notification type' using errcode='22023'; end if;
end;
$$;

create or replace function public.admin_get_student_notification_center()
returns jsonb language plpgsql security definer stable set search_path=public as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode='42501'; end if;
  select jsonb_build_object(
    'settings',coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_type',s.source_type,'label',s.label,'description',s.description,'enabled',s.enabled
      ) order by s.label)
      from public.student_notification_settings s
    ),'[]'::jsonb),
    'recent',coalesce((
      select jsonb_agg(to_jsonb(events) order by events.last_sent_at desc)
      from (
        select n.source_type,n.source_id,n.title,n.message,n.href,
               max(n.created_at) as last_sent_at,count(*)::integer as recipients
        from public.student_notifications n
        group by n.source_type,n.source_id,n.title,n.message,n.href
        order by max(n.created_at) desc
        limit 50
      ) events
    ),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_set_student_notification_setting(text,boolean) from public,anon;
revoke all on function public.admin_get_student_notification_center() from public,anon;
grant execute on function public.admin_set_student_notification_setting(text,boolean) to authenticated;
grant execute on function public.admin_get_student_notification_center() to authenticated;

-- A teacher or admin may publish a new exam; notify students in the course or grade.
create or replace function public.notify_students_on_exam_publish()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.is_published and new.question_count>0
     and (tg_op='INSERT' or old.is_published is false or old.question_count=0) then
    if new.course_id is not null then
      insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
      select en.user_id,'exam',new.id,'امتحان جديد: '||new.title,
             'تم نشر امتحان جديد في أحد كورساتك.','/dashboard/exams/'||new.id
      from public.enrollments en join public.profiles p on p.id=en.user_id and p.role='student'
      where en.course_id=new.course_id
      on conflict(user_id,source_type,source_id) do nothing;
    else
      insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
      select p.id,'exam',new.id,'امتحان جديد: '||new.title,
             'تم نشر امتحان جديد متاح لك.','/dashboard/exams/'||new.id
      from public.profiles p where p.role='student' and (new.grade is null or p.grade=new.grade)
      on conflict(user_id,source_type,source_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists exams_notify_students_on_publish on public.exams;
create trigger exams_notify_students_on_publish
  after insert or update of is_published,question_count on public.exams
  for each row execute function public.notify_students_on_exam_publish();
revoke all on function public.notify_students_on_exam_publish() from public,anon,authenticated;

create or replace function public.notify_students_on_lesson_insert()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
  select en.user_id,'lesson',new.id,
         case when new.kind='video' then 'فيديو جديد في كورسك' else 'ملف جديد في كورسك' end,
         'تمت إضافة محتوى جديد: '||new.title,
         '/dashboard/courses/'||new.course_id
  from public.courses c join public.enrollments en on en.course_id=c.id
  join public.profiles p on p.id=en.user_id and p.role='student'
  where c.id=new.course_id and c.is_published
  on conflict(user_id,source_type,source_id) do nothing;
  return new;
end;
$$;
drop trigger if exists lessons_notify_students_on_insert on public.lessons;
create trigger lessons_notify_students_on_insert after insert on public.lessons
  for each row execute function public.notify_students_on_lesson_insert();
revoke all on function public.notify_students_on_lesson_insert() from public,anon,authenticated;

create or replace function public.notify_student_on_certificate_sent()
returns trigger language plpgsql security definer set search_path=public as $$
declare exam_title text; course_title text;
begin
  if new.status='sent' and old.status is distinct from 'sent' then
    select e.title,coalesce(c.title,'') into exam_title,course_title
    from public.exams e left join public.courses c on c.id=e.course_id where e.id=new.exam_id;
    insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    values(new.student_id,'certificate',new.attempt_id,'شهادتك جاهزة: '||coalesce(exam_title,'الامتحان'),
      case when course_title='' then 'تم إرسال شهادة اجتياز الامتحان إلى بريدك الإلكتروني.'
           else 'تم إرسال شهادة اجتياز «'||course_title||'» إلى بريدك الإلكتروني.' end,
      '/dashboard/certificates')
    on conflict(user_id,source_type,source_id) do update set created_at=now(),read_at=null;
  end if;
  return new;
end;
$$;
drop trigger if exists exam_certificate_delivery_notify_student on public.exam_certificate_deliveries;
create trigger exam_certificate_delivery_notify_student after update of status on public.exam_certificate_deliveries
  for each row execute function public.notify_student_on_certificate_sent();
revoke all on function public.notify_student_on_certificate_sent() from public,anon,authenticated;

create or replace function public.notify_student_on_exam_result()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.submitted_at is not null and not new.essay_pending
     and (tg_op='INSERT' or old.submitted_at is null) then
    insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    values(new.user_id,'exam_result',new.id,'نتيجة امتحان: '||coalesce(new.exam_title,'الامتحان'),
      case when new.percent is null then 'تم تسليم الامتحان، راجع نتيجتك.'
           else 'تم حفظ نتيجتك: '||new.percent::text||'%.' end,
      '/dashboard/profile')
    on conflict(user_id,source_type,source_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists exam_attempts_notify_student_result on public.exam_attempts;
create trigger exam_attempts_notify_student_result after insert or update of submitted_at on public.exam_attempts
  for each row execute function public.notify_student_on_exam_result();
revoke all on function public.notify_student_on_exam_result() from public,anon,authenticated;

create or replace function public.notify_student_on_enrollment()
returns trigger language plpgsql security definer set search_path=public as $$
declare course_title text;
begin
  select title into course_title from public.courses where id=new.course_id;
  insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
  values(new.user_id,'subscription',new.course_id,'تم اشتراكك في الكورس',
    'أصبح كورس «'||coalesce(course_title,'')||'» متاحًا في حسابك.','/dashboard/courses/'||new.course_id)
  on conflict(user_id,source_type,source_id) do nothing;
  return new;
end;
$$;
drop trigger if exists enrollments_notify_student on public.enrollments;
create trigger enrollments_notify_student after insert on public.enrollments
  for each row execute function public.notify_student_on_enrollment();
revoke all on function public.notify_student_on_enrollment() from public,anon,authenticated;

create or replace function public.notify_student_on_topup_review()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status='pending' and new.status in ('approved','rejected') then
    insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    values(new.user_id,'wallet_topup',new.id,
      case when new.status='approved' then 'تم قبول طلب شحن المحفظة' else 'تحديث طلب شحن المحفظة' end,
      case when new.status='approved' then 'تمت إضافة الرصيد إلى محفظتك.'
           else 'تعذر قبول طلب الشحن. راجع تفاصيل الطلب في محفظتك.' end,
      '/dashboard/wallet')
    on conflict(user_id,source_type,source_id) do update set created_at=now(),read_at=null;
  end if;
  return new;
end;
$$;
drop trigger if exists wallet_topups_notify_student_on_review on public.wallet_topups;
create trigger wallet_topups_notify_student_on_review after update of status on public.wallet_topups
  for each row execute function public.notify_student_on_topup_review();
revoke all on function public.notify_student_on_topup_review() from public,anon,authenticated;

create or replace function public.notify_student_on_live_session_booking()
returns trigger language plpgsql security definer set search_path=public as $$
declare session_title text;
begin
  if new.cancelled_at is null and (tg_op='INSERT' or old.cancelled_at is not null) then
    select title into session_title from public.live_sessions where id=new.session_id;
    insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    values(new.student_id,'live_session',new.id,'تم تأكيد حجز الحصة',
      'حجزك «'||coalesce(session_title,'الحصة المباشرة')||'» اتأكد. راجع حصصك لمعرفة الموعد.','/dashboard/live-sessions')
    on conflict(user_id,source_type,source_id) do update set created_at=now(),read_at=null;
  end if;
  return new;
end;
$$;
drop trigger if exists live_session_bookings_notify_student on public.live_session_bookings;
create trigger live_session_bookings_notify_student after insert or update of cancelled_at on public.live_session_bookings
  for each row execute function public.notify_student_on_live_session_booking();
revoke all on function public.notify_student_on_live_session_booking() from public,anon,authenticated;

create or replace function public.notify_students_on_live_session_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.is_published and old.is_published and
     (new.session_at is distinct from old.session_at or new.title is distinct from old.title) then
    insert into public.student_notifications(user_id,source_type,source_id,title,message,href)
    select b.student_id,'live_session',b.id,'تم تحديث موعد الحصة',
      'تم تعديل تفاصيل «'||new.title||'». راجع حصصك للتوقيت الجديد.','/dashboard/live-sessions'
    from public.live_session_bookings b
    where b.session_id=new.id and b.cancelled_at is null
    on conflict(user_id,source_type,source_id) do update set created_at=now(),read_at=null;
  end if;
  return new;
end;
$$;
drop trigger if exists live_sessions_notify_booked_students on public.live_sessions;
create trigger live_sessions_notify_booked_students after update of session_at,title on public.live_sessions
  for each row execute function public.notify_students_on_live_session_update();
revoke all on function public.notify_students_on_live_session_update() from public,anon,authenticated;
