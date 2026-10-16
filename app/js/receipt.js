import { formatDuration, getVehicleMeta } from './store.js?v=8';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

function formatMoney(value) {
  return currency.format(Number(value || 0));
}

function formatDateTime(value) {
  return dateTimeFormat.format(new Date(value));
}

export function receiptPaymentStatus(transaction) {
  return Number(transaction?.dueAmount || 0) > 0 ? 'BALANCE DUE' : 'PAID';
}

export function buildReceiptMessage({ transaction, standName }) {
  if (!transaction?.serial || !transaction?.vehicleNumber || !transaction?.entryAt || !transaction?.checkoutAt) {
    throw new Error('The completed parking details are not available for this receipt.');
  }
  const vehicle = getVehicleMeta(transaction.vehicleType);
  const due = Math.max(0, Number(transaction.dueAmount || 0));
  const change = Math.max(0, Number(transaction.changeAmount || 0));
  const duration = transaction.duration || formatDuration(transaction.durationMs);
  const receiptLines = [
    String(standName || 'Sri Kaliamman Parking').trim() || 'Sri Kaliamman Parking',
    'DIGITAL PARKING RECEIPT',
    '────────────────────────',
    `Receipt no.: ${transaction.serial}`,
    `Vehicle: ${transaction.vehicleNumber} (${vehicle.label})`,
    `Entry: ${formatDateTime(transaction.entryAt)}`,
    `Exit: ${formatDateTime(transaction.checkoutAt)}`,
    `Parking duration: ${duration}`,
    '────────────────────────',
    `Parking charge: ${formatMoney(transaction.parkingCharge)}`,
    `Amount received: ${formatMoney(transaction.amountPaid)}`,
    `Balance due: ${formatMoney(due)}`,
  ];
  if (change) receiptLines.push(`Change returned: ${formatMoney(change)}`);
  receiptLines.push(
    `Payment status: ${receiptPaymentStatus(transaction)}`,
    'Thank you for choosing us. Please keep this receipt for your records.',
  );
  return receiptLines.join('\n');
}

export function buildWhatsAppReceiptUrl(phone, message) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function buildSmsReceiptUrl(phone, message, userAgent = '') {
  const separator = /iPad|iPhone|iPod/.test(userAgent) ? '&' : '?';
  return `sms:${phone}${separator}body=${encodeURIComponent(message)}`;
}
