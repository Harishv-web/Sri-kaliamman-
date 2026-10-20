-- Shared-cloud parity for the parking application.
-- This migration keeps the original 24-hour settings compatible while making
-- flexible pricing, payment policy, and completed-ticket details durable in
-- the one central database used by every enrolled device.

alter table public.parking_settings
  add column if not exists two_wheeler_pricing_mode text not null default 'legacy-period'
    check (two_wheeler_pricing_mode in ('legacy-period', 'flexible')),
  add column if not exists four_wheeler_pricing_mode text not null default 'legacy-period'
    check (four_wheeler_pricing_mode in ('legacy-period', 'flexible')),
  add column if not exists two_wheeler_initial_fee integer not null default 0 check (two_wheeler_initial_fee >= 0),
  add column if not exists four_wheeler_initial_fee integer not null default 0 check (four_wheeler_initial_fee >= 0),
  add column if not exists two_wheeler_hourly_rate integer not null default 0 check (two_wheeler_hourly_rate >= 0),
  add column if not exists four_wheeler_hourly_rate integer not null default 0 check (four_wheeler_hourly_rate >= 0),
  add column if not exists two_wheeler_additional_hour_rate integer not null default 0 check (two_wheeler_additional_hour_rate >= 0),
  add column if not exists four_wheeler_additional_hour_rate integer not null default 0 check (four_wheeler_additional_hour_rate >= 0),
  add column if not exists two_wheeler_daily_rate integer not null default 15 check (two_wheeler_daily_rate >= 0),
  add column if not exists four_wheeler_daily_rate integer not null default 70 check (four_wheeler_daily_rate >= 0),
  add column if not exists two_wheeler_grace_minutes integer not null default 0 check (two_wheeler_grace_minutes >= 0),
  add column if not exists four_wheeler_grace_minutes integer not null default 0 check (four_wheeler_grace_minutes >= 0),
  add column if not exists two_wheeler_maximum_daily_charge integer not null default 0 check (two_wheeler_maximum_daily_charge >= 0),
  add column if not exists four_wheeler_maximum_daily_charge integer not null default 0 check (four_wheeler_maximum_daily_charge >= 0),
  add column if not exists two_wheeler_additional_fee integer not null default 0 check (two_wheeler_additional_fee >= 0),
  add column if not exists four_wheeler_additional_fee integer not null default 0 check (four_wheeler_additional_fee >= 0),
  add column if not exists allow_exit_with_due boolean not null default true;

alter table public.parking_transactions
  add column if not exists pricing_mode text not null default 'legacy-period'
    check (pricing_mode in ('legacy-period', 'flexible')),
  add column if not exists initial_fee integer not null default 0 check (initial_fee >= 0),
  add column if not exists hourly_rate integer not null default 0 check (hourly_rate >= 0),
  add column if not exists additional_hour_rate integer not null default 0 check (additional_hour_rate >= 0),
  add column if not exists daily_rate integer not null default 0 check (daily_rate >= 0),
  add column if not exists grace_minutes integer not null default 0 check (grace_minutes >= 0),
  add column if not exists maximum_daily_charge integer not null default 0 check (maximum_daily_charge >= 0),
  add column if not exists additional_fee integer not null default 0 check (additional_fee >= 0),
  add column if not exists price_breakdown jsonb,
  add column if not exists exit_status text,
  add column if not exists payment_status text;

-- Existing tickets retain their previous rate and calculation. These values
-- supply a complete snapshot only for new flexible-rate tickets.
update public.parking_transactions
set daily_rate = rate_per_period
where daily_rate = 0 and rate_per_period > 0;

-- Device queues can arrive out of order after an outage. The central database
-- must never let an older entry overwrite a completed checkout or let a stale
-- settings/pass update replace a newer shared record.
create or replace function public.keep_newest_parking_record()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'parking_transactions'
    and old.status = 'completed'
    and new.status = 'parked' then
    return null;
  end if;

  if new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists parking_transactions_keep_newest on public.parking_transactions;
create trigger parking_transactions_keep_newest
before update on public.parking_transactions
for each row execute function public.keep_newest_parking_record();

drop trigger if exists parking_memberships_keep_newest on public.parking_memberships;
create trigger parking_memberships_keep_newest
before update on public.parking_memberships
for each row execute function public.keep_newest_parking_record();

drop trigger if exists parking_settings_keep_newest on public.parking_settings;
create trigger parking_settings_keep_newest
before update on public.parking_settings
for each row execute function public.keep_newest_parking_record();

