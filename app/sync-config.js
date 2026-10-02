/*
 * Central sync is optional during local/offline use.  Do not place service
 * role credentials here.  See SUPABASE_SETUP.md before setting these public
 * routing values after the accompanying Edge Functions are deployed.
 */
globalThis.PARKING_SYNC_CONFIG = globalThis.PARKING_SYNC_CONFIG || {
  endpoint: '',
  siteId: '',
};
