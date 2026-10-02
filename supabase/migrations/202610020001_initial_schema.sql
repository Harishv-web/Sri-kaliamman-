-- Sri Kaliamman Parking: central, shared data store.
-- All browser access is intentionally denied. The accompanying Edge Functions
-- use the Supabase service role only after verifying a per-device bearer token.

create extension if not exists pgcrypto;

create table if not exists public.parking_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.parking_settings (
  site_id uuid primary key references public.parking_sites(id) on delete cascade,
  stand_name text not null default 'Sri Kaliamman Parking',
  two_wheeler_rate integer not null default 15 check (two_wheeler_rate >= 0),
  four_wheeler_rate integer not null default 70 check (four_wheeler_rate >= 0),
  two_wheeler_capacity integer not null default 100 check (two_wheeler_capacity >= 0),
  four_wheeler_capacity integer not null default 20 check (four_wheeler_capacity >= 0),
  billing_period_hours integer not null default 24 check (billing_period_hours > 0),
  billing_rule text not null default 'ceil-period' check (billing_rule = 'ceil-period'),
  monthly_membership_amount integer not null default 0 check (monthly_membership_amount >= 0),
  membership_discount_percent integer not null default 0 check (membership_discount_percent between 0 and 100),
  updated_at timestamptz not null default now()
);

create table if not exists public.parking_devices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.parking_sites(id) on delete cascade,
  device_id uuid not null,
  token_hash text not null,
  active boolean not null default true,
  enrolled_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (site_id, device_id),
  unique (token_hash)
);

create table if not exists public.parking_memberships (
  id uuid primary key,
  site_id uuid not null references public.parking_sites(id) on delete cascade,
  vehicle_number text not null check (vehicle_number = upper(vehicle_number)),
  vehicle_type text not null check (vehicle_type in ('two-wheeler', 'four-wheeler')),
  start_date date not null,
  end_date date not null,
  amount integer not null default 0 check (amount >= 0),
  active boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (end_date >= start_date)
);

create index if not exists parking_memberships_site_vehicle_idx on public.parking_memberships (site_id, vehicle_number, vehicle_type);
create index if not exists parking_memberships_site_end_idx on public.parking_memberships (site_id, end_date);

create table if not exists public.parking_transactions (
  id uuid primary key,
  site_id uuid not null references public.parking_sites(id) on delete cascade,
  serial text not null check (serial ~ '^[0-9]{3}[A-Z]{2}$'),
  vehicle_number text not null check (vehicle_number = upper(vehicle_number)),
  vehicle_type text not null check (vehicle_type in ('two-wheeler', 'four-wheeler')),
  entry_at timestamptz not null,
  checkout_at timestamptz,
  status text not null check (status in ('parked', 'completed')),
  rate_per_period integer not null check (rate_per_period >= 0),
  billing_period_hours integer not null check (billing_period_hours > 0),
  membership_id uuid references public.parking_memberships(id) on delete set null,
  membership_status text not null default 'not-active' check (membership_status in ('active', 'not-active')),
  membership_discount_percent integer not null default 0 check (membership_discount_percent between 0 and 100),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  periods integer check (periods is null or periods >= 1),
  base_charge integer check (base_charge is null or base_charge >= 0),
  membership_discount integer check (membership_discount is null or membership_discount >= 0),
  parking_charge integer check (parking_charge is null or parking_charge >= 0),
  amount_paid integer check (amount_paid is null or amount_paid >= 0),
  due_amount integer check (due_amount is null or due_amount >= 0),
  change_amount integer check (change_amount is null or change_amount >= 0),
  device_id uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check ((status = 'parked' and checkout_at is null) or (status = 'completed' and checkout_at is not null))
);

create unique index if not exists parking_transactions_site_serial_unique on public.parking_transactions (site_id, serial);
create unique index if not exists parking_transactions_one_active_vehicle on public.parking_transactions (site_id, vehicle_number) where status = 'parked';
create index if not exists parking_transactions_active_idx on public.parking_transactions (site_id, entry_at desc) where status = 'parked';
create index if not exists parking_transactions_exit_idx on public.parking_transactions (site_id, checkout_at desc) where status = 'completed';
create index if not exists parking_transactions_vehicle_idx on public.parking_transactions (site_id, vehicle_number);

-- An operation id is durable and unique. Retried offline requests first attempt
-- this insert; the unique key turns duplicate submissions into no-ops.
create table if not exists public.parking_processed_operations (
  operation_id uuid primary key,
  site_id uuid not null references public.parking_sites(id) on delete cascade,
  device_id uuid not null,
  kind text not null,
  processed_at timestamptz not null default now()
);

create index if not exists parking_processed_site_idx on public.parking_processed_operations (site_id, processed_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists parking_sites_updated_at on public.parking_sites;
create trigger parking_sites_updated_at before update on public.parking_sites for each row execute function public.set_updated_at();

-- No client-side table access. Edge Functions run with service role and enforce
-- the device/site scope in code.
alter table public.parking_sites enable row level security;
alter table public.parking_settings enable row level security;
alter table public.parking_devices enable row level security;
alter table public.parking_memberships enable row level security;
alter table public.parking_transactions enable row level security;
alter table public.parking_processed_operations enable row level security;

revoke all on public.parking_sites, public.parking_settings, public.parking_devices, public.parking_memberships, public.parking_transactions, public.parking_processed_operations from anon, authenticated;

-- Create one site from the Supabase SQL editor, then note its UUID in the
-- non-committed per-deployment app config:
-- insert into public.parking_sites (name) values ('Sri Kaliamman Parking') returning id;
