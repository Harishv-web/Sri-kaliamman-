import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateParkingCharge,
  formatVehicleNumber,
  formatDuration,
  normalizeVehicleNumber,
  validateVehicleNumber,
} from '../app/js/store.js';

test('vehicle registrations are normalised into a clear uppercase form', () => {
  assert.equal(normalizeVehicleNumber(' tn-38  ab   1234 '), 'TN 38 AB 1234');
  assert.equal(validateVehicleNumber('tn 38 ab 1234'), 'TN 38 AB 1234');
});

test('vehicle registration input receives standard readable spacing while typing', () => {
  assert.equal(formatVehicleNumber('tn'), 'TN');
  assert.equal(formatVehicleNumber('tn', { trailingSeparator: true }), 'TN ');
  assert.equal(formatVehicleNumber('tn38', { trailingSeparator: true }), 'TN 38 ');
  assert.equal(formatVehicleNumber('tn38ab', { trailingSeparator: true }), 'TN 38 AB ');
  assert.equal(formatVehicleNumber('tn38ab1234'), 'TN 38 AB 1234');
  assert.equal(formatVehicleNumber('tn-38 ab 1234'), 'TN 38 AB 1234');
});

test('invalid vehicle registration is rejected before an entry is created', () => {
  assert.throws(() => validateVehicleNumber('abc'), /valid vehicle registration/i);
  assert.throws(() => validateVehicleNumber(''), /required/i);
});

test('parking billing charges one 24-hour block immediately and rounds later stays up', () => {
  const record = { entryAt: '2026-10-02T06:00:00.000Z', ratePerPeriod: 15, billingPeriodHours: 24 };
  assert.equal(calculateParkingCharge(record, '2026-10-02T06:01:00.000Z').parkingCharge, 15);
  assert.equal(calculateParkingCharge(record, '2026-10-03T06:00:00.000Z').parkingCharge, 15);
  assert.equal(calculateParkingCharge(record, '2026-10-03T06:00:01.000Z').parkingCharge, 30);
});

test('membership discount and duration formatting remain predictable', () => {
  const record = { entryAt: '2026-10-02T06:00:00.000Z', ratePerPeriod: 70, billingPeriodHours: 24, membershipDiscountPercent: 25 };
  const result = calculateParkingCharge(record, '2026-10-03T07:00:00.000Z');
  assert.equal(result.baseCharge, 140);
  assert.equal(result.membershipDiscount, 35);
  assert.equal(result.parkingCharge, 105);
  assert.equal(formatDuration(90 * 60 * 1000), '1h 30m');
});
