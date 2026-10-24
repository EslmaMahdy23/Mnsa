-- الخطوة 10: طلبات شحن الرصيد تظهر في جدول الفواتير مع مشتريات الكورسات
-- شغّله في Supabase: SQL Editor > New query > Run (بعد 09)
--
-- الفكرة: دالة my_invoices بتجمّع مشتريات الكورسات (invoices) وطلبات الشحن (wallet_topups)
-- في قايمة واحدة مرتّبة بالأحدث وبصفحات، وكل طالب يشوف بتاعه هو بس.

-- ========== 1) رقم تسلسلي لطلبات الشحن (من نفس عدّاد الفواتير، فمفيش رقمين متكرّرين) ==========
alter table public.wallet_topups add column if not exists serial bigint;

update public.wallet_topups set serial = nextval('public.invoice_serial_seq') where serial is null;

alter table public.wallet_topups alter column serial set default nextval('public.invoice_serial_seq');
alter table public.wallet_topups alter column serial set not null;
create unique index if not exists wallet_topups_serial_key on public.wallet_topups (serial);

-- ========== 2) الطالب يبعت طلب الشحن بأربع حقول بس ==========
-- (المبلغ، رقم اللي حوّل منه، السكرين، وصاحب الطلب). الرقم التسلسلي والتاريخ والحالة بتتحط من الداتابيز.
revoke insert on public.wallet_topups from anon, authenticated;
grant insert (user_id, amount, sender_phone, screenshot_path) on public.wallet_topups to authenticated;

-- ========== 3) قايمة الفواتير الموحّدة ==========
-- security invoker: بتشتغل بصلاحيات الطالب نفسه، فسياسات الأمان (RLS) هي اللي بتحمي بياناته.
create or replace function public.my_invoices(
  p_limit int default 10,
  p_offset int default 0
)
returns table (
  id uuid,
  kind text,
  serial bigint,
  invoice_no text,
  title text,
  items_count int,
  amount numeric,
  payment_method text,
  sender_phone text,
  status text,
  note text,
  event_at timestamptz,
  total_count bigint
)
language sql stable set search_path = public as $$
  with docs as (
    select
      i.id,
      'purchase'::text as kind,
      i.serial,
      i.invoice_no,
      coalesce(
        (select string_agg(ii.course_title, '، ' order by ii.course_title)
           from public.invoice_items ii where ii.invoice_id = i.id),
        ''
      ) as title,
      (select count(*)::int from public.invoice_items ii where ii.invoice_id = i.id) as items_count,
      i.total as amount,
      i.payment_method,
      null::text as sender_phone,
      i.status,
      null::text as note,
      i.paid_at as event_at
    from public.invoices i
    where i.user_id = auth.uid()

    union all

    select
      w.id,
      'topup'::text,
      w.serial,
      'TP-' || to_char(timezone('Africa/Cairo', w.created_at), 'YYMM') || '-' || lpad(w.serial::text, 5, '0'),
      'شحن رصيد المحفظة'::text,
      1,
      coalesce(w.approved_amount, w.amount),
      'transfer'::text,
      w.sender_phone,
      w.status,
      w.admin_note,
      w.created_at
    from public.wallet_topups w
    where w.user_id = auth.uid()
  )
  select d.id, d.kind, d.serial, d.invoice_no, d.title, d.items_count, d.amount,
         d.payment_method, d.sender_phone, d.status, d.note, d.event_at,
         count(*) over ()
  from docs d
  order by d.event_at desc, d.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.my_invoices(int, int) from public, anon;
grant execute on function public.my_invoices(int, int) to authenticated;
