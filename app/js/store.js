/*
 * Sri Kaliamman Parking local data layer.
 *
 * The app is intentionally usable without a network connection. IndexedDB is
 * the source of truth on the device; each mutation also gets a durable sync
 * operation so an optional central service can replay it idempotently later.
 */

const DATABASE_NAME = 'sri-kaliamman-parking';
const DATABASE_VERSION = 1;
const SETTINGS_ID = 'parking-settings';

export const DEFAULT_SETTINGS = Object.freeze({
  id: SETTINGS_ID,
  standName: 'Sri Kaliamman Parking',
  twoWheelerRate: 15,
  fourWheelerRate: 70,
  twoWheelerCapacity: 100,
  fourWheelerCapacity: 20,
  billingPeriodHours: 24,
  billingRule: 'ceil-period',
  monthlyMembershipAmount: 0,
  membershipDiscountPercent: 0,
  updatedAt: null,
});

const TYPE_META = Object.freeze({
  'two-wheeler': { label: 'Two wheeler', emoji: '🛵', rateKey: 'twoWheelerRate', capacityKey: 'twoWheelerCapacity' },
  'four-wheeler': { label: 'Four wheeler', emoji: '🚗', rateKey: 'fourWheelerRate', capacityKey: 'fourWheelerCapacity' },
});

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local data request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Local data could not be saved.'));
    transaction.onabort = () => reject(transaction.error || new Error('Local data operation was cancelled.'));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('active')) {
        const store = db.createObjectStore('active', { keyPath: 'id' });
        store.createIndex('vehicleNumber', 'vehicleNumber', { unique: true });
        store.createIndex('serial', 'serial', { unique: true });
        store.createIndex('entryAt', 'entryAt');
        store.createIndex('vehicleType', 'vehicleType');
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id' });
        store.createIndex('serial', 'serial', { unique: true });
        store.createIndex('vehicleNumber', 'vehicleNumber');
        store.createIndex('checkoutAt', 'checkoutAt');
        store.createIndex('entryAt', 'entryAt');
        store.createIndex('vehicleType', 'vehicleType');
      }
      if (!db.objectStoreNames.contains('memberships')) {
        const store = db.createObjectStore('memberships', { keyPath: 'id' });
        store.createIndex('vehicleNumber', 'vehicleNumber');
        store.createIndex('endDate', 'endDate');
        store.createIndex('active', 'active');
      }
      if (!db.objectStoreNames.contains('queue')) {
        const store = db.createObjectStore('queue', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('entityId', 'entityId');
      }
      if (!db.objectStoreNames.contains('serials')) db.createObjectStore('serials', { keyPath: 'serial' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Parking data could not be opened.'));
  });
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(16));
  if (bytes) {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function localDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortNewest(records, property) {
  return records.sort((left, right) => new Date(right[property]).getTime() - new Date(left[property]).getTime());
}

export function normalizeVehicleNumber(value) {
  const cleaned = String(value || '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9\s-]/g, '')
    .replace(/[-\s]+/g, ' ')
    .trim();
  return cleaned;
}

export function validateVehicleNumber(value) {
  const vehicleNumber = normalizeVehicleNumber(value);
  const compact = vehicleNumber.replace(/\s/g, '');
  if (!vehicleNumber) throw new Error('Vehicle number is required.');
  if (compact.length < 4 || compact.length > 16 || !/^[A-Z0-9]+$/.test(compact)) {
    throw new Error('Enter a valid vehicle registration number.');
  }
  if (!/[0-9]/.test(compact)) throw new Error('Vehicle registration number must include a digit.');
  return vehicleNumber;
}

export function getVehicleMeta(vehicleType) {
  const meta = TYPE_META[vehicleType];
  if (!meta) throw new Error('Choose a valid vehicle type.');
  return meta;
}

export function calculateParkingCharge(record, exitAt = new Date().toISOString()) {
  const entryMs = new Date(record.entryAt).getTime();
  const exitMs = new Date(exitAt).getTime();
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs)) throw new Error('Parking time is not valid.');
  const periodHours = Math.max(1, asNumber(record.billingPeriodHours, 24));
  const elapsedMs = Math.max(0, exitMs - entryMs);
  const periods = Math.max(1, Math.ceil(elapsedMs / (periodHours * 60 * 60 * 1000)));
  const baseCharge = Math.round(periods * Math.max(0, asNumber(record.ratePerPeriod, 0)));
  const discountPercent = Math.max(0, Math.min(100, asNumber(record.membershipDiscountPercent, 0)));
  const discount = Math.round((baseCharge * discountPercent) / 100);
  return {
    exitAt,
    durationMs: elapsedMs,
    periods,
    baseCharge,
    membershipDiscount: discount,
    parkingCharge: Math.max(0, baseCharge - discount),
  };
}

export function formatDuration(durationMs) {
  const minutes = Math.max(0, Math.floor(asNumber(durationMs) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days}d ${hours}h ${mins}m`;
  if (hours) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}

export class ParkingStore {
  constructor() {
    this.db = null;
  }

  async init() {
    if (!this.db) this.db = await openDatabase();
    const settings = await this._get('settings', SETTINGS_ID);
    if (!settings) await this._put('settings', { ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() });
    const deviceId = await this._getMeta('deviceId');
    if (!deviceId) await this._setMeta('deviceId', uuid());
    return this;
  }

  async _transaction(storeNames, mode, work) {
    if (!this.db) await this.init();
    const transaction = this.db.transaction(storeNames, mode);
    let result;
    try {
      result = await work(transaction);
      await transactionDone(transaction);
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* transaction may already be complete */ }
      throw error;
    }
  }

  async _get(storeName, key) {
    return this._transaction([storeName], 'readonly', (transaction) => requestValue(transaction.objectStore(storeName).get(key)));
  }

  async _getAll(storeName) {
    return this._transaction([storeName], 'readonly', (transaction) => requestValue(transaction.objectStore(storeName).getAll()));
  }

  async _put(storeName, value) {
    return this._transaction([storeName], 'readwrite', async (transaction) => {
      await requestValue(transaction.objectStore(storeName).put(value));
      return value;
    });
  }

  async _delete(storeName, key) {
    return this._transaction([storeName], 'readwrite', (transaction) => requestValue(transaction.objectStore(storeName).delete(key)));
  }

  async _getMeta(key) {
    const value = await this._get('meta', key);
    return value?.value ?? null;
  }

  async _setMeta(key, value) {
    return this._put('meta', { key, value, updatedAt: new Date().toISOString() });
  }

  async getSettings() {
    await this.init();
    return { ...DEFAULT_SETTINGS, ...(await this._get('settings', SETTINGS_ID)) };
  }

  async saveSettings(input) {
    const current = await this.getSettings();
    const next = {
      ...current,
      standName: String(input.standName || current.standName).trim() || current.standName,
      twoWheelerRate: Math.max(0, Math.round(asNumber(input.twoWheelerRate, current.twoWheelerRate))),
      fourWheelerRate: Math.max(0, Math.round(asNumber(input.fourWheelerRate, current.fourWheelerRate))),
      twoWheelerCapacity: Math.max(0, Math.round(asNumber(input.twoWheelerCapacity, current.twoWheelerCapacity))),
      fourWheelerCapacity: Math.max(0, Math.round(asNumber(input.fourWheelerCapacity, current.fourWheelerCapacity))),
      billingPeriodHours: Math.max(1, Math.round(asNumber(input.billingPeriodHours, current.billingPeriodHours))),
      monthlyMembershipAmount: Math.max(0, Math.round(asNumber(input.monthlyMembershipAmount, current.monthlyMembershipAmount))),
      membershipDiscountPercent: Math.max(0, Math.min(100, Math.round(asNumber(input.membershipDiscountPercent, current.membershipDiscountPercent)))),
      updatedAt: new Date().toISOString(),
    };
    await this._transaction(['settings', 'queue'], 'readwrite', async (transaction) => {
      await requestValue(transaction.objectStore('settings').put(next));
      await requestValue(transaction.objectStore('queue').put(this._queueItem('settings.upsert', SETTINGS_ID, next)));
    });
    return next;
  }

  _queueItem(kind, entityId, payload) {
    return {
      id: uuid(),
      operationId: uuid(),
      kind,
      entityId,
      payload: clone(payload),
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
  }

  async listActive(filters = {}) {
    const all = await this._getAll('active');
    const query = String(filters.query || '').toUpperCase().trim();
    const vehicleType = filters.vehicleType && filters.vehicleType !== 'all' ? filters.vehicleType : null;
    return sortNewest(all.filter((entry) => {
      if (vehicleType && entry.vehicleType !== vehicleType) return false;
      if (!query) return true;
      return entry.vehicleNumber.includes(query) || entry.serial.includes(query);
    }), 'entryAt');
  }

  async listTransactions(filters = {}) {
    const all = await this._getAll('transactions');
    return this._filterTransactions(all, filters);
  }

  _filterTransactions(all, filters) {
    const from = filters.from || null;
    const to = filters.to || null;
    const vehicleType = filters.vehicleType && filters.vehicleType !== 'all' ? filters.vehicleType : null;
    const paymentState = filters.paymentState || 'all';
    const membership = filters.membership || 'all';
    return sortNewest(all.filter((transaction) => {
      const day = localDay(transaction.checkoutAt);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (vehicleType && transaction.vehicleType !== vehicleType) return false;
      if (paymentState === 'paid' && transaction.dueAmount > 0) return false;
      if (paymentState === 'due' && transaction.dueAmount <= 0) return false;
      if (membership === 'member' && !transaction.membershipId) return false;
      if (membership === 'non-member' && transaction.membershipId) return false;
      return true;
    }), 'checkoutAt');
  }

  async listMemberships(filters = {}) {
    const today = localDay();
    const memberships = await this._getAll('memberships');
    const state = filters.state || 'all';
    return memberships
      .map((membership) => ({ ...membership, derivedStatus: this._membershipStatus(membership, today) }))
      .filter((membership) => state === 'all' || membership.derivedStatus === state)
      .sort((left, right) => String(left.endDate).localeCompare(String(right.endDate)));
  }

  _membershipStatus(membership, dateKey = localDay()) {
    if (!membership.active) return 'inactive';
    if (membership.startDate > dateKey || membership.endDate < dateKey) return 'expired';
    return 'active';
  }

  async _activeMembership(vehicleNumber, vehicleType, dateKey = localDay()) {
    const memberships = await this._getAll('memberships');
    return memberships.find((membership) => (
      membership.vehicleNumber === vehicleNumber
      && membership.vehicleType === vehicleType
      && this._membershipStatus(membership, dateKey) === 'active'
    )) || null;
  }

  async _nextSerial(transaction) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const serialStore = transaction.objectStore('serials');
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const numbers = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(3)) : [Math.random() * 1000, Math.random() * 26, Math.random() * 26];
      const serial = `${String(numbers[0] % 1000).padStart(3, '0')}${characters[numbers[1] % 26]}${characters[numbers[2] % 26]}`;
      const exists = await requestValue(serialStore.get(serial));
      if (!exists) return serial;
    }
    throw new Error('Unable to create a unique parking serial. Please try again.');
  }

  async createEntry(input) {
    const vehicleNumber = validateVehicleNumber(input.vehicleNumber);
    const vehicleType = input.vehicleType;
    const meta = getVehicleMeta(vehicleType);
    const settings = await this.getSettings();
    const now = new Date().toISOString();
    const deviceId = await this._getMeta('deviceId');
    const membership = await this._activeMembership(vehicleNumber, vehicleType, localDay(now));
    const active = await this.listActive({ vehicleType });
    const capacity = asNumber(settings[meta.capacityKey]);
    if (capacity > 0 && active.length >= capacity) throw new Error(`${meta.label} capacity is full. Update capacity in Settings if needed.`);
    const ratePerPeriod = asNumber(settings[meta.rateKey]);
    const entry = await this._transaction(['active', 'serials', 'queue'], 'readwrite', async (transaction) => {
      const activeStore = transaction.objectStore('active');
      const existing = await requestValue(activeStore.index('vehicleNumber').get(vehicleNumber));
      if (existing) throw new Error(`Vehicle ${vehicleNumber} is already marked as parked.`);
      const id = uuid();
      const serial = await this._nextSerial(transaction);
      const record = {
        id,
        serial,
        vehicleNumber,
        vehicleType,
        entryAt: now,
        status: 'parked',
        ratePerPeriod,
        billingPeriodHours: asNumber(settings.billingPeriodHours, 24),
        membershipId: membership?.id || null,
        membershipStatus: membership ? 'active' : 'not-active',
        membershipDiscountPercent: membership ? asNumber(settings.membershipDiscountPercent, 0) : 0,
        deviceId,
        createdAt: now,
        updatedAt: now,
      };
      await requestValue(transaction.objectStore('serials').add({ serial, transactionId: id, reservedAt: now }));
      await requestValue(activeStore.add(record));
      await requestValue(transaction.objectStore('queue').add(this._queueItem('parking.entry', id, record)));
      return record;
    });
    return entry;
  }

  async getCheckoutPreview(id, exitAt = new Date().toISOString()) {
    const entry = await this._get('active', id);
    if (!entry) throw new Error('This vehicle is no longer in active parking.');
    return { ...entry, ...calculateParkingCharge(entry, exitAt), duration: formatDuration(calculateParkingCharge(entry, exitAt).durationMs) };
  }

  async checkout(id, amountPaid, exitAt = new Date().toISOString()) {
    const paid = Math.max(0, Math.round(asNumber(amountPaid, 0)));
    return this._transaction(['active', 'transactions', 'queue'], 'readwrite', async (transaction) => {
      const activeStore = transaction.objectStore('active');
      const entry = await requestValue(activeStore.get(id));
      if (!entry) throw new Error('This vehicle has already been checked out or is unavailable.');
      const charge = calculateParkingCharge(entry, exitAt);
      const transactionRecord = {
        ...entry,
        ...charge,
        status: 'completed',
        checkoutAt: exitAt,
        amountPaid: paid,
        dueAmount: Math.max(0, charge.parkingCharge - paid),
        changeAmount: Math.max(0, paid - charge.parkingCharge),
        updatedAt: exitAt,
      };
      await requestValue(transaction.objectStore('transactions').add(transactionRecord));
      await requestValue(activeStore.delete(id));
      await requestValue(transaction.objectStore('queue').add(this._queueItem('parking.checkout', id, transactionRecord)));
      return transactionRecord;
    });
  }

  async saveMembership(input) {
    const vehicleNumber = validateVehicleNumber(input.vehicleNumber);
    const vehicleType = input.vehicleType;
    getVehicleMeta(vehicleType);
    const startDate = String(input.startDate || '');
    const endDate = String(input.endDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Choose valid membership dates.');
    if (endDate < startDate) throw new Error('Membership end date must be after its start date.');
    const now = new Date().toISOString();
    const existing = input.id ? await this._get('memberships', input.id) : null;
    const membership = {
      id: existing?.id || uuid(),
      vehicleNumber,
      vehicleType,
      startDate,
      endDate,
      amount: Math.max(0, Math.round(asNumber(input.amount, 0))),
      active: Boolean(input.active),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await this._transaction(['memberships', 'queue'], 'readwrite', async (transaction) => {
      await requestValue(transaction.objectStore('memberships').put(membership));
      await requestValue(transaction.objectStore('queue').put(this._queueItem('membership.upsert', membership.id, membership)));
    });
    return membership;
  }

  async updateMembership(input) {
    if (!input.id) throw new Error('Membership to update is required.');
    return this.saveMembership(input);
  }

  async getDashboard() {
    const [settings, active, transactions, memberships] = await Promise.all([
      this.getSettings(), this.listActive(), this._getAll('transactions'), this._getAll('memberships'),
    ]);
    const today = localDay();
    const todayTransactions = transactions.filter((record) => localDay(record.checkoutAt) === today);
    const entriesToday = [...active, ...transactions].filter((record) => localDay(record.entryAt) === today);
    const activeTwo = active.filter((record) => record.vehicleType === 'two-wheeler').length;
    const activeFour = active.filter((record) => record.vehicleType === 'four-wheeler').length;
    const capacity = asNumber(settings.twoWheelerCapacity) + asNumber(settings.fourWheelerCapacity);
    const memberCount = memberships.filter((membership) => this._membershipStatus(membership, today) === 'active').length;
    return {
      activeCount: active.length,
      activeTwo,
      activeFour,
      todayCollection: todayTransactions.reduce((sum, record) => sum + asNumber(record.amountPaid), 0),
      todayExits: todayTransactions.length,
      todayEntries: entriesToday.length,
      todayTwoEntries: entriesToday.filter((record) => record.vehicleType === 'two-wheeler').length,
      todayFourEntries: entriesToday.filter((record) => record.vehicleType === 'four-wheeler').length,
      todayDue: todayTransactions.reduce((sum, record) => sum + asNumber(record.dueAmount), 0),
      outstandingDue: transactions.reduce((sum, record) => sum + asNumber(record.dueAmount), 0),
      membershipCount: memberCount,
      active,
      capacity,
      available: Math.max(0, capacity - active.length),
      occupancy: capacity ? Math.min(100, Math.round((active.length / capacity) * 100)) : 0,
      settings,
    };
  }

  async getStatus(vehicleType) {
    const meta = getVehicleMeta(vehicleType);
    const [settings, active, transactions, memberships] = await Promise.all([
      this.getSettings(), this.listActive({ vehicleType }), this._getAll('transactions'), this._getAll('memberships'),
    ]);
    const today = localDay();
    const typeTransactions = transactions.filter((record) => record.vehicleType === vehicleType);
    const todayTransactions = typeTransactions.filter((record) => localDay(record.checkoutAt) === today);
    const todayEntries = [...active, ...typeTransactions].filter((record) => localDay(record.entryAt) === today);
    const capacity = asNumber(settings[meta.capacityKey]);
    const completedToday = todayTransactions.filter((record) => asNumber(record.durationMs) > 0);
    return {
      vehicleType,
      active,
      capacity,
      available: Math.max(0, capacity - active.length),
      occupancy: capacity ? Math.min(100, Math.round((active.length / capacity) * 100)) : 0,
      todayCollection: todayTransactions.reduce((sum, record) => sum + asNumber(record.amountPaid), 0),
      todayEntries: todayEntries.length,
      todayExits: todayTransactions.length,
      dueAmount: todayTransactions.reduce((sum, record) => sum + asNumber(record.dueAmount), 0),
      activeMemberships: memberships.filter((record) => record.vehicleType === vehicleType && this._membershipStatus(record, today) === 'active').length,
      averageDurationMs: completedToday.length ? completedToday.reduce((sum, record) => sum + asNumber(record.durationMs), 0) / completedToday.length : 0,
      recent: active.slice(0, 8),
    };
  }

  async getReports(filters = {}) {
    const transactions = await this.listTransactions(filters);
    const totalPaid = transactions.reduce((sum, record) => sum + asNumber(record.amountPaid), 0);
    const totalDue = transactions.reduce((sum, record) => sum + asNumber(record.dueAmount), 0);
    const totalCharge = transactions.reduce((sum, record) => sum + asNumber(record.parkingCharge), 0);
    return {
      transactions,
      totalPaid,
      totalDue,
      totalCharge,
      averageTicket: transactions.length ? Math.round(totalPaid / transactions.length) : 0,
    };
  }

  async getSyncStatus() {
    const [queue, lastSyncAt, config] = await Promise.all([this._getAll('queue'), this._getMeta('lastSyncAt'), this.getSyncConfig()]);
    const configured = Boolean(config.endpoint && config.siteId);
    if (!configured) return { mode: 'local', pending: queue.length, lastSyncAt, configured: false };
    if (!config.deviceToken) return { mode: 'activation-needed', pending: queue.length, lastSyncAt, configured: true };
    if (!navigator.onLine) return { mode: 'offline', pending: queue.length, lastSyncAt, configured: true };
    return { mode: 'ready', pending: queue.length, lastSyncAt, configured: true };
  }

  async getSyncConfig() {
    const [stored, runtime] = await Promise.all([
      this._getMeta('syncConfig'),
      Promise.resolve(globalThis.PARKING_SYNC_CONFIG || {}),
    ]);
    return {
      endpoint: String(runtime.endpoint || stored?.endpoint || '').replace(/\/$/, ''),
      siteId: String(runtime.siteId || stored?.siteId || ''),
      deviceToken: String(stored?.deviceToken || runtime.deviceToken || ''),
    };
  }

  async saveSyncConfig(input) {
    const current = await this.getSyncConfig();
    const endpoint = String(input.endpoint ?? current.endpoint).trim().replace(/\/$/, '');
    const siteId = String(input.siteId ?? current.siteId).trim();
    const deviceToken = String(input.deviceToken ?? current.deviceToken).trim();
    if (endpoint && !/^https:\/\//i.test(endpoint)) throw new Error('Sync endpoint must start with https://');
    if ((endpoint || siteId || deviceToken) && (!endpoint || !siteId || !deviceToken)) {
      throw new Error('Enter the sync endpoint, parking stand ID, and device token together.');
    }
    if (deviceToken && deviceToken.length < 32) throw new Error('Enter a valid device token issued by your secure sync service.');
    await this._setMeta('syncConfig', { endpoint, siteId, deviceToken, updatedAt: new Date().toISOString() });
    return { endpoint, siteId, deviceToken };
  }

  async syncNow() {
    const status = await this.getSyncStatus();
    if (!status.configured) return { ...status, message: 'Central sync is not configured. Your data is safely stored on this device.' };
    if (!navigator.onLine) return { ...status, message: 'You are offline. Changes will remain safely queued on this device.' };
    const config = await this.getSyncConfig();
    const deviceId = await this._getMeta('deviceId');
    const deviceToken = config.deviceToken;
    if (!deviceToken) return { ...status, mode: 'activation-needed', message: 'This device has not been enrolled for central sync yet.' };
    const pending = await this._getAll('queue');
    try {
      const response = await fetch(`${String(config.endpoint).replace(/\/$/, '')}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken}` },
        body: JSON.stringify({ siteId: config.siteId, deviceId, operations: pending }),
      });
      if (!response.ok) throw new Error(`Sync service returned ${response.status}.`);
      const payload = await response.json();
      const acknowledged = new Set(payload.acknowledgedOperationIds || pending.map((item) => item.operationId));
      await this._transaction(['queue', 'active', 'transactions', 'memberships', 'settings', 'serials'], 'readwrite', async (transaction) => {
        const queue = transaction.objectStore('queue');
        for (const operation of pending) if (acknowledged.has(operation.operationId)) await requestValue(queue.delete(operation.id));
        const changes = payload.changes || {};
        if (changes.snapshot) {
          // Active parking is a complete current-state snapshot, so records
          // missing from it have been checked out on another device. History,
          // memberships, and serial reservations are merged rather than
          // cleared: this prevents a bounded server response from ever erasing
          // local historical records.
          await requestValue(transaction.objectStore('active').clear());
        }
        for (const record of changes.active || []) await requestValue(transaction.objectStore('active').put(record));
        for (const record of changes.transactions || []) {
          await requestValue(transaction.objectStore('transactions').put(record));
          if (record.serial) await requestValue(transaction.objectStore('serials').put({ serial: record.serial, transactionId: record.id, reservedAt: record.entryAt || record.createdAt }));
        }
        for (const record of changes.memberships || []) await requestValue(transaction.objectStore('memberships').put(record));
        for (const record of changes.active || []) {
          if (record.serial) await requestValue(transaction.objectStore('serials').put({ serial: record.serial, transactionId: record.id, reservedAt: record.entryAt || record.createdAt }));
        }
        if (changes.settings) await requestValue(transaction.objectStore('settings').put(changes.settings));
      });
      const now = new Date().toISOString();
      await this._setMeta('lastSyncAt', now);
      return { mode: 'synced', pending: 0, lastSyncAt: now, configured: true, message: 'Parking data is synced.' };
    } catch (error) {
      return { ...status, mode: 'error', message: `Unable to sync right now. ${error.message} Your changes are safely stored locally.` };
    }
  }
}

export const parkingStore = new ParkingStore();
