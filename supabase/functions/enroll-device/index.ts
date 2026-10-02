import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-enrollment-code',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const enrollmentCode = request.headers.get('x-enrollment-code') || '';
  const expectedCode = Deno.env.get('DEVICE_ENROLLMENT_CODE') || '';
  if (!expectedCode || enrollmentCode.length < 16 || enrollmentCode !== expectedCode) return json({ error: 'Device enrollment was not authorized.' }, 401);

  let input: { siteId?: string; deviceId?: string };
  try { input = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  if (!input.siteId || !input.deviceId) return json({ error: 'siteId and deviceId are required.' }, 400);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return json({ error: 'Server configuration is incomplete.' }, 500);
  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const { data: site } = await admin.from('parking_sites').select('id').eq('id', input.siteId).maybeSingle();
  if (!site) return json({ error: 'Parking site was not found.' }, 404);

  const token = randomToken();
  const tokenHash = await sha256(token);
  const { error } = await admin.from('parking_devices').upsert({
    site_id: input.siteId,
    device_id: input.deviceId,
    token_hash: tokenHash,
    active: true,
    enrolled_at: new Date().toISOString(),
  }, { onConflict: 'site_id,device_id' });
  if (error) return json({ error: 'Unable to enroll this device.' }, 500);
  return json({ deviceToken: token });
});
