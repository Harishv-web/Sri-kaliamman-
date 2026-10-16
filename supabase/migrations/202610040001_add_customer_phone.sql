-- Optional receipt recipient. The value is normalized to an Indian country-code
-- number (91 followed by a 10-digit mobile number) before it reaches this table.
alter table public.parking_transactions
  add column if not exists customer_phone text;

alter table public.parking_transactions
  drop constraint if exists parking_transactions_customer_phone_format;

alter table public.parking_transactions
  add constraint parking_transactions_customer_phone_format
  check (customer_phone is null or customer_phone ~ '^91[6-9][0-9]{9}$');
