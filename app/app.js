import {
  parkingStore,
  calculateParkingCharge,
  formatDuration,
  getVehicleMeta,
  normalizeVehicleNumber,
} from './js/store.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const timeFormat = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

let activeFilter = 'all';
let activeQuery = '';
let checkoutPreview = null;
let toastTimer = null;
let deferredInstallPrompt = null;
const shouldOpenInstall = new URLSearchParams(window.location.search).get('install') === '1';

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

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function getInstallHelp() {
  const agent = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(agent);
  if (isIOS) {
    return {
      message: 'Add Sri Kaliamman Parking to your iPhone or iPad home screen.',
      steps: ['Tap the Share button in Safari.', 'Choose “Add to Home Screen”.', 'Tap “Add” to install the app icon.'],
      note: 'For installation on iPhone or iPad, open this site in Safari.',
    };
  }
  if (isAndroid) {
    return {
      message: 'Install it once and open the parking desk directly from your Android home screen.',
      steps: ['Open this page in Google Chrome.', 'Tap the Chrome menu (⋮).', 'Choose “Install app” or “Add to Home screen”.'],
      note: 'Chrome will install Sri Kaliamman Parking as an Android launcher app.',
    };
  }
  return {
    message: 'Install it for a focused, full-screen parking desk on this device.',
    steps: ['Open the browser menu or address bar install icon.', 'Choose “Install Sri Kaliamman Parking”.', 'Open it from your app launcher when installation finishes.'],
    note: 'If your browser does not show an install option, open this page in Chrome on Android.',
  };
}

function updateInstallActions() {
  const installed = isStandaloneApp();
  $$('[data-action="show-install"]').forEach((button) => {
    button.setAttribute('aria-label', installed ? 'Sri Kaliamman Parking is installed' : 'Install Sri Kaliamman Parking app');
  });
}

function renderInstallDialog() {
  const dialog = $('#install-dialog');
  if (!dialog) return;
  const installed = isStandaloneApp();
  const help = getInstallHelp();
  const title = $('#install-title');
  const message = $('#install-message');
  const steps = $('#install-steps');
  const note = $('#install-platform-note');
  const button = $('#install-confirm');
  if (installed) {
    if (title) title.textContent = 'App already installed';
    if (message) message.textContent = 'Sri Kaliamman Parking is ready in your home screen or app launcher.';
    if (steps) steps.innerHTML = '<li>Open Sri Kaliamman Parking from your device’s home screen.</li>';
    if (note) note.textContent = 'You can continue using this full-screen app offline.';
    if (button) {
      button.dataset.action = 'close-install';
      button.textContent = '✓ Done';
    }
    return;
  }
  if (title) title.textContent = deferredInstallPrompt ? 'Install the parking app now' : 'Install the parking app';
  if (message) message.textContent = deferredInstallPrompt ? 'Your browser is ready to install Sri Kaliamman Parking.' : help.message;
  if (steps) steps.innerHTML = help.steps.map((step) => `<li>${step}</li>`).join('');
  if (note) note.textContent = deferredInstallPrompt ? 'Tap the button below to complete installation.' : help.note;
  if (button) {
    button.dataset.action = 'request-install';
    button.textContent = deferredInstallPrompt ? '📲 Install on this device' : '📲 Show install steps';
  }
}

function showInstallDialog() {
  const dialog = $('#install-dialog');
  if (!dialog) return;
  renderInstallDialog();
  if (!dialog.open) dialog.showModal();
}

function closeInstallDialog() {
  const dialog = $('#install-dialog');
  if (dialog?.open) dialog.close();
}

async function requestInstall() {
  if (isStandaloneApp()) return closeInstallDialog();
  if (!deferredInstallPrompt) {
    renderInstallDialog();
    return showToast('Use the steps shown here to install the app in your browser.', 'info');
  }
  try {
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderInstallDialog();
    if (outcome === 'accepted') {
      closeInstallDialog();
      showToast('Installing Sri Kaliamman Parking…', 'success');
    }
  } catch {
    renderInstallDialog();
    showToast('The browser did not open its install prompt. Follow the steps shown here.', 'info');
  }
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallActions();
  if ($('#install-dialog')?.open) renderInstallDialog();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallActions();
  closeInstallDialog();
  showToast('Sri Kaliamman Parking is installed and ready to use.', 'success');
});

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
      <div class="parking-main"><div class="parking-identity"><span class="serial">${escapeHtml(record.serial)}</span>${record.membershipId ? '<span class="member-tag">◇ Pass</span>' : ''}</div><strong>${escapeHtml(record.vehicleNumber)}</strong><small>${meta.label} · entered ${escapeHtml(formatDateTime(record.entryAt))}</small></div>
      <div class="parking-time"><small>Parked for</small><b>${escapeHtml(formatDuration(estimate.durationMs))}</b></div>
      <div class="parking-price"><small>Current charge</small><b>${formatMoney(estimate.parkingCharge)}</b></div>
      <button class="button button-dark checkout-button" type="button" data-action="open-checkout" data-id="${escapeHtml(record.id)}">Exit <span>→</span></button>
    </article>`;
  }).join('');
}

async function renderDashboard() {
  const [dashboard, twoStatus, fourStatus] = await Promise.all([
    parkingStore.getDashboard(),
    parkingStore.getStatus('two-wheeler'),
    parkingStore.getStatus('four-wheeler'),
  ]);
  updateText('#metric-active', dashboard.activeCount);
  updateText('#metric-active-note', `${dashboard.activeTwo} 🛵 · ${dashboard.activeFour} 🚗`);
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
    return `<article class="transaction-row"><span><b>${escapeHtml(record.serial)}</b><small>${meta.emoji} ${meta.label}</small></span><span><b>${escapeHtml(record.vehicleNumber)}</b><small>In ${escapeHtml(formatDateTime(record.entryAt))}</small></span><span>${escapeHtml(formatDateTime(record.checkoutAt))}<small>${escapeHtml(formatDuration(record.durationMs))}</small></span><span>${formatMoney(record.parkingCharge)}</span><span><b>${formatMoney(record.amountPaid)}</b><small class="${record.dueAmount ? 'due-text' : 'paid-text'}">${record.dueAmount ? `Due ${formatMoney(record.dueAmount)}` : 'Paid'}</small></span></article>`;
  }).join('')}`;
}

async function renderSettings() {
  const [settings, syncConfig] = await Promise.all([parkingStore.getSettings(), parkingStore.getSyncConfig()]);
  const form = $('#settings-form');
  if (!form) return;
  for (const [key, value] of Object.entries(settings)) {
    const input = $(`[name="${key}"]`, form);
    if (input) input.value = value;
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
    const passRow = $('#checkout-pass-row');
    if (passRow) passRow.hidden = !checkoutPreview.membershipDiscount;
    updateText('#checkout-pass-adjustment', `−${formatMoney(checkoutPreview.membershipDiscount)}`);
    const paidInput = $('#checkout-paid');
    if (paidInput) paidInput.value = checkoutPreview.parkingCharge;
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
    const record = await parkingStore.createEntry({ vehicleType: entryType(), vehicleNumber: $('#entry-vehicle-number').value });
    $('#success-number').textContent = `${record.serial} · ${record.vehicleNumber}`;
    $('#success-copy').textContent = `${getVehicleMeta(record.vehicleType).label} entry saved at ${formatTime(record.entryAt)}.`;
    form.reset();
    selectEntryType('two-wheeler');
    updateEntryPreview();
    await renderAll();
    $('#success-dialog')?.showModal();
  } catch (error) {
    showToast(error.message || 'Unable to create the parking ticket.', 'error');
  } finally {
    setLoading(button, false);
  }
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
      $('#checkout-paid').value = refreshed.parkingCharge;
      updateCheckoutChange();
      showToast('Parking duration changed. Please review the updated bill before confirming.', 'info');
      return;
    }
    const completed = await parkingStore.checkout(checkoutPreview.id, $('#checkout-paid').value);
    closeCheckout();
    showToast(`Checkout completed for ${completed.vehicleNumber}.`, 'success');
    await renderAll();
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
  const buttons = ['#sync-button', '#mobile-sync-button', '#settings-sync-button'].map((selector) => $(selector)).filter(Boolean);
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
      if (type === 'show-install') return showInstallDialog();
      if (type === 'request-install') return requestInstall();
      if (type === 'close-install') return closeInstallDialog();
      if (type === 'open-checkout') return openCheckout(action.dataset.id);
      if (type === 'close-checkout') return closeCheckout();
      if (type === 'close-success') return $('#success-dialog')?.close();
      if (type === 'refresh-dashboard') return renderAll();
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
    if (event.target.closest('#sync-button') || event.target.closest('#mobile-sync-button') || event.target.closest('#settings-sync-button')) return handleSync();
    if (event.target.closest('#apply-report-filter')) return renderReports();
    if (event.target.closest('#export-report')) return exportReport();
  });
  $('#entry-form')?.addEventListener('submit', handleEntry);
  $('#checkout-form')?.addEventListener('submit', handleCheckout);
  $('#membership-form')?.addEventListener('submit', handleMembership);
  $('#settings-form')?.addEventListener('submit', handleSettings);
  $('#sync-config-form')?.addEventListener('submit', handleSyncConfig);
  $('#entry-vehicle-number')?.addEventListener('input', updateEntryPreview);
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
    updateInstallActions();
    $('#app-loader')?.setAttribute('hidden', '');
    $('#app-shell')?.removeAttribute('hidden');
    setView(location.hash.slice(1) || 'dashboard');
    if (shouldOpenInstall) window.setTimeout(showInstallDialog, 120);
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
