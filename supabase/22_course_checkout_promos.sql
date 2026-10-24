-- الخطوة 22: صفحة دفع الكورس + أكواد خصم وتفعيل يديرها الأدمن
-- شغّله في Supabase SQL Editor بعد 21_admin_notifications.sql.

create table if not exists public.course_promo_codes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  code text not null unique check (code = upper(trim(code)) and code ~ '^[A-Z0-9-]{3,32}$'),
  discount_type text not null check (discount_type in ('percent', 'fixed', 'activation')),
  discount_value numeric(10,2) not null default 0,
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint course_promo_value_check check (
    (discount_type = 'percent' and discount_value > 0 and discount_value <= 100)
    or (discount_type = 'fixed' and discount_value > 0)
    or (discount_type = 'activation' and discount_value = 0)
  )
);

create index if not exists course_promo_course_idx on public.course_promo_codes (course_id, is_active);

create table if not exists public.course_promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.course_promo_codes(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  redeemed_at timestamptz not null default now(),
  unique (promo_code_id, user_id)
);

alter table public.course_promo_codes enable row level security;
alter table public.course_promo_redemptions enable row level security;

drop policy if exists "admins manage course promo codes" on public.course_promo_codes;
create policy "admins manage course promo codes" on public.course_promo_codes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins read course promo redemptions" on public.course_promo_redemptions;
create policy "admins read course promo redemptions" on public.course_promo_redemptions
  for select to authenticated using (public.is_admin());

revoke all on public.course_promo_codes, public.course_promo_redemptions from anon, authenticated;
grant select, insert, update, delete on public.course_promo_codes to authenticated;
grant select on public.course_promo_redemptions to authenticated;

alter table public.invoices
  add column if not exists original_total numeric(10,2) not null default 0,
  add column if not exists discount_amount numeric(10,2) not null default 0,
  add column if not exists promo_code text;
update public.invoices set original_total = total where original_total = 0 and total > 0;
alter table public.invoice_items
  add column if not exists original_price numeric(10,2) not null default 0,
  add column if not exists discount_amount numeric(10,2) not null default 0;
update public.invoice_items set original_price = price where original_price = 0 and price > 0;

create or replace function public.preview_course_promo(p_course uuid, p_code text default null)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_course public.courses%rowtype;
  v_code public.course_promo_codes%rowtype;
  v_user uuid := auth.uid();
  v_discount numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_input text := upper(trim(coalesce(p_code, '')));
  v_valid boolean := true;
  v_message text := null;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_course from public.courses where id = p_course and is_published;
  if not found then raise exception 'course not found' using errcode = 'P0002'; end if;
  v_total := v_course.price;

  if exists (select 1 from public.enrollments where user_id = v_user and course_id = p_course) then
    return jsonb_build_object('course_id', p_course, 'course_title', v_course.title, 'price', v_course.price,
      'discount', 0, 'total', v_course.price, 'code', null, 'code_type', null, 'code_valid', null,
      'message', 'أنت مشترك في الكورس بالفعل.', 'already_enrolled', true);
  end if;

  if v_input <> '' then
    select * into v_code from public.course_promo_codes where code = v_input;
    if not found or v_code.course_id <> p_course then
      v_valid := false; v_message := 'الكود غير صحيح أو غير مخصص لهذا الكورس.';
    elsif not v_code.is_active then
      v_valid := false; v_message := 'الكود ده متوقف حاليًا.';
    elsif v_code.expires_at is not null and v_code.expires_at <= now() then
      v_valid := false; v_message := 'مدة صلاحية الكود انتهت.';
    elsif v_code.max_uses is not null and v_code.used_count >= v_code.max_uses then
      v_valid := false; v_message := 'عدد مرات استخدام الكود اكتمل.';
    elsif exists (select 1 from public.course_promo_redemptions r where r.promo_code_id = v_code.id and r.user_id = v_user) then
      v_valid := false; v_message := 'استخدمت الكود ده قبل كده.';
    else
      if v_code.discount_type = 'activation' then v_discount := v_course.price;
      elsif v_code.discount_type = 'percent' then v_discount := round(v_course.price * v_code.discount_value / 100, 2);
      else v_discount := least(v_course.price, v_code.discount_value); end if;
      v_total := greatest(0, v_course.price - v_discount);
      v_message := case when v_code.discount_type = 'activation' then 'كود التفعيل هيفتح الكورس من غير خصم من المحفظة.' else 'تم تطبيق الخصم على السعر.' end;
    end if;
  end if;

  return jsonb_build_object('course_id', p_course, 'course_title', v_course.title, 'price', v_course.price,
    'discount', case when v_valid then v_discount else 0 end,
    'total', case when v_valid then v_total else v_course.price end,
    'code', case when v_valid and v_input <> '' then v_input else null end,
    'code_type', case when v_valid and v_input <> '' then v_code.discount_type else null end,
    'code_valid', case when v_input = '' then null else v_valid end,
    'message', v_message, 'already_enrolled', false);
end;
$$;

create or replace function public.purchase_course_with_code(p_course uuid, p_code text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_course public.courses%rowtype;
  v_code public.course_promo_codes%rowtype;
  v_code_text text := upper(trim(coalesce(p_code, '')));
  v_discount numeric(10,2) := 0;
  v_total numeric(10,2);
  v_balance numeric(10,2);
  v_serial bigint;
  v_invoice uuid;
  v_invoice_no text;
  v_payment_method text := 'wallet';
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_course from public.courses where id = p_course and is_published;
  if not found then raise exception 'course not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.enrollments where user_id = v_user and course_id = p_course) then
    raise exception 'already enrolled' using errcode = '23505';
  end if;

  if v_code_text <> '' then
    select * into v_code from public.course_promo_codes where code = v_code_text for update;
    if not found or v_code.course_id <> p_course or not v_code.is_active
       or (v_code.expires_at is not null and v_code.expires_at <= now())
       or (v_code.max_uses is not null and v_code.used_count >= v_code.max_uses)
       or exists (select 1 from public.course_promo_redemptions r where r.promo_code_id = v_code.id and r.user_id = v_user) then
      raise exception 'promo code invalid or unavailable' using errcode = '22023';
    end if;
    if v_code.discount_type = 'activation' then
      v_discount := v_course.price;
      v_payment_method := 'activation_code';
    elsif v_code.discount_type = 'percent' then
      v_discount := round(v_course.price * v_code.discount_value / 100, 2);
    else
      v_discount := least(v_course.price, v_code.discount_value);
    end if;
  elsif v_course.price <= 0 then
    raise exception 'course is free' using errcode = '22023';
  end if;
  v_total := greatest(0, v_course.price - v_discount);

  select balance into v_balance from public.profiles where id = v_user for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  -- بعد قفل صف الطالب نعيد الفحص؛ كده محاولتا شراء متزامنتان ما تعملوش اشتراكين للكورس نفسه.
  if exists (select 1 from public.enrollments where user_id = v_user and course_id = p_course) then
    raise exception 'already enrolled' using errcode = '23505';
  end if;
  if v_total > 0 and v_balance < v_total then raise exception 'insufficient balance' using errcode = 'EH001'; end if;
  if v_total > 0 then update public.profiles set balance = balance - v_total where id = v_user; end if;

  v_serial := nextval('public.invoice_serial_seq');
  v_invoice_no := 'EH-' || to_char(timezone('Africa/Cairo', now()), 'YYMM') || '-' || lpad(v_serial::text, 5, '0');
  insert into public.invoices (serial, invoice_no, user_id, total, payment_method, original_total, discount_amount, promo_code)
  values (v_serial, v_invoice_no, v_user, v_total, v_payment_method, v_course.price, v_discount, nullif(v_code_text, ''))
  returning id into v_invoice;
  insert into public.invoice_items (invoice_id, user_id, course_id, course_title, price, original_price, discount_amount)
  values (v_invoice, v_user, v_course.id, v_course.title, v_total, v_course.price, v_discount);

  if v_total > 0 then
    insert into public.wallet_transactions (user_id, amount, kind, note, created_by)
    values (v_user, -v_total, 'purchase', 'اشتراك في كورس: ' || v_course.title || case when v_code_text <> '' then ' (كود ' || v_code_text || ')' else '' end, v_user);
  end if;
  insert into public.enrollments (user_id, course_id, invoice_id) values (v_user, v_course.id, v_invoice);

  if v_code_text <> '' then
    insert into public.course_promo_redemptions (promo_code_id, user_id, course_id, invoice_id)
    values (v_code.id, v_user, v_course.id, v_invoice);
    update public.course_promo_codes set used_count = used_count + 1 where id = v_code.id;
  end if;

  return jsonb_build_object('invoice_id', v_invoice, 'invoice_no', v_invoice_no, 'total', v_total,
    'discount', v_discount, 'payment_method', v_payment_method, 'course_title', v_course.title);
end;
$$;

revoke all on function public.preview_course_promo(uuid, text) from public, anon;
revoke all on function public.purchase_course_with_code(uuid, text) from public, anon;
grant execute on function public.preview_course_promo(uuid, text) to authenticated;
grant execute on function public.purchase_course_with_code(uuid, text) to authenticated;
