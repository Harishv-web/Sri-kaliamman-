# Sri Kaliamman Parking

A mobile-first, offline-ready Progressive Web App for a two-wheeler and four-wheeler parking stand. The public home page is intentionally minimal: it points visitors directly to the installable parking app.

## What works without a backend

- 🛵 and 🚗 vehicle entry with normalized registration numbers and duplicate-active-entry prevention
- Collision-safe `123AB` parking serials, reserved permanently on the device
- 24-hour billing (₹15 two-wheeler / ₹70 four-wheeler by default), with configurable rates and capacities
- Checkout bill, received amount, change, due amount, and preserved history
- Dashboard, current vehicles, membership passes, reporting, CSV export, and daily vehicle activity views
- IndexedDB persistence, offline use, web manifest, service worker, and Android home-screen installation support

The application has no customer accounts, staff accounts, passwords, or customer PII. Vehicle registration number is the only customer-related field.

## Run locally

This is a dependency-free static PWA. Any static server will work. For example:

```bash
npx serve .
```

Open the URL in a modern browser. The app itself is at `/app/`.

## Quality checks

```bash
npm run check
npm test
```

The tests cover registration normalization and validation plus 24-hour billing behaviour.

## Deploy to GitHub Pages

GitHub Pages can serve this repository directly from the `main` branch root. After pushing changes, open:

`https://harishv-web.github.io/Sri-kaliamman-/`

The page opens an in-app **Install app** screen. On Android Chrome, tap **Install on this device** when the browser is ready, or use Chrome's ⋮ menu and choose **Install app** / **Add to Home screen**. The installed application starts at the parking dashboard and behaves like a launcher app.

This is a Progressive Web App, so there is no misleading APK download link. Publishing a separate Google Play Store listing requires the owner's verified Play Console account and a signed Android release package.

## Central shared sync

One-device offline use needs no setup. Cross-device synchronization requires a shared Supabase project because a public static site must never contain a database service secret. The included migration and Edge Functions provide that design; follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md) when the parking stand's Supabase project is available.

Until then, the app labels its state clearly as **Local data** and safely queues every local change rather than pretending that multi-device sync has been deployed.

## Project layout

```text
index.html / site.css / site.js       public install landing page
app/                                  installed parking application
app/js/store.js                       IndexedDB domain, billing, queue, optional sync client
supabase/                             secure central-sync migration and Edge Functions
tests/                                deterministic domain tests
```
