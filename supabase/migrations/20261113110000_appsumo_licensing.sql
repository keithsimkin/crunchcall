-- Fresh-project licensing schema for annotated.
-- license_orders holds Dodo purchases and AppSumo redemptions.
-- max_devices null means unlimited (Dodo). AppSumo rows use 1.
-- The redeem worker claims a code with:
--   update appsumo_codes set redeemed_at = now() where code = $1 and redeemed_at is null returning *;
-- Seat changes go through the functions below. They are security invoker
-- (the caller is service_role, which bypasses RLS) with a fixed search_path.
-- anon and authenticated cannot execute them and cannot read codes or activations.

create table if not exists public.license_orders (
  order_id text primary key,
  email text not null,
  license text not null,
  claimed boolean not null default false,
  customer_id text not null default '',
  issued bigint not null,
  max_devices integer,
  created_at timestamptz not null default now(),
  constraint license_orders_order_id_check check (order_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint license_orders_max_devices_check check (max_devices is null or (max_devices >= 1 and max_devices <= 1000))
);

alter table public.license_orders add column if not exists max_devices integer;

create index if not exists license_orders_email_idx on public.license_orders (email);

create table if not exists public.appsumo_codes (
  code text primary key,
  batch text not null default '',
  redeemed_at timestamptz,
  email text,
  license_order_id text references public.license_orders (order_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint appsumo_codes_code_check check (code ~ '^[A-Za-z0-9_-]{3,120}$' and code = upper(code)),
  constraint appsumo_codes_email_check check (
    email is null or (char_length(email) between 3 and 254)
  )
);

create index if not exists appsumo_codes_email_idx on public.appsumo_codes (email);

create table if not exists public.license_activations (
  order_id text not null references public.license_orders (order_id) on delete cascade,
  device_id text not null,
  device_label text not null default '',
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (order_id, device_id),
  constraint license_activations_device_id_check check (device_id ~ '^[a-f0-9]{64}$'),
  constraint license_activations_device_label_check check (char_length(device_label) <= 80)
);

alter table public.license_orders enable row level security;
alter table public.appsumo_codes enable row level security;
alter table public.license_activations enable row level security;

revoke all on table public.license_orders from public, anon, authenticated;
grant select on table public.license_orders to authenticated;
grant select, insert, update, delete on table public.license_orders to service_role;

revoke all on table public.appsumo_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.appsumo_codes to service_role;

revoke all on table public.license_activations from public, anon, authenticated;
grant select, insert, update, delete on table public.license_activations to service_role;

drop policy if exists "read own license orders" on public.license_orders;
create policy "read own license orders"
  on public.license_orders
  for select
  to authenticated
  using (lower(email) = lower((select auth.jwt() ->> 'email')));

drop policy if exists "appsumo codes are server only" on public.appsumo_codes;
create policy "appsumo codes are server only"
  on public.appsumo_codes
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "license activations are server only" on public.license_activations;
create policy "license activations are server only"
  on public.license_activations
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.activate_license_device(
  p_order_id text,
  p_email text,
  p_device_id text,
  p_device_label text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lim integer;
  n integer;
  label text;
begin
  if p_order_id is null or p_order_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object('ok', false, 'reason', 'order');
  end if;
  if p_device_id is null or p_device_id !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'device');
  end if;

  label := left(regexp_replace(coalesce(p_device_label, ''), '[[:cntrl:]]', '', 'g'), 80);

  select max_devices into lim
  from public.license_orders
  where order_id = p_order_id
    and lower(email) = lower(coalesce(p_email, ''))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  if lim is null then
    return jsonb_build_object('ok', true, 'limited', false);
  end if;

  update public.license_activations
    set last_seen_at = now(),
        device_label = case when label = '' then device_label else label end
    where order_id = p_order_id
      and device_id = p_device_id;

  if found then
    return jsonb_build_object('ok', true, 'limited', true, 'maxDevices', lim);
  end if;

  select count(*)::integer into n
  from public.license_activations
  where order_id = p_order_id;

  if n >= lim then
    return jsonb_build_object('ok', false, 'reason', 'limit_reached', 'maxDevices', lim);
  end if;

  insert into public.license_activations (order_id, device_id, device_label)
  values (p_order_id, p_device_id, label);

  return jsonb_build_object('ok', true, 'limited', true, 'maxDevices', lim);
exception
  when unique_violation then
    update public.license_activations
      set last_seen_at = now()
      where order_id = p_order_id
        and device_id = p_device_id;
    return jsonb_build_object('ok', true, 'limited', true, 'maxDevices', lim);
end;
$$;

create or replace function public.deactivate_license_device(
  p_order_id text,
  p_email text,
  p_device_id text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_order_id is null or p_order_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object('ok', false, 'reason', 'order');
  end if;
  if p_device_id is null or p_device_id !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'device');
  end if;

  perform 1
  from public.license_orders
  where order_id = p_order_id
    and lower(email) = lower(coalesce(p_email, ''))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  delete from public.license_activations
  where order_id = p_order_id
    and device_id = p_device_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.activate_license_device(text, text, text, text) from public, anon, authenticated;
revoke all on function public.deactivate_license_device(text, text, text) from public, anon, authenticated;
grant execute on function public.activate_license_device(text, text, text, text) to service_role;
grant execute on function public.deactivate_license_device(text, text, text) to service_role;

comment on column public.license_orders.max_devices is
  'Null means unlimited devices, which is how Dodo keys behave. AppSumo codes set this to 1.';
comment on table public.appsumo_codes is
  'AppSumo codes. The redeem worker claims a row by updating it where redeemed_at is null.';
comment on table public.license_activations is
  'One row per PC for orders with max_devices set. device_id is a salted SHA-256, not a raw machine id.';
