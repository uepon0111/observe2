
window.PrskApp = window.PrskApp || {};

(function (App) {
  const { DEFAULT_SETTINGS, STORAGE_KEYS } = App.CONFIG;

  const state = {
    gapiInited: false,
    gisInited: false,
    tokenClient: null,
    isLoggedIn: false,

    allRecords: [],
    filteredRecords: [],
    selectedIds: new Set(),
    isSelectMode: false,

    editorQueue: [],
    activeItemId: null,
    currentMode: 'upload',

    dbMusics: [],
    dbDiffs: [],

    folderCache: new Map(),
    rootFolderId: null,
    fcFolderId: null,

    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),

    ui: {
      sampleImageUrl: '',
      activeCropRegion: 'diff',
      toasts: [],
    },

    previousBestSnapshot: new Map(),
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (!raw) {
        state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        return state.settings;
      }
      const parsed = JSON.parse(raw);
      state.settings = {
        ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
        ...parsed,
        cropRegions: {
          ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS.cropRegions)),
          ...(parsed.cropRegions || {}),
        },
      };
    } catch (e) {
      console.warn('Failed to load settings', e);
      state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    return state.settings;
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  }

  function loadUiState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ui);
      if (!raw) return state.ui;
      const parsed = JSON.parse(raw);
      state.ui = { ...state.ui, ...parsed };
    } catch (e) {
      console.warn('Failed to load UI state', e);
    }
    return state.ui;
  }

  function saveUiState() {
    localStorage.setItem(STORAGE_KEYS.ui, JSON.stringify({
      activeCropRegion: state.ui.activeCropRegion,
      // sampleImageUrl is session-only and intentionally not persisted
    }));
  }

  function q(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    const el = q(id);
    if (el) el.innerText = text;
  }

  function setHtml(id, html) {
    const el = q(id);
    if (el) el.innerHTML = html;
  }

  function show(id, display = 'block') {
    const el = q(id);
    if (el) el.style.display = display;
  }

  function hide(id) {
    const el = q(id);
    if (el) el.style.display = 'none';
  }

  function getSetting(path, fallback = null) {
    const parts = path.split('.');
    let cur = state.settings;
    for (const part of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, part)) cur = cur[part];
      else return fallback;
    }
    return cur ?? fallback;
  }

  function setSetting(path, value) {
    const parts = path.split('.');
    let cur = state.settings;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
    saveSettings();
  }

  function setUi(path, value) {
    const parts = path.split('.');
    let cur = state.ui;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
    saveUiState();
  }

  function revokeAllEditorObjectUrls() {
    for (const item of state.editorQueue) {
      if (item?.imgUrl && item?.file instanceof File) {
        try { URL.revokeObjectURL(item.imgUrl); } catch (_) {}
      }
    }
  }

  App.state = state;
  App.loadSettings = loadSettings;
  App.saveSettings = saveSettings;
  App.loadUiState = loadUiState;
  App.saveUiState = saveUiState;
  App.getSetting = getSetting;
  App.setSetting = setSetting;
  App.setUi = setUi;
  App.revokeAllEditorObjectUrls = revokeAllEditorObjectUrls;
  App.q = q;
  App.setText = setText;
  App.setHtml = setHtml;
  App.show = show;
  App.hide = hide;
})(window.PrskApp);
