const DB_NAME = 'prosekai-result-library';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) {
        const records = db.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('trashedAt', 'trashedAt', { unique: false });
        records.createIndex('createdAt', 'createdAt', { unique: false });
        records.createIndex('musicId', 'musicId', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('profiles')) {
        db.createObjectStore('profiles', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, handler) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = handler(store, tx);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export const db = {
  async getAllRecords() {
    const dbi = await openDb();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction('records', 'readonly');
      const req = tx.objectStore('records').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  async putRecord(record) {
    return withStore('records', 'readwrite', (store) => store.put(record));
  },
  async deleteRecord(id) {
    return withStore('records', 'readwrite', (store) => store.delete(id));
  },
  async getRecord(id) {
    const dbi = await openDb();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction('records', 'readonly');
      const req = tx.objectStore('records').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async getSettings() {
    const dbi = await openDb();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction('settings', 'readonly');
      const req = tx.objectStore('settings').getAll();
      req.onsuccess = () => {
        const out = {};
        for (const row of req.result || []) out[row.key] = row.value;
        resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  },
  async setSetting(key, value) {
    return withStore('settings', 'readwrite', (store) => store.put({ key, value }));
  },
  async setSettings(values = {}) {
    const dbi = await openDb();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      for (const [key, value] of Object.entries(values)) store.put({ key, value });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },
  async getProfiles() {
    const dbi = await openDb();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction('profiles', 'readonly');
      const req = tx.objectStore('profiles').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  async putProfile(profile) {
    return withStore('profiles', 'readwrite', (store) => store.put(profile));
  },
  async deleteProfile(id) {
    return withStore('profiles', 'readwrite', (store) => store.delete(id));
  },
  async clearRecords() {
    return withStore('records', 'readwrite', (store) => store.clear());
  },
};
