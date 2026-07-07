
window.PRSK = window.PRSK || {};
const PRSK = window.PRSK;

PRSK.CONFIG = {
  CLIENT_ID: '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com',
  API_KEY: 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0',
  DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
  SCOPES: 'https://www.googleapis.com/auth/drive',
  ROOT_FOLDER_NAME: 'prsk-result-viewer',
  DATA_FOLDER_NAME: 'results',
  SETTINGS_KEY: 'prsk-result-viewer-settings-v2'
};

PRSK.DIFFS = {
  append: { label: 'APPEND', rank: 6 },
  master: { label: 'MASTER', rank: 5 },
  expert: { label: 'EXPERT', rank: 4 },
  hard:   { label: 'HARD',   rank: 3 },
  normal: { label: 'NORMAL', rank: 2 },
  easy:   { label: 'EASY',   rank: 1 }
};

PRSK.DEFAULT_SETTINGS = {
  notifyBest: true,
  crop: {
    diff:   { x: 0.20, y: 0.07, w: 0.10, h: 0.04, mode: 'threshold-diff' },
    title:  { x: 0.19, y: 0.01, w: 0.32, h: 0.05, mode: 'filter-standard' },
    miss:   { x: 0.10, y: 0.55, w: 0.20, h: 0.28, mode: 'filter-standard' }
  }
};

PRSK.state = {
  tokenClient: null,
  gapiInited: false,
  gisInited: false,
  dbMusics: [],
  dbDiffs: [],
  allRecords: [],
  filteredRecords: [],
  isSelectMode: false,
  selectedIds: new Set(),
  currentMode: 'upload',
  editorQueue: [],
  activeItemId: null,
  driveRootFolder: null,
  driveDataFolder: null,
  settings: loadSettings(),
  sampleImageUrl: ''
};

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(PRSK.CONFIG.SETTINGS_KEY);
    if (!raw) return structuredClone(PRSK.DEFAULT_SETTINGS);
    return mergeSettings(JSON.parse(raw));
  } catch (e) {
    console.warn('settings load failed', e);
    return structuredClone(PRSK.DEFAULT_SETTINGS);
  }
}
function mergeSettings(partial) {
  const base = structuredClone(PRSK.DEFAULT_SETTINGS);
  if (!partial || typeof partial !== 'object') return base;
  base.notifyBest = typeof partial.notifyBest === 'boolean' ? partial.notifyBest : base.notifyBest;
  for (const key of Object.keys(base.crop)) {
    if (partial.crop && partial.crop[key]) {
      const src = partial.crop[key];
      base.crop[key] = {
        x: clamp01(num(src.x, base.crop[key].x)),
        y: clamp01(num(src.y, base.crop[key].y)),
        w: clamp01(num(src.w, base.crop[key].w)),
        h: clamp01(num(src.h, base.crop[key].h)),
        mode: src.mode || base.crop[key].mode
      };
    }
  }
  return base;
}
function saveSettings() {
  localStorage.setItem(PRSK.CONFIG.SETTINGS_KEY, JSON.stringify(PRSK.state.settings));
}
function normalizeString(str) {
  if (!str) return '';
  return str.toString()
    .normalize('NFKC')
    .replace(/[\s\-_]/g, '')
    .toLowerCase();
}
function escapeHtml(t) {
  return t ? t.toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])) : '';
}
function sanitizeFileName(name) {
  return (name || '')
    .replace(/[\\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'result';
}
function recordKey(data) {
  return [
    normalizeString(data.musicId || ''),
    normalizeString(data.title || ''),
    String(data.level || ''),
    normalizeString(data.diff || data.difficultyRaw || '')
  ].join('|');
}
function bestKeyFromRecord(rec) {
  return recordKey({
    musicId: rec.musicId || '',
    title: rec.title || '',
    level: rec.level || '',
    diff: rec.difficultyRaw || rec.diff || ''
  });
}
function getBestRecordForKey(target, ignoreId = null) {
  const key = recordKey(target);
  const candidates = PRSK.state.allRecords.filter(r => bestKeyFromRecord(r) === key && r.id !== ignoreId);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) => (best.missCount < cur.missCount ? best : cur));
}
function getBestMissForKey(target, ignoreId = null) {
  const best = getBestRecordForKey(target, ignoreId);
  return best ? best.missCount : null;
}
function recordDisplayDiff(diff) {
  return (PRSK.DIFFS[diff] && PRSK.DIFFS[diff].label) ? PRSK.DIFFS[diff].label : String(diff || '').toUpperCase();
}
function showToast(title, body = '', type = 'info', timeout = 3200) {
  const box = document.getElementById('toast-container');
  if (!box) return;
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div>${body ? `<div class="toast-body">${escapeHtml(body)}</div>` : ''}`;
  box.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'all .25s ease';
    setTimeout(() => node.remove(), 260);
  }, timeout);
}
async function notifyBestUpdate(detail) {
  const { title, level, diff, previousBest, currentMiss } = detail;
  const message = previousBest == null
    ? `初記録: ${currentMiss}`
    : `更新: ${previousBest} → ${currentMiss}`;
  showToast('自己ベスト更新', `${title} / Lv.${level} / ${recordDisplayDiff(diff)} ${message}`, 'success', 4200);

  if (!PRSK.state.settings.notifyBest || !('Notification' in window)) return;
  try {
    if (Notification.permission === 'granted') {
      new Notification('自己ベスト更新', {
        body: `${title} / Lv.${level} / ${recordDisplayDiff(diff)} ${message}`
      });
    }
  } catch (e) {
    console.warn('notification failed', e);
  }
}
function makeFileName(data) {
  const base = sanitizeFileName(`${data.title} ${data.level} ${recordDisplayDiff(data.diff)}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
  return `${stamp}__${base}__FC-${data.totalMiss}`;
}
function makeFileDescription(data) {
  return JSON.stringify({
    schema: 2,
    title: data.title,
    level: num(data.level, 0),
    diff: data.diff,
    good: num(data.good, 0),
    bad: num(data.bad, 0),
    missDetail: num(data.missDetail, 0),
    totalMiss: num(data.totalMiss, 0),
    musicId: data.musicId || null,
    updatedAt: new Date().toISOString()
  });
}
window.PRSK_UTILS = {
  num, clamp01, clamp, normalizeString, escapeHtml, sanitizeFileName,
  recordKey, bestKeyFromRecord, getBestRecordForKey, getBestMissForKey,
  recordDisplayDiff, showToast, notifyBestUpdate, makeFileName, makeFileDescription,
  loadSettings, saveSettings, mergeSettings
};
