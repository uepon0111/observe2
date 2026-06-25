
import { createId } from './utils.js';

const DB_NAME = 'sekai-result-archive';
const DB_VERSION = 1;

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('records')) {
        const store = db.createObjectStore('records', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('trashedAt', 'trashedAt', { unique: false });
        store.createIndex('songKey', 'songKey', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore(storeName, mode, handler) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = handler(store, tx);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadRecords() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readonly');
    const store = tx.objectStore('records');
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result || []).map((record) => ({
      ...record,
      difficultyFilters: undefined,
    })));
    request.onerror = () => reject(request.error);
  });
}

export async function getRecord(id) {
  return withStore('records', 'readonly', (store) => new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  }));
}

export async function saveRecord(record) {
  const now = Date.now();
  const toSave = {
    id: record.id || createId('record'),
    createdAt: record.createdAt || now,
    updatedAt: now,
    ...record,
  };
  await withStore('records', 'readwrite', (store) => store.put(toSave));
  return toSave;
}

export async function saveRecords(records) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    for (const record of records) {
      store.put(record);
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteRecord(id) {
  await withStore('records', 'readwrite', (store) => store.delete(id));
}

export async function clearAllRecords() {
  await withStore('records', 'readwrite', (store) => store.clear());
}

export async function loadSetting(key, fallback = null) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ? request.result.value : fallback);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSetting(key, value) {
  await withStore('settings', 'readwrite', (store) => store.put({ key, value }));
  return value;
}

export async function deleteSetting(key) {
  await withStore('settings', 'readwrite', (store) => store.delete(key));
}

export async function loadAllSettings() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.getAll();
    request.onsuccess = () => {
      const out = {};
      for (const row of request.result || []) out[row.key] = row.value;
      resolve(out);
    };
    request.onerror = () => reject(request.error);
  });
}
