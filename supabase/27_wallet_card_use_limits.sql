-- Upgrade recharge cards created with supabase/26_wallet_recharge_cards.sql
-- to support a configured number of uses per code.
alter table public.wallet_recharge_cards
  add column if not exists max_uses integer not null default 1,
  add column if not exists used_count integer not null default 0;

update public.wallet_recharge_cards
   set used_count = 1
 where redeemed_at is not null and used_count = 0;

create table if not exists public.wallet_card_redemptions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.wallet_recharge_cards(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  redeemed_at timestamptz not null default now(),
  unique (card_id, user_id)
);

alter table public.wallet_card_redemptions enable row level security;
revoke all on public.wallet_card_redemptions from anon, authenticated;

-- Preserve the one redemption already recorded by the original one-use design.
insert into public.wallet_card_redemptions (card_id, user_id, amount, redeemed_at)
select id, redeemed_by, amount, redeemed_at
  from public.wallet_recharge_cards
 where redeemed_at is not null and redeemed_by is not null
on conflict (card_id, user_id) do nothing;

drop function if exists public.admin_generate_wallet_cards(numeric, integer);

create or replace function public.admin_generate_wallet_cards(
  p_amount numeric,
  p_count integer,
  p_max_uses integer default 1
)
returns table(generated_code text, card_amount numeric, max_uses integer)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_bytes bytea;
  v_number bigint;
  v_code text;
  v_index integer;
  v_card_index integer;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 20000 or p_amount <> round(p_amount, 2) then
    raise exception 'bad amount' using errcode = '22023';
  end if;
  if p_count is null or p_count < 1 or p_count > 500 then
    raise exception 'bad count' using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 500 then
    raise exception 'bad max uses' using errcode = '22023';
  end if;

  for v_card_index in 1..p_count loop
    loop
      v_bytes := gen_random_bytes(7);
      v_number := 0;
      for v_index in 0..6 loop
        v_number := v_number * 256 + get_byte(v_bytes, v_index);
      end loop;
      v_code := lpad((v_number % 100000000000)::text, 11, '0');

      insert into public.wallet_recharge_cards (code_hash, amount, max_uses, created_by)
      values (digest(v_code, 'sha256'), p_amount, p_max_uses, auth.uid())
      on conflict (code_hash) do nothing;

      if found then
        generated_code := v_code;
        card_amount := p_amount;
        max_uses := p_max_uses;
        return next;
        exit;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.redeem_wallet_card(p_code text)
returns table(credited_amount numeric, new_balance numeric, redemption_error text)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_code text := trim(coalesce(p_code, ''));
  v_card public.wallet_recharge_cards%rowtype;
  v_balance numeric(10,2);
  v_attempt_count integer;
  v_now timestamptz := now();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.wallet_card_redemption_limits as current_limit (user_id, window_started_at, attempts)
  values (v_user, v_now, 1)
  on conflict (user_id) do update
    set window_started_at = case
          when current_limit.window_started_at < v_now - interval '15 minutes' then v_now
          else current_limit.window_started_at
        end,
        attempts = case
          when current_limit.window_started_at < v_now - interval '15 minutes' then 1
          else current_limit.attempts + 1
        end
  returning attempts into v_attempt_count;

  if v_attempt_count > 10 then
    credited_amount := null;
    new_balance := null;
    redemption_error := 'too_many_attempts';
    return next;
    return;
  end if;
  if v_code !~ '^[0-9]{11}$' then
    credited_amount := null;
    new_balance := null;
    redemption_error := 'invalid_code';
    return next;
    return;
  end if;

  select * into v_card
    from public.wallet_recharge_cards
   where code_hash = digest(v_code, 'sha256')
   for update;
  if not found then
    credited_amount := null;
    new_balance := null;
    redemption_error := 'invalid_code';
    return next;
    return;
  end if;
  if exists (select 1 from public.wallet_card_redemptions r where r.card_id = v_card.id and r.user_id = v_user) then
    credited_amount := null;
    new_balance := null;
    redemption_error := 'already_redeemed';
    return next;
    return;
  end if;
  if v_card.used_count >= v_card.max_uses then
    credited_amount := null;
    new_balance := null;
    redemption_error := 'exhausted';
    return next;
    return;
  end if;

  insert into public.wallet_card_redemptions (card_id, user_id, amount, redeemed_at)
  values (v_card.id, v_user, v_card.amount, v_now);

  update public.wallet_recharge_cards
     set used_count = used_count + 1, redeemed_by = v_user, redeemed_at = v_now
   where id = v_card.id;

  update public.profiles set balance = balance + v_card.amount
   where id = v_user returning balance into v_balance;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  insert into public.wallet_transactions (user_id, amount, kind, note, created_by)
  values (v_user, v_card.amount, 'topup', 'شحن كارت رصيد', v_user);

  credited_amount := v_card.amount;
  new_balance := v_balance;
  redemption_error := null;
  return next;
end;
$$;

revoke all on function public.admin_generate_wallet_cards(numeric, integer, integer) from public, anon;
revoke all on function public.redeem_wallet_card(text) from public, anon;
grant execute on function public.admin_generate_wallet_cards(numeric, integer, integer) to authenticated;
grant execute on function public.redeem_wallet_card(text) to authenticated;
