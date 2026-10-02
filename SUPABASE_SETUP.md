# Central sync setup

The deployed web app works entirely on one device before this setup: vehicle entry, checkout, billing, history, memberships, settings, and the app shell are stored in IndexedDB and continue offline.

Central sync is deliberately not switched on in this repository because a Supabase project and its secrets were not supplied. The files in `supabase/` are a real deployment package, not a browser-exposed database key. Follow these steps only in a Supabase project owned by the parking stand.

## 1. Create the data store

Create a Supabase project, then install the Supabase CLI and link the project locally. From the repository root:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The migration creates a site, device, membership, transaction, and idempotent-operation data model. Direct browser table access is denied by row-level security; only the Edge Functions can use the service role on the server.

Create the one parking site in the Supabase SQL editor and save the returned `id`:

```sql
insert into public.parking_sites (name)
values ('Sri Kaliamman Parking')
returning id;
```

The settings row is created automatically when the first device syncs. You may also insert one yourself if you want central defaults before first sync.

## 2. Deploy the server functions

Set a long, random enrollment code in the project's secrets. This is an administrator-only, one-time device activation control—not a user or customer login.

```bash
supabase secrets set DEVICE_ENROLLMENT_CODE="use-a-long-random-value-at-least-32-characters"
supabase functions deploy enroll-device --no-verify-jwt
supabase functions deploy sync --no-verify-jwt
```

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside deployed Edge Functions. Never put the service-role key, enrollment code, or any device token in GitHub Pages, `sync-config.js`, a committed `.env` file, or client-side source.

## 3. Enroll each trusted device once

On the device browser, open the installed app once. Its local database creates a device ID. Read it from its IndexedDB `meta` store (`deviceId`) using the browser's developer tools, then call the enroll endpoint from a secure administrator machine:

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/enroll-device" \
  -H "content-type: application/json" \
  -H "x-enrollment-code: YOUR_LONG_RANDOM_ENROLLMENT_CODE" \
  -d '{"siteId":"YOUR_SITE_UUID","deviceId":"THE_DEVICE_UUID"}'
```

The response contains a per-device bearer token. It is shown once; treat it like a device key. In the app, open **Settings → Activate this device** and enter:

- Sync endpoint: `https://YOUR_PROJECT_REF.supabase.co/functions/v1`
- Parking stand ID: the UUID returned in step 1
- Device token: the token returned by the enrollment endpoint

The token stays only in that browser's IndexedDB. It is neither in the public website nor in the repository.

## What sync guarantees

- Every local mutation is queued with a UUID operation ID before the UI reports success.
- The server reserves each operation ID exactly once, making retries idempotent.
- The database prevents duplicate active entries for the same vehicle at one stand and prevents serial-number collisions.
- Sync returns the current active-parking snapshot plus centralized settings, memberships, and transaction history, so a newly enrolled device adopts the same parking data.
- Local operations remain usable during an outage. A failed sync leaves the queue untouched and tells the operator that data is saved locally.

For a stand with very large historical data, evolve the snapshot endpoint to use a cursor or `updated_at` watermark before allowing more than the current 5,000-record operational response. The client intentionally merges history rather than clearing it so a bounded response cannot erase local records.
