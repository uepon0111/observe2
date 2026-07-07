const SETTINGS_KEY = 'prsk-result-viewer.settings.v2';
const UI_KEY = 'prsk-result-viewer.ui.v2';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const memoryStorage = (() => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
})();

function getSafeStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__prsk_storage_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {}
  return memoryStorage;
}

export function loadSettings(defaultSettings) {
  try {
    const raw = getSafeStorage().getItem(SETTINGS_KEY);
    if (!raw) return deepClone(defaultSettings);
    const parsed = JSON.parse(raw);
    return {
      ...deepClone(defaultSettings),
      ...parsed,
      cropRegions: {
        ...deepClone(defaultSettings.cropRegions),
        ...(parsed.cropRegions || {})
      }
    };
  } catch {
    return deepClone(defaultSettings);
  }
}

export function saveSettings(settings) {
  try {
    getSafeStorage().setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export function loadUiState(defaultState) {
  try {
    const raw = getSafeStorage().getItem(UI_KEY);
    if (!raw) return deepClone(defaultState);
    return { ...deepClone(defaultState), ...JSON.parse(raw) };
  } catch {
    return deepClone(defaultState);
  }
}

export function saveUiState(state) {
  try {
    getSafeStorage().setItem(UI_KEY, JSON.stringify(state));
  } catch {}
}
