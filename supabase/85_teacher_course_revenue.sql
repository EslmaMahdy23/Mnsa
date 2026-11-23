-- Record the platform/teacher split atomically with each course purchase.
-- Run after 22_course_checkout_promos.sql.

create table if not exists public.platform_revenue_settings (
  id smallint primary key default 1 check (id = 1),
  platform_percent numeric(5,2) not null default 20
    check (platform_percent >= 0 and platform_percent <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.platform_revenue_settings (id, platform_percent)
values (1, 20)
on conflict (id) do nothing;

alter table public.platform_revenue_settings enable row level security;
revoke all on public.platform_revenue_settings from anon, authenticated;

drop policy if exists "admins read platform revenue settings" on public.platform_revenue_settings;
create policy "admins read platform revenue settings" on public.platform_revenue_settings
  for select to authenticated using (public.is_admin());

create table if not exists public.course_sales (
  invoice_id uuid primary key references public.invoices(id) on delete restrict,
  course_id uuid not null references public.courses(id) on delete restrict,
  teacher_id uuid references public.profiles(id) on delete set null,
  invoice_no text not null,
  course_title text not null,
  original_amount numeric(10,2) not null check (original_amount >= 0),
  discount_amount numeric(10,2) not null check (discount_amount >= 0),
  amount_paid numeric(10,2) not null check (amount_paid >= 0),
  teacher_percent numeric(5,2) not null check (teacher_percent >= 0 and teacher_percent <= 100),
  teacher_amount numeric(10,2) not null check (teacher_amount >= 0),
  platform_percent numeric(5,2) not null check (platform_percent >= 0 and platform_percent <= 100),
  platform_amount numeric(10,2) not null check (platform_amount >= 0),
  status text not null default 'paid' check (status in ('paid', 'reversed')),
  created_at timestamptz not null default now(),
  constraint course_sales_discount_within_price check (discount_amount <= original_amount),
  constraint course_sales_amounts_reconcile check (original_amount = discount_amount + amount_paid),
  constraint course_sales_percentages_reconcile check (teacher_percent + platform_percent = 100),
  constraint course_sales_split_matches_total check (teacher_amount + platform_amount = amount_paid)
);

create index if not exists course_sales_teacher_date_idx
  on public.course_sales (teacher_id, created_at desc);
create index if not exists course_sales_course_date_idx
  on public.course_sales (course_id, created_at desc);

alter table public.course_sales enable row level security;
revoke all on public.course_sales from anon, authenticated;
grant select on public.course_sales to authenticated;

drop policy if exists "teachers and admins read course sales" on public.course_sales;
create policy "teachers and admins read course sales" on public.course_sales
  for select to authenticated using (teacher_id = (select auth.uid()) or public.is_admin());

create or replace function public.set_platform_revenue_percent(p_percent numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then
    raise exception 'invalid platform percent' using errcode = '22023';
  end if;
  update public.platform_revenue_settings
     set platform_percent = round(p_percent, 2), updated_at = now(), updated_by = auth.uid()
   where id = 1;
end;
$$;

revoke all on function public.set_platform_revenue_percent(numeric) from public, anon;
grant execute on function public.set_platform_revenue_percent(numeric) to authenticated;

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
  v_platform_percent numeric(5,2);
  v_teacher_percent numeric(5,2);
  v_teacher_amount numeric(10,2);
  v_platform_amount numeric(10,2);
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_course
  from public.courses
  where id = p_course and is_published
  for share;
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

  -- Recheck while holding the student's balance row to prevent concurrent duplicate purchases.
  if exists (select 1 from public.enrollments where user_id = v_user and course_id = p_course) then
    raise exception 'already enrolled' using errcode = '23505';
  end if;
  if v_total > 0 and v_balance < v_total then
    raise exception 'insufficient balance' using errcode = 'EH001';
  end if;
  if v_total > 0 then
    update public.profiles set balance = balance - v_total where id = v_user;
  end if;

  v_serial := nextval('public.invoice_serial_seq');
  v_invoice_no := 'EH-' || to_char(timezone('Africa/Cairo', now()), 'YYMM') || '-' || lpad(v_serial::text, 5, '0');
  insert into public.invoices (serial, invoice_no, user_id, total, payment_method, original_total, discount_amount, promo_code)
  values (v_serial, v_invoice_no, v_user, v_total, v_payment_method, v_course.price, v_discount, nullif(v_code_text, ''))
  returning id into v_invoice;

  insert into public.invoice_items (invoice_id, user_id, course_id, course_title, price, original_price, discount_amount)
  values (v_invoice, v_user, v_course.id, v_course.title, v_total, v_course.price, v_discount);

  if v_total > 0 then
    insert into public.wallet_transactions (user_id, amount, kind, note, created_by)
    values (v_user, -v_total, 'purchase', 'اشتراك في كورس: ' || v_course.title ||
      case when v_code_text <> '' then ' (كود ' || v_code_text || ')' else '' end, v_user);
  end if;

  insert into public.enrollments (user_id, course_id, invoice_id)
  values (v_user, v_course.id, v_invoice);

  select platform_percent into v_platform_percent
  from public.platform_revenue_settings where id = 1;
  v_platform_percent := coalesce(v_platform_percent, 20);

  if v_course.teacher_id is null then
    v_teacher_percent := 0;
    v_teacher_amount := 0;
    v_platform_percent := 100;
    v_platform_amount := v_total;
  else
    v_teacher_percent := 100 - v_platform_percent;
    v_teacher_amount := round(v_total * v_teacher_percent / 100, 2);
    -- Subtract the rounded teacher amount so both shares always sum exactly to the paid amount.
    v_platform_amount := v_total - v_teacher_amount;
  end if;

  insert into public.course_sales (
    invoice_id, course_id, teacher_id, invoice_no, course_title,
    original_amount, discount_amount, amount_paid,
    teacher_percent, teacher_amount, platform_percent, platform_amount
  ) values (
    v_invoice, v_course.id, v_course.teacher_id, v_invoice_no, v_course.title,
    v_course.price, v_discount, v_total,
    v_teacher_percent, v_teacher_amount, v_platform_percent, v_platform_amount
  );

  if v_code_text <> '' then
    insert into public.course_promo_redemptions (promo_code_id, user_id, course_id, invoice_id)
    values (v_code.id, v_user, v_course.id, v_invoice);
    update public.course_promo_codes set used_count = used_count + 1 where id = v_code.id;
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice, 'invoice_no', v_invoice_no, 'total', v_total,
    'discount', v_discount, 'payment_method', v_payment_method, 'course_title', v_course.title
  );
end;
$$;

-- Keep the legacy RPC on the same audited path so it cannot bypass the split ledger.
create or replace function public.purchase_course(p_course uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  v_result := public.purchase_course_with_code(p_course, null);
  return (v_result->>'invoice_id')::uuid;
end;
$$;

create or replace function public.get_teacher_earnings()
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_user and role = 'teacher') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_earned', coalesce(sum(s.teacher_amount) filter (where s.status = 'paid'), 0),
    'sales_count', count(*) filter (where s.status = 'paid'),
    'platform_percent', coalesce((select r.platform_percent from public.platform_revenue_settings r where r.id = 1), 20),
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'invoice_no', recent.invoice_no,
        'course_title', recent.course_title,
        'amount_paid', recent.amount_paid,
        'teacher_amount', recent.teacher_amount,
        'created_at', recent.created_at
      ) order by recent.created_at desc)
      from (
        select s2.invoice_no, s2.course_title, s2.amount_paid, s2.teacher_amount, s2.created_at
        from public.course_sales s2
        where s2.teacher_id = v_user and s2.status = 'paid'
        order by s2.created_at desc
        limit 50
      ) recent
    ), '[]'::jsonb)
  ) into v_result
  from public.course_sales s
  where s.teacher_id = v_user;

  return v_result;
end;
$$;

revoke all on function public.purchase_course_with_code(uuid, text) from public, anon;
revoke all on function public.purchase_course(uuid) from public, anon;
revoke all on function public.get_teacher_earnings() from public, anon;
grant execute on function public.purchase_course_with_code(uuid, text) to authenticated;
grant execute on function public.purchase_course(uuid) to authenticated;
grant execute on function public.get_teacher_earnings() to authenticated;
