import {
  parkingStore,
  calculateParkingCharge,
  formatCustomerPhone,
  formatDuration,
  formatVehicleNumber,
  getVehicleMeta,
  normalizeCustomerPhone,
  normalizeVehicleNumber,
} from './js/store.js?v=9';
import {
  buildReceiptMessage,
  buildSmsReceiptUrl,
  buildWhatsAppReceiptUrl,
  receiptPaymentStatus,
} from './js/receipt.js?v=9';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const timeFormat = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

let activeFilter = 'all';
let activeQuery = '';
let checkoutPreview = null;
let receiptRecord = null;
let receiptStandName = '';
let entryTicketRecord = null;
let toastTimer = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatMoney(value) {
  return currency.format(Number(value || 0));
}

function formatDate(value) {
  return dateFormat.format(new Date(value));
}

function formatDateTime(value) {
  return dateTimeFormat.format(new Date(value));
}

function formatTime(value) {
  return timeFormat.format(new Date(value));
}

function paymentStatus(record) {
  const due = Number(record?.dueAmount || 0);
  const paid = Number(record?.amountPaid || 0);
  if (due > 0) return paid > 0 ? 'PARTIALLY PAID' : 'UNPAID';
  return 'PAID';
}

function renderPriceBreakdown(lines = []) {
  if (!lines.length) return '';
  return lines.map((line) => `<div><span>${escapeHtml(line.label)}</span><strong>${line.amount < 0 ? '−' : ''}${formatMoney(Math.abs(line.amount))}</strong></div>`).join('');
}

function localDateInput(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function updateText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function showToast(message, type = 'info') {
  const region = $('#toast-region');
  if (!region) return;
  clearTimeout(toastTimer);
  region.innerHTML = `<div class="toast toast-${type}" role="status"><span>${type === 'error' ? '!' : type === 'success' ? '✓' : 'i'}</span><p>${escapeHtml(message)}</p><button type="button" aria-label="Dismiss message">×</button></div>`;
  $('.toast button', region)?.addEventListener('click', () => { region.innerHTML = ''; });
  toastTimer = setTimeout(() => { region.innerHTML = ''; }, 5200);
}

function setLoading(button, loading, text = 'Saving…') {
  if (!button) return;
  if (loading) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="button-spinner"></span>${escapeHtml(text)}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  }
}

function setView(view) {
  const safeView = $(`[data-view="${view}"]`) ? view : 'dashboard';
  $$('.view').forEach((section) => section.classList.toggle('is-active', section.dataset.view === safeView));
  $$('[data-nav]').forEach((link) => link.classList.toggle('is-active', link.dataset.nav === safeView));
  if (location.hash.slice(1) !== safeView) history.replaceState(null, '', `#${safeView}`);
  if (safeView === 'active') renderActive();
  if (safeView === 'memberships') renderMemberships();
  if (safeView === 'reports') renderReports();
  if (safeView === 'settings') renderSettings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function entryType() {
  return $('input[name="vehicleType"]:checked')?.value || 'two-wheeler';
}

function selectEntryType(type) {
  const input = $(`input[name="vehicleType"][value="${type}"]`);
  if (!input) return;
  input.checked = true;
  $$('.vehicle-choice').forEach((choice) => choice.classList.toggle('is-selected', $('input', choice)?.value === type));
  const meta = getVehicleMeta(type);
  updateText('#plate-type-badge', meta.emoji);
  updateText('#preview-vehicle', meta.emoji);
  updateText('#preview-type', meta.label);
}

function renderActiveRows(records, compact = false) {
  if (!records.length) {
    return `<div class="empty-state"><span>🅿️</span><h2>No vehicles parked</h2><p>${compact ? 'Your newest parking tickets will appear here.' : 'Create a parking ticket when a vehicle arrives.'}</p>${compact ? '' : '<button class="button button-primary" type="button" data-go="entry">＋ Park a vehicle</button>'}</div>`;
  }
  return records.map((record) => {
    const meta = getVehicleMeta(record.vehicleType);
    const estimate = calculateParkingCharge(record);
    return `<article class="parking-row ${compact ? 'parking-row-compact' : ''}">
      <div class="parking-vehicle-icon ${record.vehicleType}">${meta.emoji}</div>
      <div class="parking-main"><div class="parking-identity"><span class="serial">${escapeHtml(record.serial)}</span><span class="member-tag parked-status">● PARKED</span>${record.membershipId ? '<span class="member-tag">◇ Pass</span>' : ''}</div><strong>${escapeHtml(record.vehicleNumber)}</strong><small>${meta.label} · entered ${escapeHtml(formatDateTime(record.entryAt))}</small></div>
      <div class="parking-time"><small>Parked for</small><b>${escapeHtml(formatDuration(estimate.durationMs))}</b></div>
      <div class="parking-price"><small>Estimated charge</small><b>${formatMoney(estimate.parkingCharge)}</b></div>
      <button class="button button-dark checkout-button" type="button" data-action="open-checkout" data-id="${escapeHtml(record.id)}">Exit <span>→</span></button>
    </article>`;
  }).join('');
}

async function renderDashboard() {
  const [dashboard, twoStatus, fourStatus, notices] = await Promise.all([
    parkingStore.getDashboard(),
    parkingStore.getStatus('two-wheeler'),
    parkingStore.getStatus('four-wheeler'),
    parkingStore.listOperationalNotices(),
  ]);
  updateText('#metric-active', dashboard.activeCount);
  updateText('#metric-active-note', `🛵 ${dashboard.activeTwo}  ·  🚗 ${dashboard.activeFour}`);
  updateText('#metric-revenue', formatMoney(dashboard.todayCollection));
  updateText('#metric-revenue-note', `${dashboard.todayExits} checkout${dashboard.todayExits === 1 ? '' : 's'} today`);
  updateText('#metric-memberships', dashboard.membershipCount);
  updateText('#metric-memberships-note', 'valid parking passes');
  updateText('#metric-exits', dashboard.todayExits);
  updateText('#metric-exits-note', 'completed parking');
  updateText('#today-entry-total', dashboard.todayEntries);
  updateText('#today-entry-count', dashboard.todayEntries);
  updateText('#today-activity-summary', `${dashboard.todayExits} exit${dashboard.todayExits === 1 ? '' : 's'} · ${formatMoney(dashboard.todayCollection)} collected today`);
  updateText('#active-nav-count', dashboard.activeCount);
  updateText('#mobile-active-count', dashboard.activeCount);
  const circle = $('#activity-ring-value');
  if (circle) {
    const circumference = 2 * Math.PI * 48;
    circle.style.strokeDasharray = `${circumference}`;
    circle.style.strokeDashoffset = '0';
  }
  renderStandRow('two', twoStatus);
  renderStandRow('four', fourStatus);
  const recent = dashboard.active.slice(0, 5);
  const target = $('#dashboard-active-list');
  if (target) target.innerHTML = renderActiveRows(recent, true);
  const notificationTarget = $('#dashboard-notifications');
  if (notificationTarget) notificationTarget.innerHTML = notices.length
    ? notices.map((notice) => `<article class="operational-notice"><span>${notice.kind === 'exit' ? '↗' : '✓'}</span><div><strong>${escapeHtml(notice.title)}</strong><p>${escapeHtml(notice.detail)}</p><small>${escapeHtml(formatDateTime(notice.createdAt))} · recorded on this device</small></div></article>`).join('')
    : '<div class="empty-inline"><span>⌁</span><p>Entry and exit updates will be recorded here.</p></div>';
}

function renderStandRow(prefix, status) {
  const used = status.active.length;
  updateText(`#${prefix}-status-copy`, `${status.todayEntries} entries · ${status.todayExits} exits today`);
  updateText(`#${prefix}-status-number`, `${used} parked`);
}

async function renderActive() {
  const records = await parkingStore.listActive({ vehicleType: activeFilter, query: activeQuery });
  const list = $('#active-list');
  if (list) list.innerHTML = renderActiveRows(records);
  updateText('#active-heading-count', records.length);
  const clear = $('#clear-active-search');
  if (clear) clear.hidden = !activeQuery;
  $$('[data-active-filter]').forEach((button) => button.classList.toggle('is-selected', button.dataset.activeFilter === activeFilter));
}

function membershipStatusCopy(status) {
  if (status === 'active') return { label: 'Active', symbol: '●', className: 'active' };
  if (status === 'expired') return { label: 'Expired', symbol: '◷', className: 'expired' };
  return { label: 'Inactive', symbol: '–', className: 'inactive' };
}

async function renderMemberships() {
  const memberships = await parkingStore.listMemberships({ state: $('#membership-filter')?.value || 'all' });
  const all = await parkingStore.listMemberships();
  const today = new Date();
  const inSevenDays = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  const active = all.filter((record) => record.derivedStatus === 'active');
  const expiring = active.filter((record) => new Date(`${record.endDate}T23:59:59`).getTime() <= inSevenDays.getTime());
  updateText('#membership-active-count', active.length);
  updateText('#membership-expiring-count', expiring.length);
  updateText('#membership-two-count', active.filter((record) => record.vehicleType === 'two-wheeler').length);
  const list = $('#memberships-list');
  if (!list) return;
  if (!memberships.length) {
    list.innerHTML = '<div class="empty-inline"><span>◇</span><p>No memberships match this view.</p></div>';
    return;
  }
  list.innerHTML = memberships.map((record) => {
    const meta = getVehicleMeta(record.vehicleType);
    const status = membershipStatusCopy(record.derivedStatus);
    return `<article class="membership-row"><span class="membership-icon">${meta.emoji}</span><div class="membership-body"><strong>${escapeHtml(record.vehicleNumber)}</strong><small>${meta.label} · ${escapeHtml(formatDate(`${record.startDate}T12:00:00`))} – ${escapeHtml(formatDate(`${record.endDate}T12:00:00`))}</small></div><span class="status-pill ${status.className}">${status.symbol} ${status.label}</span><button class="text-button small-text-button" type="button" data-action="edit-membership" data-id="${escapeHtml(record.id)}">Edit</button></article>`;
  }).join('');
}

async function renderReports() {
  const from = $('#report-from')?.value || '';
  const to = $('#report-to')?.value || '';
  const report = await parkingStore.getReports({ from, to });
  updateText('#report-revenue', formatMoney(report.totalPaid));
  updateText('#report-transactions', report.transactions.length);
  updateText('#report-average', formatMoney(report.averageTicket));
  updateText('#report-due', formatMoney(report.totalDue));
  updateText('#report-table-total', `${report.transactions.length} record${report.transactions.length === 1 ? '' : 's'}`);
  const list = $('#report-list');
  if (!list) return;
  if (!report.transactions.length) {
    list.innerHTML = '<div class="empty-inline"><span>▥</span><p>No completed parking tickets in this period.</p></div>';
    return;
  }
  list.innerHTML = `<div class="transaction-head"><span>Ticket</span><span>Vehicle</span><span>Completed</span><span>Charge</span><span>Paid / Due</span></div>${report.transactions.map((record) => {
    const meta = getVehicleMeta(record.vehicleType);
    return `<article class="transaction-row"><span><b>${escapeHtml(record.serial)}</b><small>${meta.emoji} ${meta.label} · EXITED</small></span><span><b>${escapeHtml(record.vehicleNumber)}</b><small>In ${escapeHtml(formatDateTime(record.entryAt))}</small></span><span>${escapeHtml(formatDateTime(record.checkoutAt))}<small>${escapeHtml(formatDuration(record.durationMs))}</small></span><span>${formatMoney(record.parkingCharge)}</span><span><b>${formatMoney(record.amountPaid)}</b><small class="${record.dueAmount ? 'due-text' : 'paid-text'}">${record.dueAmount ? `Due ${formatMoney(record.dueAmount)} · ${paymentStatus(record)}` : 'PAID'}</small></span></article>`;
  }).join('')}`;
}

async function renderSettings() {
  const [settings, syncConfig] = await Promise.all([parkingStore.getSettings(), parkingStore.getSyncConfig()]);
  const form = $('#settings-form');
  if (!form) return;
  for (const [key, value] of Object.entries(settings)) {
    const input = $(`[name="${key}"]`, form);
    if (input) {
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = value;
    }
  }
  $$('.data-stand-name').forEach((node) => { node.textContent = settings.standName; });
  document.title = `${settings.standName} · Parking`;
  if ($('#sync-endpoint')) $('#sync-endpoint').value = syncConfig.endpoint;
  if ($('#sync-site-id')) $('#sync-site-id').value = syncConfig.siteId;
  if ($('#sync-device-token')) $('#sync-device-token').placeholder = syncConfig.deviceToken ? 'A device token is already saved on this device' : 'Paste the token for this device';
}

async function renderSyncStatus() {
  const status = await parkingStore.getSyncStatus();
  const map = {
    local: { label: 'Local data', detail: status.pending ? `${status.pending} change${status.pending === 1 ? '' : 's'} saved locally` : 'Ready offline', className: 'local' },
    offline: { label: 'Offline', detail: `${status.pending} change${status.pending === 1 ? '' : 's'} waiting to sync`, className: 'offline' },
    ready: { label: 'Ready to sync', detail: status.pending ? `${status.pending} change${status.pending === 1 ? '' : 's'} ready` : 'No pending changes', className: 'ready' },
    'activation-needed': { label: 'Device activation needed', detail: 'Save the securely issued device token in Settings.', className: 'offline' },
  };
  const copy = map[status.mode] || map.local;
  updateText('#sync-label', copy.label);
  updateText('#sync-detail', copy.detail);
  const dot = $('#sync-dot');
  if (dot) dot.className = `sync-dot ${copy.className}`;
  updateText('#settings-sync-title', status.mode === 'local' ? 'Local parking data' : copy.label);
  updateText('#settings-sync-copy', status.mode === 'local'
    ? 'This device keeps working offline. Connect a central backend when you are ready for multi-device sync.'
    : copy.detail);
}

async function renderAll() {
  await Promise.all([renderDashboard(), renderActive(), renderMemberships(), renderReports(), renderSettings(), renderSyncStatus()]);
}

async function openCheckout(id) {
  try {
    checkoutPreview = await parkingStore.getCheckoutPreview(id);
    const meta = getVehicleMeta(checkoutPreview.vehicleType);
    updateText('#checkout-vehicle-icon', meta.emoji);
    updateText('#checkout-serial', checkoutPreview.serial);
    updateText('#checkout-number', checkoutPreview.vehicleNumber);
    updateText('#checkout-duration', checkoutPreview.duration);
    updateText('#checkout-entry-time', formatDateTime(checkoutPreview.entryAt));
    updateText('#checkout-charge', formatMoney(checkoutPreview.baseCharge));
    updateText('#checkout-due', formatMoney(checkoutPreview.parkingCharge));
    const breakdown = $('#checkout-price-breakdown');
    if (breakdown) breakdown.innerHTML = renderPriceBreakdown(checkoutPreview.priceBreakdown);
    updateText('#checkout-policy-note', checkoutPreview.allowExitWithDue
      ? 'A balance may be recorded as due under the current exit policy.'
      : 'Full payment is required before this vehicle can exit.');
    const passRow = $('#checkout-pass-row');
    if (passRow) passRow.hidden = !checkoutPreview.membershipDiscount;
    updateText('#checkout-pass-adjustment', `−${formatMoney(checkoutPreview.membershipDiscount)}`);
    const paidInput = $('#checkout-paid');
    if (paidInput) paidInput.value = checkoutPreview.parkingCharge;
    const customerPhone = $('#checkout-customer-phone');
    if (customerPhone) customerPhone.value = formatCustomerPhone(checkoutPreview.customerPhone);
    updateCheckoutChange();
    $('#checkout-dialog')?.showModal();
  } catch (error) {
    showToast(error.message, 'error');
    renderAll();
  }
}

function updateCheckoutChange() {
  if (!checkoutPreview) return;
  const paid = Math.max(0, Number($('#checkout-paid')?.value || 0));
  const change = Math.max(0, paid - checkoutPreview.parkingCharge);
  const row = $('#checkout-change-row');
  if (row) row.hidden = !change;
  updateText('#checkout-change', formatMoney(change));
}

function closeCheckout() {
  checkoutPreview = null;
  $('#checkout-dialog')?.close();
}

async function showReceipt(record) {
  const settings = await parkingStore.getSettings();
  const meta = getVehicleMeta(record.vehicleType);
  receiptRecord = record;
  receiptStandName = settings.standName;
  updateText('#receipt-stand-name', receiptStandName);
  updateText('#receipt-serial', record.serial);
  updateText('#receipt-vehicle-icon', meta.emoji);
  updateText('#receipt-number', record.vehicleNumber);
  updateText('#receipt-type', meta.label);
  updateText('#receipt-entry', formatDateTime(record.entryAt));
  updateText('#receipt-exit', formatDateTime(record.checkoutAt));
  updateText('#receipt-duration', formatDuration(record.durationMs));
  updateText('#receipt-charge', formatMoney(record.parkingCharge));
  updateText('#receipt-paid', formatMoney(record.amountPaid));
  updateText('#receipt-due', formatMoney(record.dueAmount));
  const status = receiptPaymentStatus(record);
  const statusNode = $('#receipt-status');
  if (statusNode) {
    statusNode.textContent = status;
    statusNode.classList.toggle('is-due', status !== 'PAID');
  }
  const phoneInput = $('#receipt-customer-phone');
  if (phoneInput) phoneInput.value = formatCustomerPhone(record.customerPhone);
  $('#receipt-dialog')?.showModal();
}

function closeReceipt() {
  receiptRecord = null;
  receiptStandName = '';
  $('#receipt-dialog')?.close();
}

async function shareReceipt(channel) {
  if (!receiptRecord) return showToast('The completed receipt is no longer available.', 'error');
  try {
    const phone = normalizeCustomerPhone($('#receipt-customer-phone')?.value);
    if (!phone) throw new Error('Enter the customer mobile number before sending a receipt.');
    if (phone !== receiptRecord.customerPhone) receiptRecord = await parkingStore.updateReceiptRecipient(receiptRecord.id, phone);
    const message = buildReceiptMessage({ transaction: receiptRecord, standName: receiptStandName });
    const url = channel === 'whatsapp'
      ? buildWhatsAppReceiptUrl(phone, message)
      : buildSmsReceiptUrl(phone, message, navigator.userAgent);
    showToast(`Opening ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} with the receipt ready to send.`, 'success');
    closeReceipt();
    window.location.assign(url);
  } catch (error) {
    showToast(error.message || 'The receipt could not be prepared.', 'error');
  }
}

function showMembershipForm(membership = null) {
  const form = $('#membership-form');
  if (!form) return;
  const empty = $('#membership-empty-form');
  form.hidden = false;
  if (empty) empty.hidden = true;
  if (membership) {
    $('#membership-id').value = membership.id;
    $('#membership-number').value = membership.vehicleNumber;
    $('#membership-type').value = membership.vehicleType;
    $('#membership-start').value = membership.startDate;
    $('#membership-end').value = membership.endDate;
    $('#membership-amount').value = membership.amount;
    $('#membership-active').checked = membership.active;
    updateText('#membership-form-kicker', 'Edit monthly pass');
    updateText('#membership-form-title', 'Update membership');
    updateText('#membership-save', 'Save membership');
  } else {
    form.reset();
    $('#membership-id').value = '';
    $('#membership-start').value = localDateInput();
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    $('#membership-end').value = localDateInput(nextMonth);
    $('#membership-active').checked = true;
    updateText('#membership-form-kicker', 'New monthly pass');
    updateText('#membership-form-title', 'Add membership');
    updateText('#membership-save', 'Save pass');
  }
}

function hideMembershipForm() {
  const form = $('#membership-form');
  if (form) form.hidden = true;
  const empty = $('#membership-empty-form');
  if (empty) empty.hidden = false;
}

async function editMembership(id) {
  const memberships = await parkingStore.listMemberships();
  const membership = memberships.find((record) => record.id === id);
  if (!membership) return showToast('Membership could not be found.', 'error');
  showMembershipForm(membership);
}

async function handleEntry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('[type="submit"]', form);
  try {
    setLoading(button, true, 'Creating ticket…');
    const record = await parkingStore.createEntry({
      vehicleType: entryType(),
      vehicleNumber: $('#entry-vehicle-number').value,
      customerPhone: $('#entry-customer-phone').value,
    });
    $('#success-number').textContent = `${record.serial} · ${record.vehicleNumber}`;
    $('#success-copy').textContent = `${getVehicleMeta(record.vehicleType).label} entry saved at ${formatTime(record.entryAt)}.`;
    form.reset();
    selectEntryType('two-wheeler');
    updateEntryPreview();
    await renderAll();
    entryTicketRecord = record;
    $('#success-dialog')?.showModal();
  } catch (error) {
    showToast(error.message || 'Unable to create the parking ticket.', 'error');
  } finally {
    setLoading(button, false);
  }
}

async function showEntryTicket() {
  if (!entryTicketRecord) return showToast('The new parking ticket is no longer available.', 'error');
  const settings = await parkingStore.getSettings();
  const meta = getVehicleMeta(entryTicketRecord.vehicleType);
  updateText('#entry-ticket-stand-name', settings.standName);
  updateText('#entry-ticket-serial', entryTicketRecord.serial);
  updateText('#entry-ticket-number', entryTicketRecord.vehicleNumber);
  updateText('#entry-ticket-type', `${meta.emoji} ${meta.label}`);
  updateText('#entry-ticket-time', formatDateTime(entryTicketRecord.entryAt));
  updateText('#entry-ticket-rate', entryTicketRecord.pricingMode === 'flexible' ? 'Flexible rate plan' : `${formatMoney(entryTicketRecord.ratePerPeriod)} / ${entryTicketRecord.billingPeriodHours} hours`);
  $('#ticket-dialog')?.showModal();
}

function printEntryTicket() {
  if (!entryTicketRecord) return showToast('The parking ticket is no longer available.', 'error');
  document.body.classList.add('printing-entry-ticket');
  window.print();
  window.setTimeout(() => document.body.classList.remove('printing-entry-ticket'), 250);
}

async function handleCheckout(event) {
  event.preventDefault();
  if (!checkoutPreview) return;
  const button = $('#confirm-checkout');
  try {
    setLoading(button, true, 'Checking out…');
    const refreshed = await parkingStore.getCheckoutPreview(checkoutPreview.id);
    if (refreshed.parkingCharge !== checkoutPreview.parkingCharge) {
      checkoutPreview = refreshed;
      updateText('#checkout-charge', formatMoney(refreshed.baseCharge));
      updateText('#checkout-due', formatMoney(refreshed.parkingCharge));
      const breakdown = $('#checkout-price-breakdown');
      if (breakdown) breakdown.innerHTML = renderPriceBreakdown(refreshed.priceBreakdown);
      $('#checkout-paid').value = refreshed.parkingCharge;
      updateCheckoutChange();
      showToast('Parking duration changed. Please review the updated bill before confirming.', 'info');
      return;
    }
    const completed = await parkingStore.checkout(checkoutPreview.id, $('#checkout-paid').value, {
      customerPhone: $('#checkout-customer-phone').value,
    });
    closeCheckout();
    await renderAll();
    await showReceipt(completed);
  } catch (error) {
    showToast(error.message || 'Checkout could not be completed.', 'error');
  } finally {
    setLoading(button, false);
  }
}

async function handleMembership(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#membership-save');
  try {
    setLoading(button, true, 'Saving pass…');
    const data = new FormData(form);
    const membership = await parkingStore.saveMembership({
      id: data.get('membershipId') || undefined,
      vehicleNumber: data.get('vehicleNumber'),
      vehicleType: data.get('vehicleType'),
      startDate: data.get('startDate'),
      endDate: data.get('endDate'),
      amount: data.get('amount'),
      active: data.get('active') === 'on',
    });
    hideMembershipForm();
    showToast(`Membership saved for ${membership.vehicleNumber}.`, 'success');
    await renderAll();
  } catch (error) {
    showToast(error.message || 'Membership could not be saved.', 'error');
  } finally {
    setLoading(button, false);
  }
}

async function handleSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('[type="submit"]', form);
  try {
    setLoading(button, true, 'Saving setup…');
    const data = new FormData(form);
    await parkingStore.saveSettings(Object.fromEntries(data));
    showToast('Parking setup saved. New tickets use these rates.', 'success');
    await renderAll();
  } catch (error) {
    showToast(error.message || 'Settings could not be saved.', 'error');
  } finally {
    setLoading(button, false);
  }
}

async function handleSyncConfig(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('[type="submit"]', form);
  try {
    setLoading(button, true, 'Saving connection…');
    const current = await parkingStore.getSyncConfig();
    const token = $('#sync-device-token').value.trim();
    await parkingStore.saveSyncConfig({
      endpoint: $('#sync-endpoint').value,
      siteId: $('#sync-site-id').value,
      deviceToken: token || current.deviceToken,
    });
    $('#sync-device-token').value = '';
    showToast('Secure device connection saved on this device.', 'success');
    await renderAll();
  } catch (error) {
    showToast(error.message || 'Device connection could not be saved.', 'error');
  } finally {
    setLoading(button, false);
  }
}

async function handleSync() {
  const buttons = ['#sync-button', '#settings-sync-button'].map((selector) => $(selector)).filter(Boolean);
  buttons.forEach((button) => button.disabled = true);
  try {
    const result = await parkingStore.syncNow();
    showToast(result.message || 'Sync status refreshed.', result.mode === 'synced' ? 'success' : result.mode === 'error' ? 'error' : 'info');
    await renderAll();
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function exportReport() {
  const report = await parkingStore.getReports({ from: $('#report-from').value || '', to: $('#report-to').value || '' });
  if (!report.transactions.length) return showToast('There are no completed parking tickets to export.', 'info');
  const rows = [
    ['Serial Number', 'Vehicle Number', 'Vehicle Type', 'Entry', 'Exit', 'Duration', 'Charge', 'Amount Paid', 'Due Amount', 'Membership'],
    ...report.transactions.map((record) => [record.serial, record.vehicleNumber, record.vehicleType, record.entryAt, record.checkoutAt, formatDuration(record.durationMs), record.parkingCharge, record.amountPaid, record.dueAmount, record.membershipId ? 'Active at entry' : 'Not active']),
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `sri-kaliamman-parking-report-${localDateInput()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showToast('Report exported as CSV.', 'success');
}

function updateEntryPreview() {
  const raw = $('#entry-vehicle-number')?.value || '';
  const number = normalizeVehicleNumber(raw) || 'TN 00 AB 0000';
  updateText('#preview-number', number);
}

function compactCharactersBeforeCursor(input) {
  const cursor = input.selectionStart ?? input.value.length;
  return input.value.slice(0, cursor).replace(/[^A-Z0-9]/gi, '').length;
}

function cursorForCompactCharacters(value, characters) {
  let seen = 0;
  let position = 0;
  while (position < value.length && seen < characters) {
    if (/[A-Z0-9]/i.test(value[position])) seen += 1;
    position += 1;
  }
  return position;
}

function formatRegistrationInput(event) {
  const input = event.currentTarget;
  const compactCursor = compactCharactersBeforeCursor(input);
  const isDeleting = event.inputType?.startsWith('delete');
  const formatted = formatVehicleNumber(input.value, { trailingSeparator: !isDeleting });
  if (input.value !== formatted) {
    input.value = formatted;
    const cursor = cursorForCompactCharacters(formatted, compactCursor);
    input.setSelectionRange(cursor, cursor);
  }
  if (input.id === 'entry-vehicle-number') updateEntryPreview();
}

function bindEvents() {
  window.addEventListener('hashchange', () => setView(location.hash.slice(1) || 'dashboard'));
  document.addEventListener('click', async (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      setView(nav.dataset.nav);
      return;
    }
    const go = event.target.closest('[data-go]');
    if (go) {
      event.preventDefault();
      if (go.dataset.entryType) selectEntryType(go.dataset.entryType);
      if (go.dataset.action === 'close-success') $('#success-dialog')?.close();
      setView(go.dataset.go);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      const type = action.dataset.action;
      if (type === 'open-checkout') return openCheckout(action.dataset.id);
      if (type === 'close-checkout') return closeCheckout();
      if (type === 'close-success') return $('#success-dialog')?.close();
      if (type === 'show-entry-ticket') return showEntryTicket();
      if (type === 'close-ticket') return $('#ticket-dialog')?.close();
      if (type === 'print-entry-ticket') return printEntryTicket();
      if (type === 'close-receipt') return closeReceipt();
      if (type === 'share-receipt-whatsapp') return shareReceipt('whatsapp');
      if (type === 'share-receipt-sms') return shareReceipt('sms');
      if (type === 'filter-vehicle') {
        activeFilter = action.dataset.type;
        setView('active');
        return;
      }
      if (type === 'edit-membership') return editMembership(action.dataset.id);
    }
    const filter = event.target.closest('[data-active-filter]');
    if (filter) {
      activeFilter = filter.dataset.activeFilter;
      return renderActive();
    }
    if (event.target.closest('#show-membership-form') || event.target.closest('#show-membership-form-alt')) return showMembershipForm();
    if (event.target.closest('#hide-membership-form')) return hideMembershipForm();
    if (event.target.closest('#fill-due-amount') && checkoutPreview) {
      $('#checkout-paid').value = checkoutPreview.parkingCharge;
      return updateCheckoutChange();
    }
    if (event.target.closest('#clear-active-search')) {
      $('#active-search').value = '';
      activeQuery = '';
      return renderActive();
    }
    if (event.target.closest('#sync-button') || event.target.closest('#settings-sync-button')) return handleSync();
    if (event.target.closest('#apply-report-filter')) return renderReports();
    if (event.target.closest('#export-report')) return exportReport();
  });
  $('#entry-form')?.addEventListener('submit', handleEntry);
  $('#checkout-form')?.addEventListener('submit', handleCheckout);
  $('#membership-form')?.addEventListener('submit', handleMembership);
  $('#settings-form')?.addEventListener('submit', handleSettings);
  $('#sync-config-form')?.addEventListener('submit', handleSyncConfig);
  $$('[data-vehicle-format]').forEach((input) => input.addEventListener('input', formatRegistrationInput));
  $$('input[name="vehicleType"]').forEach((input) => input.addEventListener('change', () => selectEntryType(input.value)));
  $('#active-search')?.addEventListener('input', (event) => { activeQuery = event.target.value; renderActive(); });
  $('#membership-filter')?.addEventListener('change', renderMemberships);
  $('#checkout-paid')?.addEventListener('input', updateCheckoutChange);
  window.addEventListener('online', renderSyncStatus);
  window.addEventListener('offline', renderSyncStatus);
}

async function start() {
  try {
    await parkingStore.init();
    bindEvents();
    selectEntryType('two-wheeler');
    updateEntryPreview();
    await renderAll();
    $('#app-loader')?.setAttribute('hidden', '');
    $('#app-shell')?.removeAttribute('hidden');
    setView(location.hash.slice(1) || 'dashboard');
  } catch (error) {
    const loader = $('#app-loader');
    if (loader) loader.innerHTML = `<div class="loader-logo-wrap"><img src="../assets/sri-kaliamman-logo.jpg" alt="Sri Kaliamman Parking" /></div><p><strong>Parking data could not start.</strong><br />${escapeHtml(error.message || 'Please open the app in a modern browser with local storage enabled.')}</p>`;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {
    // The online app still works when a browser blocks service workers.
  });
}

start();
