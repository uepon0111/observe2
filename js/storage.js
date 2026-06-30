import { DEFAULT_SETTINGS, DEFAULT_TEMPLATE } from './constants.js';
import { deepClone, safeJsonParse } from './utils.js';

const DB_NAME = 'prsk-result-viewer-db';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) {
        const store = db.createObjectStore('records', { keyPath: 'id' });
        store.createIndex('deletedAt', 'deletedAt', { unique: false });
        store.createIndex('driveFileId', 'driveFileId', { unique: false });
        store.createIndex('musicId', 'musicId', { unique: false });
      }
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, cb) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = cb(store, tx);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getAllRecords() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readonly');
    const store = tx.objectStore('records');
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).map((row) => deepClone(row)));
    req.onerror = () => reject(req.error);
  });
}

export async function getRecord(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('records', 'readonly').objectStore('records').get(id);
    req.onsuccess = () => resolve(req.result ? deepClone(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

export async function upsertRecord(record) {
  return withStore('records', 'readwrite', (store) => store.put(deepClone(record)));
}

export async function upsertRecords(records) {
  return withStore('records', 'readwrite', (store) => {
    for (const record of records) store.put(deepClone(record));
  });
}

export async function deleteRecord(id) {
  return withStore('records', 'readwrite', (store) => store.delete(id));
}

export async function clearRecords() {
  return withStore('records', 'readwrite', (store) => store.clear());
}

export async function getAllTemplates() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('templates', 'readonly').objectStore('templates').getAll();
    req.onsuccess = () => resolve((req.result || []).map((row) => deepClone(row)));
    req.onerror = () => reject(req.error);
  });
}

export async function getTemplate(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('templates', 'readonly').objectStore('templates').get(id);
    req.onsuccess = () => resolve(req.result ? deepClone(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}

export async function upsertTemplate(template) {
  return withStore('templates', 'readwrite', (store) => store.put(deepClone(template)));
}

export async function deleteTemplate(id) {
  return withStore('templates', 'readwrite', (store) => store.delete(id));
}

export async function seedTemplatesIfEmpty() {
  const all = await getAllTemplates();
  if (all.length === 0) {
    await upsertTemplate(DEFAULT_TEMPLATE);
    return [deepClone(DEFAULT_TEMPLATE)];
  }
  return all;
}

export async function getSettings() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const req = store.get('app');
    req.onsuccess = () => {
      const stored = req.result?.value ? safeJsonParse(req.result.value, null) : null;
      resolve({ ...DEFAULT_SETTINGS, ...(stored || {}) });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveSettings(settings) {
  return withStore('settings', 'readwrite', (store) => store.put({ key: 'app', value: JSON.stringify(settings) }));
}

export async function exportAllData() {
  const [records, templates, settings] = await Promise.all([getAllRecords(), getAllTemplates(), getSettings()]);
  return { records, templates, settings };
}

export async function importAllData(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (Array.isArray(payload.records)) await upsertRecords(payload.records);
  if (Array.isArray(payload.templates)) {
    for (const t of payload.templates) await upsertTemplate(t);
  }
  if (payload.settings && typeof payload.settings === 'object') await saveSettings({ ...DEFAULT_SETTINGS, ...payload.settings });
}

export async function clearAllData() {
  const db = await openDb();
  await Promise.all(['records', 'templates', 'settings'].map((storeName) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  })));
}
