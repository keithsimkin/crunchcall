-- One 7-day free trial per hashed device id.
-- The Windows app sends SHA-256(salt || MachineGuid), not the raw id.
-- Uninstall wipes local cache; the same PC still hits this row and does not get a new trial.

create table if not exists public.device_trials (
  device_id text primary key,
  started_at bigint not null,
  created_at timestamptz not null default now(),
  constraint device_trials_device_id_check check (device_id ~ '^[a-f0-9]{64}$'),
  constraint device_trials_started_at_check check (started_at >= 1704067200)
);

alter table public.device_trials enable row level security;

revoke all on table public.device_trials from public, anon, authenticated;
grant select, insert, update, delete on table public.device_trials to service_role;

drop policy if exists "device trials are server only" on public.device_trials;
create policy "device trials are server only"
  on public.device_trials
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.claim_device_trial(p_device_id text, p_started_at bigint)
returns table (device_id text, started_at bigint, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_start bigint;
  existing_start bigint;
begin
  if p_device_id is null or p_device_id !~ '^[a-f0-9]{64}$' then
    raise exception 'device';
  end if;
  if p_started_at is null or p_started_at < 1704067200 then
    raise exception 'started';
  end if;

  insert into public.device_trials as t (device_id, started_at)
  values (p_device_id, p_started_at)
  on conflict (device_id) do nothing
  returning t.started_at into inserted_start;

  if inserted_start is not null then
    return query select p_device_id, inserted_start, true;
    return;
  end if;

  select t.started_at into existing_start
  from public.device_trials as t
  where t.device_id = p_device_id;

  return query select p_device_id, existing_start, false;
end;
$$;

revoke all on function public.claim_device_trial(text, bigint) from public, anon, authenticated;
grant execute on function public.claim_device_trial(text, bigint) to service_role;
