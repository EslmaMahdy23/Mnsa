-- الخطوة 8: المحفظة وطلبات شحن الرصيد
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 06 و07، لأنه بيحدّث admin_stats)
--
-- الفكرة:
--  1) الطالب يبعت طلب شحن (المبلغ + رقم اللي حوّل منه + سكرين التحويل).
--  2) الأدمن يراجع السكرين من لوحة الأدمن ويقبل أو يرفض.
--  3) عند القبول الرصيد بيتضاف تلقائياً ويتسجّل في سجل الحركات.
-- الأمان: الطالب مايقدرش يعدّل رصيده ولا حالة طلبه ولا سجل الحركات. ده كله بيتم
-- من دالة admin_review_topup اللي بتتأكد إن اللي بيندهها أدمن.

-- ========== 1) الرصيد ==========
-- (التعديل على profiles من الموقع محدد بأعمدة معيّنة بس، والرصيد مش منهم)
alter table public.profiles
  add column if not exists balance numeric(10,2) not null default 0;

alter table public.profiles drop constraint if exists profiles_balance_check;
alter table public.profiles
  add constraint profiles_balance_check check (balance >= 0);

-- ========== 2) طلبات الشحن ==========
create table if not exists public.wallet_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null check (amount >= 10 and amount <= 20000),
  sender_phone text not null check (sender_phone ~ '^01[0125][0-9]{8}$'),
  screenshot_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_amount numeric(10,2),
  admin_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wallet_topups_user_idx on public.wallet_topups (user_id, created_at desc);
create index if not exists wallet_topups_status_idx on public.wallet_topups (status, created_at desc);

-- ========== 3) سجل الحركات (كل فلوس دخلت أو خرجت) ==========
-- topup_id فريد: كل طلب شحن ينضاف رصيده مرة واحدة بس مهما حصل.
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null,
  kind text not null check (kind in ('topup', 'purchase', 'adjustment')),
  topup_id uuid unique references public.wallet_topups(id) on delete set null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wallet_tx_user_idx on public.wallet_transactions (user_id, created_at desc);

-- ========== 4) الأمان (RLS) ==========
alter table public.wallet_topups enable row level security;
alter table public.wallet_transactions enable row level security;

-- كل طالب يشوف طلباته وحركاته هو بس، والأدمن يشوف الكل
drop policy if exists "topups read" on public.wallet_topups;
create policy "topups read" on public.wallet_topups for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "transactions read" on public.wallet_transactions;
create policy "transactions read" on public.wallet_transactions for select
  using (user_id = auth.uid() or public.is_admin());

-- الطالب يبعت طلب جديد بالحالة pending بس، والسكرين لازم يكون جوه فولدره هو،
-- ومايكونش عنده 3 طلبات معلّقة أو أكتر (عشان ما يغرقش الأدمن بطلبات)
drop policy if exists "topups insert own" on public.wallet_topups;
create policy "topups insert own" on public.wallet_topups for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and approved_amount is null
    and reviewed_by is null
    and reviewed_at is null
    and admin_note is null
    and screenshot_path like auth.uid()::text || '/%'
    and (select count(*) from public.wallet_topups t
         where t.user_id = auth.uid() and t.status = 'pending') < 3
  );

-- مفيش تعديل أو حذف من الموقع خالص، ولا كتابة في سجل الحركات (الدوال بس هي اللي بتكتب)
revoke update, delete on public.wallet_topups from anon, authenticated;
revoke insert, update, delete on public.wallet_transactions from anon, authenticated;

-- ========== 5) تخزين السكرينات (باكت خاص، مش عام) ==========
-- الطالب يرفع في فولدر باسم الـ id بتاعه بس. الشوف: صاحب السكرين والأدمن بس.
-- الحد الأقصى 5 ميجا، وصيغ الصور: jpg وpng وwebp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "proofs upload own" on storage.objects;
create policy "proofs upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "proofs read own or admin" on storage.objects;
create policy "proofs read own or admin" on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ========== 6) قائمة طلبات الشحن للأدمن (بالإيميل) مع فلتر وصفحات ==========
-- المعلّقة الأول، وبعدها الأحدث.
create or replace function public.admin_list_topups(
  p_status text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  user_id uuid,
  email text,
  full_name text,
  phone text,
  amount numeric,
  sender_phone text,
  screenshot_path text,
  status text,
  approved_amount numeric,
  admin_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  total_count bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
    select w.id, w.user_id, u.email::text, p.full_name, p.phone, w.amount, w.sender_phone,
           w.screenshot_path, w.status, w.approved_amount, w.admin_note, w.created_at, w.reviewed_at,
           count(*) over ()
    from public.wallet_topups w
    join public.profiles p on p.id = w.user_id
    join auth.users u on u.id = w.user_id
    where (nullif(p_status, '') is null or w.status = p_status)
    order by (w.status = 'pending') desc, w.created_at desc
    limit least(greatest(p_limit, 1), 100)
    offset greatest(p_offset, 0);
end;
$$;

-- ========== 7) قبول أو رفض طلب شحن ==========
-- القبول بيضيف الرصيد + يسجّل الحركة + يقفل الطلب في عملية واحدة.
-- الصف بيتقفل (for update) فلو دوست قبول مرتين، التانية بتترفض ومفيش رصيد بيتضاف مرتين.
-- p_amount اختياري: لو السكرين بيقول مبلغ غير اللي الطالب كتبه، تقدر تقبل بالمبلغ الصحيح.
create or replace function public.admin_review_topup(
  p_id uuid,
  p_approve boolean,
  p_amount numeric default null,
  p_note text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_topup  public.wallet_topups%rowtype;
  v_amount numeric(10,2);
  v_note   text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 100000) then
    raise exception 'bad amount' using errcode = '22023';
  end if;

  select * into v_topup from public.wallet_topups where id = p_id for update;
  if not found then
    raise exception 'topup not found' using errcode = 'P0002';
  end if;
  if v_topup.status <> 'pending' then
    raise exception 'already reviewed' using errcode = '55000';
  end if;

  if p_approve then
    v_amount := coalesce(p_amount, v_topup.amount);

    update public.profiles set balance = balance + v_amount where id = v_topup.user_id;

    insert into public.wallet_transactions (user_id, amount, kind, topup_id, note, created_by)
    values (v_topup.user_id, v_amount, 'topup', v_topup.id, v_note, auth.uid());

    update public.wallet_topups
       set status = 'approved', approved_amount = v_amount, admin_note = v_note,
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = v_topup.id;
  else
    update public.wallet_topups
       set status = 'rejected', admin_note = v_note,
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = v_topup.id;
  end if;
end;
$$;

-- ========== 8) إحصائيات اللوحة + عدد الطلبات المعلّقة ==========
create or replace function public.admin_stats()
returns json
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return json_build_object(
    'students',       (select count(*) from public.profiles where role = 'student'),
    'teachers',       (select count(*) from public.profiles where role = 'teacher'),
    'admins',         (select count(*) from public.profiles where role = 'admin'),
    'courses',        (select count(*) from public.courses),
    'published',      (select count(*) from public.courses where is_published),
    'lessons',        (select count(*) from public.lessons),
    'enrollments',    (select count(*) from public.enrollments),
    'pending_topups', (select count(*) from public.wallet_topups where status = 'pending')
  );
end;
$$;

-- ========== 9) الصلاحيات ==========
revoke all on function public.admin_list_topups(text, int, int) from public, anon;
revoke all on function public.admin_review_topup(uuid, boolean, numeric, text) from public, anon;
revoke all on function public.admin_stats() from public, anon;

grant execute on function public.admin_list_topups(text, int, int) to authenticated;
grant execute on function public.admin_review_topup(uuid, boolean, numeric, text) to authenticated;
grant execute on function public.admin_stats() to authenticated;
