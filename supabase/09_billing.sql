-- الخطوة 9: الفواتير والاشتراك في الكورسات المدفوعة من رصيد المحفظة
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 08)
--
-- الفكرة:
--  1) الطالب يضغط "اشترك" على كورس مدفوع، ودالة purchase_course بتعمل كل حاجة في عملية واحدة:
--     تخصم السعر من رصيده + تعمل فاتورة + تسجّله في الكورس + تسجّل الحركة في سجل المحفظة.
--     لو أي خطوة فشلت، كل حاجة بتتلغي ومفيش فلوس بتتخصم من غير اشتراك.
--  2) الفواتير ما بتتعدّلش من الموقع خالص، والدالة هي الوحيدة اللي بتكتب فيها.
--  3) اسم الكورس بيتحفظ جوه الفاتورة، فتفضل مفهومة حتى لو الكورس اتحذف بعد كده.

-- ========== 1) الفواتير وبنودها ==========
create sequence if not exists public.invoice_serial_seq start 1001;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  serial bigint not null unique,
  invoice_no text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  total numeric(10,2) not null check (total >= 0),
  payment_method text not null default 'wallet',
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists invoices_user_idx on public.invoices (user_id, paid_at desc);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  course_title text not null,
  price numeric(10,2) not null check (price >= 0)
);

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- ربط الاشتراك بالفاتورة (فاضي = تسجيل في كورس مجاني أو تسجيل من الإدارة)
alter table public.enrollments
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

-- ========== 2) الأمان (RLS) ==========
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists "invoices read" on public.invoices;
create policy "invoices read" on public.invoices for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "invoice items read" on public.invoice_items;
create policy "invoice items read" on public.invoice_items for select
  using (user_id = auth.uid() or public.is_admin());

-- مفيش كتابة في الفواتير من الموقع (الدالة بس هي اللي بتكتب)
revoke insert, update, delete on public.invoices from anon, authenticated;
revoke insert, update, delete on public.invoice_items from anon, authenticated;

-- التسجيل المباشر من الموقع يقدر يحدّد user_id وcourse_id بس،
-- فالطالب مايقدرش يزوّر رقم فاتورة أو تاريخ اشتراك. الشراء بيتم من الدالة تحت.
revoke insert on public.enrollments from anon, authenticated;
grant insert (user_id, course_id) on public.enrollments to authenticated;

-- ========== 3) الشراء من الرصيد ==========
-- بترجّع id الفاتورة. أكواد الأخطاء اللي الموقع بيفهمها:
--   EH001 = الرصيد مش كفاية | 23505 = مشترك بالفعل | 22023 = الكورس مجاني | P0002 = الكورس مش موجود أو مش منشور
create or replace function public.purchase_course(p_course uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_course  public.courses%rowtype;
  v_balance numeric(10,2);
  v_serial  bigint;
  v_invoice uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_course from public.courses where id = p_course and is_published;
  if not found then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if v_course.price <= 0 then
    raise exception 'course is free' using errcode = '22023';
  end if;

  -- نقفل صف الطالب الأول: لو داس "اشترك" مرتين بسرعة، التانية بتستنى الأولى وبعدين بتشوف إنه مشترك
  select balance into v_balance from public.profiles where id = v_user for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.enrollments where user_id = v_user and course_id = p_course) then
    raise exception 'already enrolled' using errcode = '23505';
  end if;

  if v_balance < v_course.price then
    raise exception 'insufficient balance' using errcode = 'EH001';
  end if;

  update public.profiles set balance = balance - v_course.price where id = v_user;

  v_serial := nextval('public.invoice_serial_seq');
  insert into public.invoices (serial, invoice_no, user_id, total, payment_method)
  values (
    v_serial,
    'EH-' || to_char(timezone('Africa/Cairo', now()), 'YYMM') || '-' || lpad(v_serial::text, 5, '0'),
    v_user, v_course.price, 'wallet'
  )
  returning id into v_invoice;

  insert into public.invoice_items (invoice_id, user_id, course_id, course_title, price)
  values (v_invoice, v_user, v_course.id, v_course.title, v_course.price);

  insert into public.wallet_transactions (user_id, amount, kind, note, created_by)
  values (v_user, -v_course.price, 'purchase', 'اشتراك في كورس: ' || v_course.title, v_user);

  insert into public.enrollments (user_id, course_id, invoice_id)
  values (v_user, v_course.id, v_invoice);

  return v_invoice;
end;
$$;

revoke all on function public.purchase_course(uuid) from public, anon;
grant execute on function public.purchase_course(uuid) to authenticated;
