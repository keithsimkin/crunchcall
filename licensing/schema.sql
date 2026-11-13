-- Purchased unlock keys. Accounts themselves live in Supabase Auth.
-- Fresh projects should run supabase/migrations instead of this file.
-- The license server writes with the service role. Buyers can read their own rows.
-- max_devices null means unlimited (Dodo). AppSumo rows set it to 1.

create table if not exists public.license_orders (
  order_id text primary key,
  email text not null,
  license text not null,
  claimed boolean not null default false,
  customer_id text not null default '',
  issued bigint not null,
  max_devices integer,
  created_at timestamptz not null default now()
);

alter table public.license_orders add column if not exists max_devices integer;

create index if not exists license_orders_email_idx on public.license_orders (email);

alter table public.license_orders enable row level security;

drop policy if exists "read own license orders" on public.license_orders;
create policy "read own license orders"
  on public.license_orders
  for select
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));
