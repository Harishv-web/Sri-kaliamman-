import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function sha256(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bearer(request: Request) {
  const value = request.headers.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function transactionPayload(payload: Record<string, unknown>, siteId: string) {
  return {
    id: payload.id,
    site_id: siteId,
    serial: payload.serial,
    vehicle_number: payload.vehicleNumber,
    customer_phone: payload.customerPhone || null,
    vehicle_type: payload.vehicleType,
    entry_at: payload.entryAt,
    checkout_at: payload.checkoutAt || null,
    status: payload.status,
    rate_per_period: payload.ratePerPeriod,
    billing_period_hours: payload.billingPeriodHours,
    pricing_mode: payload.pricingMode || 'legacy-period',
    initial_fee: payload.initialFee || 0,
    hourly_rate: payload.hourlyRate || 0,
    additional_hour_rate: payload.additionalHourRate || 0,
    daily_rate: payload.dailyRate || payload.ratePerPeriod || 0,
    grace_minutes: payload.graceMinutes || 0,
    maximum_daily_charge: payload.maximumDailyCharge || 0,
    additional_fee: payload.additionalFee || 0,
    price_breakdown: Array.isArray(payload.priceBreakdown) ? payload.priceBreakdown : null,
    exit_status: payload.exitStatus || null,
    payment_status: payload.paymentStatus || null,
    membership_id: payload.membershipId || null,
    membership_status: payload.membershipStatus || 'not-active',
    membership_discount_percent: payload.membershipDiscountPercent || 0,
    duration_ms: payload.durationMs ?? null,
    periods: payload.periods ?? null,
    base_charge: payload.baseCharge ?? null,
    membership_discount: payload.membershipDiscount ?? null,
    parking_charge: payload.parkingCharge ?? null,
    amount_paid: payload.amountPaid ?? null,
    due_amount: payload.dueAmount ?? null,
    change_amount: payload.changeAmount ?? null,
    device_id: payload.deviceId || null,
    created_at: payload.createdAt || payload.entryAt,
    updated_at: payload.updatedAt || new Date().toISOString(),
  };
}

function membershipPayload(payload: Record<string, unknown>, siteId: string) {
  return {
    id: payload.id,
    site_id: siteId,
    vehicle_number: payload.vehicleNumber,
    vehicle_type: payload.vehicleType,
    start_date: payload.startDate,
    end_date: payload.endDate,
    amount: payload.amount || 0,
    active: Boolean(payload.active),
    created_at: payload.createdAt,
    updated_at: payload.updatedAt || new Date().toISOString(),
  };
}

function clientTransaction(row: Record<string, unknown>) {
  return {
    id: row.id, serial: row.serial, vehicleNumber: row.vehicle_number, customerPhone: row.customer_phone || null, vehicleType: row.vehicle_type,
    entryAt: row.entry_at, checkoutAt: row.checkout_at, status: row.status, ratePerPeriod: row.rate_per_period,
    billingPeriodHours: row.billing_period_hours, pricingMode: row.pricing_mode,
    initialFee: row.initial_fee, hourlyRate: row.hourly_rate, additionalHourRate: row.additional_hour_rate,
    dailyRate: row.daily_rate, graceMinutes: row.grace_minutes, maximumDailyCharge: row.maximum_daily_charge,
    additionalFee: row.additional_fee, priceBreakdown: row.price_breakdown || [], exitStatus: row.exit_status,
    paymentStatus: row.payment_status, membershipId: row.membership_id,
    membershipStatus: row.membership_status, membershipDiscountPercent: row.membership_discount_percent,
    durationMs: row.duration_ms, periods: row.periods, baseCharge: row.base_charge,
    membershipDiscount: row.membership_discount, parkingCharge: row.parking_charge, amountPaid: row.amount_paid,
    dueAmount: row.due_amount, changeAmount: row.change_amount, deviceId: row.device_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function clientMembership(row: Record<string, unknown>) {
  return {
    id: row.id, vehicleNumber: row.vehicle_number, vehicleType: row.vehicle_type,
    startDate: row.start_date, endDate: row.end_date, amount: row.amount, active: row.active,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const deviceToken = bearer(request);
  if (!deviceToken) return json({ error: 'Device token required.' }, 401);
  let input: { siteId?: string; deviceId?: string; operations?: Array<{ id: string; operationId: string; kind: string; payload: Record<string, unknown> }> };
  try { input = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  if (!input.siteId || !input.deviceId || !Array.isArray(input.operations)) return json({ error: 'siteId, deviceId, and operations are required.' }, 400);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return json({ error: 'Server configuration is incomplete.' }, 500);
  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const tokenHash = await sha256(deviceToken);
  const { data: device } = await admin.from('parking_devices')
    .select('id, site_id, active').eq('site_id', input.siteId).eq('device_id', input.deviceId).eq('token_hash', tokenHash).maybeSingle();
  if (!device?.active) return json({ error: 'This device is not enrolled for the requested parking site.' }, 403);
  await admin.from('parking_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', device.id);

  const acknowledgedOperationIds: string[] = [];
  const rejectedOperationIds: string[] = [];
  const conflicts: Array<{ operationId: string; message: string }> = [];
  for (const operation of input.operations) {
    if (!operation?.operationId || !operation?.kind || !operation.payload) continue;
    const { error: claimedError } = await admin.from('parking_processed_operations').insert({
      operation_id: operation.operationId, site_id: input.siteId, device_id: input.deviceId, kind: operation.kind,
    });
    if (claimedError?.code === '23505') { acknowledgedOperationIds.push(operation.operationId); continue; }
    if (claimedError) return json({ error: 'Unable to reserve a sync operation.' }, 500);

    let error = null;
    if (operation.kind === 'parking.entry' || operation.kind === 'parking.checkout') {
      ({ error } = await admin.from('parking_transactions').upsert(transactionPayload(operation.payload, input.siteId), { onConflict: 'id' }));
    } else if (operation.kind === 'membership.upsert') {
      ({ error } = await admin.from('parking_memberships').upsert(membershipPayload(operation.payload, input.siteId), { onConflict: 'id' }));
    } else if (operation.kind === 'settings.upsert') {
      const p = operation.payload;
      ({ error } = await admin.from('parking_settings').upsert({
        site_id: input.siteId, stand_name: p.standName, two_wheeler_rate: p.twoWheelerRate,
        four_wheeler_rate: p.fourWheelerRate, two_wheeler_capacity: p.twoWheelerCapacity,
        four_wheeler_capacity: p.fourWheelerCapacity, billing_period_hours: p.billingPeriodHours,
        billing_rule: p.billingRule || 'ceil-period', monthly_membership_amount: p.monthlyMembershipAmount || 0,
        membership_discount_percent: p.membershipDiscountPercent || 0,
        two_wheeler_pricing_mode: p.twoWheelerPricingMode || 'legacy-period', four_wheeler_pricing_mode: p.fourWheelerPricingMode || 'legacy-period',
        two_wheeler_initial_fee: p.twoWheelerInitialFee || 0, four_wheeler_initial_fee: p.fourWheelerInitialFee || 0,
        two_wheeler_hourly_rate: p.twoWheelerHourlyRate || 0, four_wheeler_hourly_rate: p.fourWheelerHourlyRate || 0,
        two_wheeler_additional_hour_rate: p.twoWheelerAdditionalHourRate || 0, four_wheeler_additional_hour_rate: p.fourWheelerAdditionalHourRate || 0,
        two_wheeler_daily_rate: p.twoWheelerDailyRate ?? p.twoWheelerRate, four_wheeler_daily_rate: p.fourWheelerDailyRate ?? p.fourWheelerRate,
        two_wheeler_grace_minutes: p.twoWheelerGraceMinutes || 0, four_wheeler_grace_minutes: p.fourWheelerGraceMinutes || 0,
        two_wheeler_maximum_daily_charge: p.twoWheelerMaximumDailyCharge || 0, four_wheeler_maximum_daily_charge: p.fourWheelerMaximumDailyCharge || 0,
        two_wheeler_additional_fee: p.twoWheelerAdditionalFee || 0, four_wheeler_additional_fee: p.fourWheelerAdditionalFee || 0,
        allow_exit_with_due: p.allowExitWithDue !== false, updated_at: p.updatedAt || new Date().toISOString(),
      }, { onConflict: 'site_id' }));
    } else {
      await admin.from('parking_processed_operations').delete().eq('operation_id', operation.operationId);
      return json({ error: 'Unsupported sync operation.' }, 400);
    }
    if (error) {
      if (error.code === '23505') {
        // The central database already owns this ticket or active vehicle.
        // Resolve the client from the authoritative snapshot instead of
        // retrying a permanent collision forever.
        await admin.from('parking_processed_operations').delete().eq('operation_id', operation.operationId);
        rejectedOperationIds.push(operation.operationId);
        conflicts.push({ operationId: operation.operationId, message: 'A matching active vehicle or ticket already exists in the shared parking database.' });
        continue;
      }
      // Do not acknowledge a failed operation. Removing the reservation lets
      // the durable client queue retry safely after the underlying issue is fixed.
      await admin.from('parking_processed_operations').delete().eq('operation_id', operation.operationId);
      return json({ error: 'Unable to save an operation to the central database.' }, 409);
    }
    acknowledgedOperationIds.push(operation.operationId);
  }

  // The parking stand is small enough that a full bounded snapshot is a safe,
  // deterministic way to reconcile new devices and offline periods. Pagination
  // can be introduced later if historical data exceeds the operational limit.
  const [transactionsResult, membershipsResult, settingsResult] = await Promise.all([
    admin.from('parking_transactions').select('*').eq('site_id', input.siteId).order('entry_at', { ascending: false }).limit(5000),
    admin.from('parking_memberships').select('*').eq('site_id', input.siteId).order('end_date', { ascending: true }).limit(5000),
    admin.from('parking_settings').select('*').eq('site_id', input.siteId).maybeSingle(),
  ]);
  if (transactionsResult.error || membershipsResult.error || settingsResult.error) return json({ error: 'Unable to read the synchronized parking snapshot.' }, 500);
  const rows = transactionsResult.data || [];
  const settings = settingsResult.data ? {
    id: 'parking-settings', standName: settingsResult.data.stand_name, twoWheelerRate: settingsResult.data.two_wheeler_rate,
    fourWheelerRate: settingsResult.data.four_wheeler_rate, twoWheelerCapacity: settingsResult.data.two_wheeler_capacity,
    fourWheelerCapacity: settingsResult.data.four_wheeler_capacity, billingPeriodHours: settingsResult.data.billing_period_hours,
    billingRule: settingsResult.data.billing_rule, monthlyMembershipAmount: settingsResult.data.monthly_membership_amount,
    membershipDiscountPercent: settingsResult.data.membership_discount_percent,
    twoWheelerPricingMode: settingsResult.data.two_wheeler_pricing_mode, fourWheelerPricingMode: settingsResult.data.four_wheeler_pricing_mode,
    twoWheelerInitialFee: settingsResult.data.two_wheeler_initial_fee, fourWheelerInitialFee: settingsResult.data.four_wheeler_initial_fee,
    twoWheelerHourlyRate: settingsResult.data.two_wheeler_hourly_rate, fourWheelerHourlyRate: settingsResult.data.four_wheeler_hourly_rate,
    twoWheelerAdditionalHourRate: settingsResult.data.two_wheeler_additional_hour_rate, fourWheelerAdditionalHourRate: settingsResult.data.four_wheeler_additional_hour_rate,
    twoWheelerDailyRate: settingsResult.data.two_wheeler_daily_rate, fourWheelerDailyRate: settingsResult.data.four_wheeler_daily_rate,
    twoWheelerGraceMinutes: settingsResult.data.two_wheeler_grace_minutes, fourWheelerGraceMinutes: settingsResult.data.four_wheeler_grace_minutes,
    twoWheelerMaximumDailyCharge: settingsResult.data.two_wheeler_maximum_daily_charge, fourWheelerMaximumDailyCharge: settingsResult.data.four_wheeler_maximum_daily_charge,
    twoWheelerAdditionalFee: settingsResult.data.two_wheeler_additional_fee, fourWheelerAdditionalFee: settingsResult.data.four_wheeler_additional_fee,
    allowExitWithDue: settingsResult.data.allow_exit_with_due, updatedAt: settingsResult.data.updated_at,
  } : null;
  return json({
    acknowledgedOperationIds,
    rejectedOperationIds,
    conflicts,
    changes: {
      snapshot: true,
      active: rows.filter((row) => row.status === 'parked').map(clientTransaction),
      transactions: rows.filter((row) => row.status === 'completed').map(clientTransaction),
      memberships: (membershipsResult.data || []).map(clientMembership),
      settings,
    },
  });
});
