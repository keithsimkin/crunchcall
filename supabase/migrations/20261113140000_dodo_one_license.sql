-- Dodo purchases are one Windows PC and one license key per email.
-- AppSumo codes stay separate rows, also with max_devices = 1.
-- Older rows may still have max_devices null (unlimited). New Dodo rows set 1.
-- Authenticated users can read their own orders and the seats on those orders.
-- Inserts and deletes stay with the service role.

alter table public.license_orders
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists license_orders_user_idx on public.license_orders (user_id);

comment on column public.license_orders.max_devices is
  '1 for a Dodo purchase and for each AppSumo code: one Windows PC. Null means an older unlimited key.';

comment on column public.license_orders.user_id is
  'Supabase Auth user that checked out, when the webhook metadata includes one.';

grant select on table public.license_activations to authenticated;

drop policy if exists "read own activations" on public.license_activations;
create policy "read own activations"
  on public.license_activations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.license_orders
      where license_orders.order_id = license_activations.order_id
        and lower(license_orders.email) = lower((select auth.jwt() ->> 'email'))
    )
  );

drop policy if exists "read own license orders" on public.license_orders;
create policy "read own license orders"
  on public.license_orders
  for select
  to authenticated
  using (
    lower(email) = lower((select auth.jwt() ->> 'email'))
    or user_id = (select auth.uid())
  );
