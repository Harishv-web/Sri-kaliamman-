import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateParkingCharge,
  formatCustomerPhone,
  formatVehicleNumber,
  formatDuration,
  normalizeCustomerPhone,
  normalizeVehicleNumber,
  validateVehicleNumber,
} from '../app/js/store.js';
import { buildReceiptMessage, buildSmsReceiptUrl, buildWhatsAppReceiptUrl } from '../app/js/receipt.js';

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

test('customer mobile numbers are normalized only when they are valid Indian numbers', () => {
  assert.equal(normalizeCustomerPhone('98765 43210'), '919876543210');
  assert.equal(normalizeCustomerPhone('+91 98765 43210'), '919876543210');
  assert.equal(formatCustomerPhone('919876543210'), '+91 98765 43210');
  assert.equal(normalizeCustomerPhone(''), '');
  assert.throws(() => normalizeCustomerPhone('12345'), /valid 10-digit/i);
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

test('flexible pricing applies grace, hourly increments, caps, extras, and membership discount transparently', () => {
  const record = {
    entryAt: '2026-10-02T06:00:00.000Z',
    pricingMode: 'flexible',
    graceMinutes: 10,
    initialFee: 5,
    hourlyRate: 10,
    additionalHourRate: 8,
    dailyRate: 80,
    maximumDailyCharge: 30,
    additionalFee: 4,
    membershipDiscountPercent: 10,
  };
  const result = calculateParkingCharge(record, '2026-10-02T08:11:00.000Z');
  // 121 chargeable minutes: initial ₹5 + first hour ₹10 + 2 extra hours ₹16,
  // capped at ₹30, plus ₹4 additional fee, then 10% membership benefit.
  assert.equal(result.baseCharge, 34);
  assert.equal(result.membershipDiscount, 3);
  assert.equal(result.parkingCharge, 31);
  assert.ok(result.priceBreakdown.some((line) => /Maximum daily charge/.test(line.label)));
  assert.ok(result.priceBreakdown.some((line) => line.label === 'Additional fee'));
});

test('flexible parking within grace period does not add a charge or optional fee', () => {
  const result = calculateParkingCharge({
    entryAt: '2026-10-02T06:00:00.000Z', pricingMode: 'flexible', graceMinutes: 15,
    initialFee: 10, hourlyRate: 10, dailyRate: 100, additionalFee: 5,
  }, '2026-10-02T06:15:00.000Z');
  assert.equal(result.parkingCharge, 0);
  assert.match(result.priceBreakdown[0].label, /grace period/i);
});

test('digital receipts carry a unique ticket number, parking timings, payment, and sharing URLs', () => {
  const transaction = {
    serial: '583YU',
    vehicleNumber: 'TN 38 AB 1234',
    vehicleType: 'two-wheeler',
    entryAt: '2026-10-04T06:45:00.000Z',
    checkoutAt: '2026-10-04T08:15:00.000Z',
    durationMs: 90 * 60 * 1000,
    parkingCharge: 15,
    amountPaid: 10,
    dueAmount: 5,
    changeAmount: 0,
  };
  const message = buildReceiptMessage({ transaction, standName: 'Sri Kaliamman Parking' });
  assert.match(message, /Receipt no\.: 583YU/);
  assert.match(message, /TN 38 AB 1234/);
  assert.match(message, /Parking duration: 1h 30m/);
  assert.match(message, /Balance due: ₹5/);
  assert.match(message, /Sri Kaliamman Parking/);
  const whatsappUrl = buildWhatsAppReceiptUrl('919876543210', message);
  assert.match(whatsappUrl, /^https:\/\/wa\.me\/919876543210\?text=/);
  assert.ok(whatsappUrl.includes('%E2%82%B9'), 'WhatsApp receipt text must encode the rupee symbol.');
  assert.equal(new URL(whatsappUrl).searchParams.get('text'), message);
  const smsUrl = buildSmsReceiptUrl('919876543210', message);
  assert.match(smsUrl, /^sms:919876543210\?body=/);
  assert.ok(smsUrl.includes('%E2%82%B9'), 'SMS receipt text must encode the rupee symbol.');
  assert.match(buildSmsReceiptUrl('919876543210', message, 'iPhone'), /^sms:919876543210&body=/);
});
