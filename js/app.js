import { db } from './db.js';
import { loadMasterData } from './data.js';
import { DriveClient } from './drive.js';
import { analyzeResultImage } from './ocr.js';
import { icon } from './icons.js';
import {
  DIFFICULTIES,
  DIFFICULTY_COLOR,
  DIFFICULTY_ORDER,
  basisAchieved,
  basisMissCount,
  clampRegion,
  compareDifficulty,
  compareString,
  copy,
  createId,
  downloadBlob,
  formatDateOnly,
  formatNumber,
  formatRelativeDays,
  formatShortDateTime,
  groupKey,
  normalizeSearch,
  parseLevelRange,
  parseNumber,
  sanitizeFilename,
  withinRange,
} from './utils.js';

const els = {
  fileInput: document.getElementById('fileInput'),
  dropzone: document.getElementById('dropzone'),
  registerModeSelect: document.getElementById('registerModeSelect'),
  driveUploadSelect: document.getElementById('driveUploadSelect'),
  queryInput: document.getElementById('queryInput'),
  levelQueryInput: document.getElementById('levelQueryInput'),
  difficultyChips: document.getElementById('difficultyChips'),
  difficultySelect: document.getElementById('difficultySelect'),
  sortKeySelect: document.getElementById('sortKeySelect'),
  sortDirSelect: document.getElementById('sortDirSelect'),
  missBasisSelect: document.getElementById('missBasisSelect'),
  viewBasisSelect: document.getElementById('viewBasisSelect'),
  apMissMin: document.getElementById('apMissMin'),
  apMissMax: document.getElementById('apMissMax'),
  fcMissMin: document.getElementById('fcMissMin'),
  fcMissMax: document.getElementById('fcMissMax'),
  countLabel: document.getElementById('countLabel'),
  trashCountLabel: document.getElementById('trashCountLabel'),
  notifyLabel: document.getElementById('notifyLabel'),
  resetFiltersBtn: document.getElementById('resetFiltersBtn'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  settingsDialog: document.getElementById('settingsDialog'),
  connectDriveBtn: document.getElementById('connectDriveBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  googleClientIdInput: document.getElementById('googleClientIdInput'),
  googleApiKeyInput: document.getElementById('googleApiKeyInput'),
  googleFolderIdInput: document.getElementById('googleFolderIdInput'),
  enableNotificationsInput: document.getElementById('enableNotificationsInput'),
  showOnlyBestByDefaultInput: document.getElementById('showOnlyBestByDefaultInput'),
  persistExpandInput: document.getElementById('persistExpandInput'),
  openCalibrateBtn: document.getElementById('openCalibrateBtn'),
  calibrateDialog: document.getElementById('calibrateDialog'),
  closeCalibrateBtn: document.getElementById('closeCalibrateBtn'),
  profileSelect: document.getElementById('profileSelect'),
  newProfileBtn: document.getElementById('newProfileBtn'),
  profileNameInput: document.getElementById('profileNameInput'),
  profileNoteInput: document.getElementById('profileNoteInput'),
  sampleImageInput: document.getElementById('sampleImageInput'),
  samplePreview: document.getElementById('samplePreview'),
  previewFrame: document.getElementById('previewFrame'),
  overlayBoxes: document.getElementById('overlayBoxes'),
  regionEditor: document.getElementById('regionEditor'),
  saveProfileBtn: document.getElementById('saveProfileBtn'),
  deleteProfileBtn: document.getElementById('deleteProfileBtn'),
  listViewport: document.getElementById('listViewport'),
  emptyState: document.getElementById('emptyState'),
  recordDialog: document.getElementById('recordDialog'),
  recordForm: document.getElementById('recordForm'),
  recordPreview: document.getElementById('recordPreview'),
  recordStatusPill: document.getElementById('recordStatusPill'),
  editTitle: document.getElementById('editTitle'),
  editPronunciation: document.getElementById('editPronunciation'),
  editMusicId: document.getElementById('editMusicId'),
  editLevel: document.getElementById('editLevel'),
  editDifficulty: document.getElementById('editDifficulty'),
  editPerfect: document.getElementById('editPerfect'),
  editGreat: document.getElementById('editGreat'),
  editGood: document.getElementById('editGood'),
  editBad: document.getElementById('editBad'),
  editMiss: document.getElementById('editMiss'),
  editCombo: document.getElementById('editCombo'),
  editMemo: document.getElementById('editMemo'),
  trashRecordBtn: document.getElementById('trashRecordBtn'),
  deleteNowRecordBtn: document.getElementById('deleteNowRecordBtn'),
  closeViewerBtn: document.getElementById('closeViewerBtn'),
  viewerDialog: document.getElementById('viewerDialog'),
  viewerImage: document.getElementById('viewerImage'),
  viewerCaption: document.getElementById('viewerCaption'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  driveStatusBadge: document.getElementById('driveStatusBadge'),
  toastRoot: document.getElementById('toastRoot'),
  listTabs: [...document.querySelectorAll('[data-list-tab]')],
};

const DEFAULT_SETTINGS = {
  googleClientId: '',
  googleApiKey: '',
  googleFolderId: '',
  enableNotifications: true,
  showOnlyBestByDefault: false,
  persistExpand: false,
  activeProfileId: '',
  registerMode: 'auto',
  driveUpload: 'ask',
  listTab: 'library',
  filterBest: 'all',
  judgeFilter: 'all',
  sortKey: 'added',
  sortDir: 'desc',
  missBasis: 'ap',
  viewBasis: 'ap',
  difficulty: 'all',
  query: '',
  levelQuery: '',
  apMissMin: '',
  apMissMax: '',
  fcMissMin: '',
  fcMissMax: '',
};

const DEFAULT_PROFILE = {
  id: 'profile-default',
  name: '標準端末',
  note: '16:9向けの基準プロファイル',
  sampleDataUrl: '',
  regions: {
    title: { x: 6, y: 8, w: 38, h: 15 },
    levelDifficulty: { x: 54, y: 5, w: 36, h: 12 },
    result: { x: 7, y: 35, w: 48, h: 38 },
    combo: { x: 39, y: 40, w: 22, h: 15 },
  },
};

const state = {
  master: null,
  records: [],
  trash: [],
  settings: { ...DEFAULT_SETTINGS },
  profiles: [],
  activeProfileId: DEFAULT_PROFILE.id,
  selectedRecordId: null,
  viewerUrl: '',
  previewUrl: '',
  profilePreviewUrl: '',
  currentDraft: null,
  currentTab: 'library',
  drive: new DriveClient(),
  pendingDriveDeletes: [],
  loading: false,
  needsRender: true,
  visibleItems: [],
  scrollTop: 0,
  cardHeight: 164,
};

let renderScheduled = false;
let profileRegionCache = new Map();
let autoCleanupTimer = null;
const imageUrlCache = new WeakMap();
let viewerClosing = false;

function toast(title, message, type = 'info', timeout = 4600) {
  const node = document.createElement('div');
  node.className = `toast ${type === 'success' ? 'success' : type === 'warning' ? 'warning' : type === 'error' ? 'error' : ''}`.trim();
  node.innerHTML = `
    <div class="toast-icon">${icon(type === 'success' ? 'check' : type === 'warning' ? 'warn' : 'info')}</div>
    <div><strong>${title}</strong><p>${message}</p></div>
  `;
  state.toastRoot.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = '180ms ease';
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

function setButtonActive(buttons, predicate) {
  buttons.forEach((btn) => {
    btn.classList.toggle('active', predicate(btn));
  });
}

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderApp();
  });
}

function getDifficultyLabel(key) {
  return DIFFICULTIES.find((d) => d.key === key)?.key || key || 'EXPERT';
}

function getProfile() {
  return state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0] || DEFAULT_PROFILE;
}

function newProfileTemplate() {
  return {
    id: createId('profile'),
    name: '新しい機種',
    note: '',
    sampleDataUrl: '',
    regions: copy(DEFAULT_PROFILE.regions),
  };
}

function getRecordImageUrl(record) {
  if (!record?.imageBlob) return '';
  if (!imageUrlCache.has(record)) imageUrlCache.set(record, URL.createObjectURL(record.imageBlob));
  return imageUrlCache.get(record);
}

function makeRecordFromAnalysis(analysis, imageBlob, extra = {}) {
  const createdAt = Date.now();
  const record = {
    id: createId('record'),
    createdAt,
    updatedAt: createdAt,
    trashedAt: null,
    title: analysis.title || '',
    pronunciation: analysis.pronunciation || '',
    musicId: String(analysis.musicId || ''),
    playLevel: parseNumber(analysis.playLevel, null),
    difficulty: analysis.difficulty || 'EXPERT',
    totalNoteCount: parseNumber(analysis.totalNoteCount, null),
    perfect: Number(analysis.perfect || 0),
    great: Number(analysis.great || 0),
    good: Number(analysis.good || 0),
    bad: Number(analysis.bad || 0),
    miss: Number(analysis.miss || 0),
    combo: Number(analysis.combo || 0),
    missAP: Number(analysis.missAP || 0),
    missContest: Number(analysis.missContest || 0),
    missFC: Number(analysis.missFC || 0),
    apAchieved: Boolean(analysis.apAchieved),
    fcAchieved: Boolean(analysis.fcAchieved),
    memo: extra.memo || '',
    sourceName: extra.sourceName || '',
    imageBlob,
    imageType: imageBlob.type || 'image/png',
    driveFileId: '',
    driveWebViewLink: '',
    cropProfileId: analysis.cropProfile || state.activeProfileId || DEFAULT_PROFILE.id,
    needsManualCheck: Boolean(analysis.needsManualCheck),
    ocr: analysis.ocr || {},
  };
  return record;
}

async function loadInitialData() {
  state.settings = { ...DEFAULT_SETTINGS, ...(await db.getSettings()) };
  state.settings.filterBest = state.settings.filterBest || (state.settings.showOnlyBestByDefault ? 'ap' : 'all');
  state.settings.judgeFilter = state.settings.judgeFilter || 'all';
  state.settings.difficulty = state.settings.difficulty || 'all';
  state.settings.sortKey = state.settings.sortKey || 'added';
  state.settings.sortDir = state.settings.sortDir || 'desc';
  state.settings.missBasis = state.settings.missBasis || 'ap';
  state.settings.viewBasis = state.settings.viewBasis || 'ap';
  state.profiles = await db.getProfiles();
  if (!state.profiles.length) state.profiles = [copy(DEFAULT_PROFILE)];
  if (!state.profiles.some((p) => p.id === state.settings.activeProfileId)) {
    state.settings.activeProfileId = state.profiles[0].id;
  }
  state.activeProfileId = state.settings.activeProfileId || state.profiles[0].id;
  state.records = (await db.getAllRecords()).filter((record) => !record.trashedAt);
  state.trash = (await db.getAllRecords()).filter((record) => record.trashedAt);
  state.pendingDriveDeletes = Array.isArray(state.settings.pendingDriveDeletes) ? state.settings.pendingDriveDeletes : [];
  try {
    state.master = await loadMasterData();
  } catch (error) {
    console.warn(error);
    toast('楽曲DBの読み込みに失敗', '検索候補は後から再読み込みできます。', 'warning', 6500);
    state.master = {
      songs: [],
      songById: new Map(),
      difficulties: [],
      difficultyMap: new Map(),
      titles: [],
      findSongByTitle() { return null; },
      findBestDifficulty() { return null; },
      findSongById() { return null; },
    };
  }
  await cleanupTrash();
  await syncDriveDeletes();
}

async function saveSettingsToDb() {
  const payload = {
    ...state.settings,
    activeProfileId: state.activeProfileId,
    pendingDriveDeletes: state.pendingDriveDeletes,
  };
  await db.setSettings(payload);
}

async function syncDriveDeletes() {
  if (!state.pendingDriveDeletes.length || !state.drive.isConnected()) return;
  const queue = [...state.pendingDriveDeletes];
  const remaining = [];
  for (const fileId of queue) {
    try {
      await state.drive.deleteFile(fileId);
    } catch {
      remaining.push(fileId);
    }
  }
  state.pendingDriveDeletes = remaining;
  if (remaining.length !== queue.length) await saveSettingsToDb();
}

async function cleanupTrash() {
  const now = Date.now();
  const keep = [];
  const purged = [];
  for (const record of state.trash) {
    const expired = record.trashedAt && now - record.trashedAt >= 3 * 24 * 60 * 60 * 1000;
    if (expired) purged.push(record);
    else keep.push(record);
  }
  if (!purged.length) return;
  for (const record of purged) {
    if (record.driveFileId) state.pendingDriveDeletes.push(record.driveFileId);
    await db.deleteRecord(record.id);
  }
  state.trash = keep;
  await saveSettingsToDb();
  await syncDriveDeletes();
  toast('期限切れを削除', `${purged.length}件をゴミ箱から完全削除しました。`, 'success');
}

function currentBestByBasis(records, basis) {
  const best = new Map();
  for (const record of records) {
    const key = groupKey(record);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, record);
      continue;
    }
    const currentMiss = basisMissCount(record, basis);
    const prevMiss = basisMissCount(prev, basis);
    if (currentMiss < prevMiss) best.set(key, record);
    else if (currentMiss === prevMiss) {
      const contestCurrent = record.missContest ?? 0;
      const contestPrev = prev.missContest ?? 0;
      if (contestCurrent < contestPrev) best.set(key, record);
      else if (contestCurrent === contestPrev) {
        if ((record.perfect ?? 0) > (prev.perfect ?? 0)) best.set(key, record);
        else if ((record.perfect ?? 0) === (prev.perfect ?? 0) && (record.combo ?? 0) > (prev.combo ?? 0)) best.set(key, record);
      }
    }
  }
  return [...best.values()];
}

function filterRecords(records) {
  const settings = state.settings;
  let list = [...records];
  if (state.currentTab === 'library') {
    if (settings.judgeFilter === 'ap') list = list.filter((record) => record.apAchieved);
    if (settings.judgeFilter === 'fc') list = list.filter((record) => record.fcAchieved);
  }
  const query = normalizeSearch(settings.query || '');
  if (query) {
    list = list.filter((record) => {
      const searchText = normalizeSearch(`${record.title} ${record.pronunciation} ${record.musicId}`);
      return searchText.includes(query);
    });
  }
  const levelRange = parseLevelRange(settings.levelQuery);
  if (levelRange) {
    list = list.filter((record) => withinRange(Number(record.playLevel), levelRange.min, levelRange.max));
  }
  if (settings.difficulty !== 'all') {
    list = list.filter((record) => record.difficulty === settings.difficulty);
  }
  if (settings.apMissMin !== '' || settings.apMissMax !== '') {
    list = list.filter((record) => withinRange(Number(record.missAP), settings.apMissMin === '' ? null : Number(settings.apMissMin), settings.apMissMax === '' ? null : Number(settings.apMissMax)));
  }
  if (settings.fcMissMin !== '' || settings.fcMissMax !== '') {
    list = list.filter((record) => withinRange(Number(record.missFC), settings.fcMissMin === '' ? null : Number(settings.fcMissMin), settings.fcMissMax === '' ? null : Number(settings.fcMissMax)));
  }
  if (state.currentTab === 'library') {
    if (settings.filterBest === 'ap') list = currentBestByBasis(list, 'ap');
    if (settings.filterBest === 'fc') list = currentBestByBasis(list, 'fc');
  }
  return sortRecords(list);
}

function sortRecords(list) {
  const { sortKey, sortDir, missBasis } = state.settings;
  const dir = sortDir === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    const nameA = a.title || '';
    const nameB = b.title || '';
    const levelA = Number(a.playLevel ?? 0);
    const levelB = Number(b.playLevel ?? 0);
    const missA = basisMissCount(a, missBasis);
    const missB = basisMissCount(b, missBasis);
    const addedA = a.createdAt ?? 0;
    const addedB = b.createdAt ?? 0;
    const diffA = DIFFICULTY_ORDER[a.difficulty] ?? 99;
    const diffB = DIFFICULTY_ORDER[b.difficulty] ?? 99;

    const comparePrimary = {
      name: compareString(nameA, nameB),
      level: levelA - levelB,
      miss: missA - missB,
      added: addedA - addedB,
    }[sortKey] || 0;
    if (comparePrimary !== 0) return comparePrimary * dir;

    if (sortKey === 'name') {
      if (diffA !== diffB) return diffA - diffB;
      if (missA !== missB) return missA - missB;
      return addedB - addedA;
    }
    if (sortKey === 'level') {
      if (diffA !== diffB) return diffA - diffB;
      if (compareString(nameA, nameB) !== 0) return compareString(nameA, nameB);
      if (missA !== missB) return missA - missB;
      return addedB - addedA;
    }
    if (sortKey === 'miss') {
      if (levelA !== levelB) return levelA - levelB;
      if (diffA !== diffB) return diffA - diffB;
      if (compareString(nameA, nameB) !== 0) return compareString(nameA, nameB);
      return addedB - addedA;
    }
    return 0;
  });
}

function updateFilterStateFromControls() {
  state.settings.query = els.queryInput.value.trim();
  state.settings.levelQuery = els.levelQueryInput.value.trim();
  state.settings.difficulty = els.difficultySelect.value;
  state.settings.sortKey = els.sortKeySelect.value;
  state.settings.sortDir = els.sortDirSelect.value;
  state.settings.missBasis = els.missBasisSelect.value;
  state.settings.viewBasis = els.viewBasisSelect.value;
  state.settings.apMissMin = els.apMissMin.value.trim();
  state.settings.apMissMax = els.apMissMax.value.trim();
  state.settings.fcMissMin = els.fcMissMin.value.trim();
  state.settings.fcMissMax = els.fcMissMax.value.trim();
}

function updateControlsFromState() {
  els.registerModeSelect.value = state.settings.registerMode;
  els.driveUploadSelect.value = state.settings.driveUpload;
  els.queryInput.value = state.settings.query || '';
  els.levelQueryInput.value = state.settings.levelQuery || '';
  els.difficultySelect.value = state.settings.difficulty || 'all';
  els.sortKeySelect.value = state.settings.sortKey || 'added';
  els.sortDirSelect.value = state.settings.sortDir || 'desc';
  els.missBasisSelect.value = state.settings.missBasis || 'ap';
  els.viewBasisSelect.value = state.settings.viewBasis || 'ap';
  els.apMissMin.value = state.settings.apMissMin || '';
  els.apMissMax.value = state.settings.apMissMax || '';
  els.fcMissMin.value = state.settings.fcMissMin || '';
  els.fcMissMax.value = state.settings.fcMissMax || '';
  els.enableNotificationsInput.checked = Boolean(state.settings.enableNotifications);
  els.showOnlyBestByDefaultInput.checked = Boolean(state.settings.showOnlyBestByDefault);
  els.persistExpandInput.checked = Boolean(state.settings.persistExpand);
  els.googleClientIdInput.value = state.settings.googleClientId || '';
  els.googleApiKeyInput.value = state.settings.googleApiKey || '';
  els.googleFolderIdInput.value = state.settings.googleFolderId || '';
  state.currentTab = state.settings.listTab || 'library';
  state.settings.filterBest = state.settings.showOnlyBestByDefault ? state.settings.filterBest : state.settings.filterBest || 'all';
  els.listTabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.listTab === state.currentTab));
  setButtonActive([...document.querySelectorAll('[data-filter-best]')], (btn) => btn.dataset.filterBest === (state.settings.filterBest || 'all'));
  setButtonActive([...document.querySelectorAll('[data-judge-filter]')], (btn) => btn.dataset.judgeFilter === (state.settings.judgeFilter || 'all'));
  els.notifyLabel.textContent = state.settings.enableNotifications ? 'ON' : 'OFF';
}

function renderDifficultyChips() {
  els.difficultyChips.innerHTML = DIFFICULTIES.map((diff) => `
    <button class="chip" type="button" data-difficulty="${diff.key}" data-active="${state.settings.difficulty === diff.key}">
      <span style="display:inline-flex;align-items:center;gap:8px;">
        <span style="width:10px;height:10px;border-radius:999px;background:${DIFFICULTY_COLOR[diff.key]}"></span>
        ${diff.key}
      </span>
    </button>
  `).join('');
}

function getVisibleMetrics(list) {
  const visible = state.currentTab === 'library' ? list.filter((record) => !record.trashedAt) : state.trash;
  return visible;
}

function getCardHeight() {
  return window.innerWidth <= 780 ? 228 : 164;
}

function renderList() {
  const list = filterRecords(state.currentTab === 'library' ? state.records : state.trash);
  const total = list.length;
  const itemHeight = getCardHeight();
  const gap = 12;
  const viewport = els.listViewport;
  const viewportHeight = viewport.clientHeight || 600;
  const scrollTop = viewport.scrollTop || 0;
  const perItem = itemHeight + gap;
  const start = Math.max(0, Math.floor(scrollTop / perItem) - 3);
  const visibleCount = Math.ceil(viewportHeight / perItem) + 6;
  const end = Math.min(total, start + visibleCount);
  const visible = list.slice(start, end);

  viewport.innerHTML = '';
  const inner = document.createElement('div');
  inner.className = 'list-inner';
  inner.style.height = `${total * perItem}px`;

  for (let idx = 0; idx < visible.length; idx++) {
    const record = visible[idx];
    const item = renderRecordCard(record, start + idx, itemHeight);
    inner.appendChild(item);
  }
  viewport.appendChild(inner);
  els.emptyState.classList.toggle('hidden', total > 0);
  els.countLabel.textContent = String(total);
  els.trashCountLabel.textContent = String(state.trash.length);
  els.driveStatusBadge.textContent = state.drive.isConnected() ? '接続済み' : '未接続';
  els.driveStatusBadge.style.background = state.drive.isConnected() ? '#ecfdf5' : '#eef3ff';
  els.driveStatusBadge.style.color = state.drive.isConnected() ? '#087f5b' : '#3558ca';
}

function renderRecordCard(record, index, itemHeight) {
  const card = document.createElement('article');
  card.className = 'record-card';
  card.style.top = `${index * (itemHeight + 12)}px`;
  card.style.height = `${itemHeight}px`;
  card.dataset.id = record.id;
  const viewBasis = state.settings.viewBasis || 'ap';
  const missValue = basisMissCount(record, viewBasis);
  const apLabel = record.apAchieved ? 'AP済み' : 'AP未達';
  const fcLabel = record.fcAchieved ? 'FC済み' : 'FC未達';
  const title = record.title || '無題';
  const diffColor = DIFFICULTY_COLOR[record.difficulty] || '#64748b';
  const dateLabel = formatShortDateTime(record.createdAt);
  const statusLabel = record.trashedAt ? `ゴミ箱 ${formatRelativeDays(record.trashedAt)}` : `${record.needsManualCheck ? '要確認' : '登録済み'}`;
  card.innerHTML = `
    <div class="thumb" data-action="preview" title="画像を拡大表示">
      ${record.imageBlob ? `<img alt="${title}" src="${getRecordImageUrl(record)}">` : `<div class="thumb-placeholder">${icon('image')}</div>`}
    </div>
    <div class="card-main">
      <div class="card-head">
        <div>
          <div class="song-title">${title}</div>
          <div class="song-sub">
            <span>Lv.${record.playLevel ?? '-'}</span>
            <span>${record.difficulty}</span>
            <span>ID ${record.musicId || '-'}</span>
            <span>${dateLabel}</span>
          </div>
        </div>
        <span class="difficulty-badge" style="background:${diffColor}">${record.difficulty}</span>
      </div>
      <div class="card-meta">
        <span class="pill">${statusLabel}</span>
        <span class="pill gray">${viewBasis === 'fc' ? 'FC' : viewBasis === 'contest' ? '大会基準' : 'AP'}: ${formatNumber(missValue)}</span>
        <span class="pill green">${apLabel}</span>
        <span class="pill ${record.fcAchieved ? 'green' : 'gray'}">${fcLabel}</span>
        <span class="pill gray">総ノーツ ${formatNumber(record.totalNoteCount ?? (record.perfect + record.great + record.good + record.bad + record.miss))}</span>
      </div>
      <div class="stat-grid">
        <div class="stat"><span>PERFECT</span><strong>${formatNumber(record.perfect)}</strong></div>
        <div class="stat"><span>GREAT</span><strong>${formatNumber(record.great)}</strong></div>
        <div class="stat"><span>GOOD</span><strong>${formatNumber(record.good)}</strong></div>
        <div class="stat"><span>BAD</span><strong>${formatNumber(record.bad)}</strong></div>
        <div class="stat"><span>MISS</span><strong>${formatNumber(record.miss)}</strong></div>
        <div class="stat"><span>COMBO</span><strong>${formatNumber(record.combo)}</strong></div>
      </div>
    </div>
    <div class="card-actions">
      <button class="btn btn-light" data-action="edit" type="button">編集</button>
      <button class="btn btn-light" data-action="trash" type="button">${record.trashedAt ? '復元' : 'ゴミ箱'}</button>
      <button class="btn btn-danger" data-action="delete" type="button">${record.trashedAt ? '完全削除' : '削除'}</button>
    </div>
  `;

  card.querySelector('[data-action="preview"]')?.addEventListener('click', () => openViewer(record));
  card.querySelector('[data-action="edit"]')?.addEventListener('click', () => openRecordDialog(record.id));
  card.querySelector('[data-action="trash"]')?.addEventListener('click', () => {
    if (record.trashedAt) restoreRecord(record.id);
    else moveToTrash(record.id);
  });
  card.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
    if (record.trashedAt) permanentDelete(record.id);
    else moveToTrash(record.id);
  });
  return card;
}

function refreshProfileSelect() {
  els.profileSelect.innerHTML = state.profiles.map((profile) => `<option value="${profile.id}">${profile.name}</option>`).join('');
  els.profileSelect.value = state.activeProfileId || state.profiles[0]?.id || DEFAULT_PROFILE.id;
}

function renderProfileEditor() {
  const profile = getProfile();
  els.profileNameInput.value = profile.name || '';
  els.profileNoteInput.value = profile.note || '';
  if (profile.sampleDataUrl) {
    els.samplePreview.src = profile.sampleDataUrl;
    els.samplePreview.style.display = 'block';
  } else {
    els.samplePreview.removeAttribute('src');
    els.samplePreview.style.display = 'none';
  }
  renderRegionEditor(profile);
  renderOverlay(profile);
}

function renderRegionEditor(profile) {
  const regions = profile.regions || DEFAULT_PROFILE.regions;
  const entries = [
    ['title', 'タイトル(赤)'],
    ['levelDifficulty', '楽曲レベル・難易度(青/緑)'],
    ['result', 'リザルト(橙)'],
    ['combo', 'コンボ(紫)'],
  ];
  els.regionEditor.innerHTML = entries.map(([key, label]) => {
    const region = clampRegion(regions[key] || DEFAULT_PROFILE.regions[key]);
    return `
      <div class="region-card" data-region-card="${key}">
        <div class="region-top"><strong>${label}</strong><span class="region-note">%単位</span></div>
        <div class="region-grid">
          <label><span>X</span><input type="number" min="0" max="100" step="0.1" data-region-field="x" data-region-key="${key}" value="${region.x}"></label>
          <label><span>Y</span><input type="number" min="0" max="100" step="0.1" data-region-field="y" data-region-key="${key}" value="${region.y}"></label>
          <label><span>W</span><input type="number" min="1" max="100" step="0.1" data-region-field="w" data-region-key="${key}" value="${region.w}"></label>
          <label><span>H</span><input type="number" min="1" max="100" step="0.1" data-region-field="h" data-region-key="${key}" value="${region.h}"></label>
        </div>
      </div>
    `;
  }).join('');
}

function renderOverlay(profile) {
  const img = els.samplePreview;
  if (!img || !img.src) {
    els.overlayBoxes.innerHTML = '';
    return;
  }
  const regions = profile.regions || DEFAULT_PROFILE.regions;
  const colors = {
    title: 'rgba(255,59,48,.85)',
    levelDifficulty: 'rgba(0,122,255,.85)',
    result: 'rgba(255,149,0,.85)',
    combo: 'rgba(175,82,222,.85)',
  };
  els.overlayBoxes.innerHTML = Object.entries(regions).map(([key, region]) => {
    const r = clampRegion(region);
    return `<div class="overlay-box" style="position:absolute;left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%;border:3px solid ${colors[key]};border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.04) inset;"></div>`;
  }).join('');
}

function syncRegionInputs() {
  const profile = getProfile();
  const next = copy(profile);
  for (const input of els.regionEditor.querySelectorAll('input[data-region-field]')) {
    const key = input.dataset.regionKey;
    const field = input.dataset.regionField;
    next.regions[key][field] = Number(input.value || 0);
  }
  state.profiles = state.profiles.map((item) => item.id === next.id ? next : item);
  renderOverlay(next);
}

async function saveProfile() {
  const current = getProfile();
  const next = copy(current);
  next.name = els.profileNameInput.value.trim() || '新しい機種';
  next.note = els.profileNoteInput.value.trim();
  next.sampleDataUrl = els.samplePreview.src || '';
  for (const input of els.regionEditor.querySelectorAll('input[data-region-field]')) {
    const key = input.dataset.regionKey;
    const field = input.dataset.regionField;
    next.regions[key][field] = Number(input.value || 0);
  }
  next.regions = {
    title: clampRegion(next.regions.title),
    levelDifficulty: clampRegion(next.regions.levelDifficulty),
    result: clampRegion(next.regions.result),
    combo: clampRegion(next.regions.combo),
  };
  state.profiles = state.profiles.map((item) => item.id === next.id ? next : item);
  await db.putProfile(next);
  state.activeProfileId = next.id;
  state.settings.activeProfileId = next.id;
  await saveSettingsToDb();
  refreshProfileSelect();
  toast('機種を保存', `「${next.name}」を登録しました。`, 'success');
}

async function deleteProfile() {
  if (state.profiles.length <= 1) {
    toast('削除できません', '少なくとも1つの機種が必要です。', 'warning');
    return;
  }
  const profile = getProfile();
  if (!confirm(`機種「${profile.name}」を削除しますか？`)) return;
  await db.deleteProfile(profile.id);
  state.profiles = state.profiles.filter((item) => item.id !== profile.id);
  state.activeProfileId = state.profiles[0].id;
  state.settings.activeProfileId = state.activeProfileId;
  await saveSettingsToDb();
  refreshProfileSelect();
  renderProfileEditor();
}

function openRecordDialog(recordId) {
  const record = [...state.records, ...state.trash].find((item) => item.id === recordId);
  if (!record) return;
  state.selectedRecordId = recordId;
  els.recordPreview.src = getRecordImageUrl(record);
  els.editTitle.value = record.title || '';
  els.editPronunciation.value = record.pronunciation || '';
  els.editMusicId.value = record.musicId || '';
  els.editLevel.value = record.playLevel ?? '';
  els.editDifficulty.value = record.difficulty || 'EXPERT';
  els.editPerfect.value = record.perfect ?? 0;
  els.editGreat.value = record.great ?? 0;
  els.editGood.value = record.good ?? 0;
  els.editBad.value = record.bad ?? 0;
  els.editMiss.value = record.miss ?? 0;
  els.editCombo.value = record.combo ?? 0;
  els.editMemo.value = record.memo || '';
  els.recordStatusPill.textContent = record.trashedAt ? 'ゴミ箱内' : record.needsManualCheck ? '要確認' : '編集可能';
  els.recordDialog.showModal();
}

function getCurrentEditedRecord() {
  return [...state.records, ...state.trash].find((item) => item.id === state.selectedRecordId) || null;
}

async function saveEditedRecord() {
  const existing = getCurrentEditedRecord();
  const base = existing || state.currentDraft;
  if (!base) return;
  const wasTrashed = Boolean(existing?.trashedAt);
  const next = { ...base };
  next.title = els.editTitle.value.trim();
  next.pronunciation = els.editPronunciation.value.trim();
  next.musicId = els.editMusicId.value.trim();
  next.playLevel = parseNumber(els.editLevel.value, null);
  next.difficulty = els.editDifficulty.value;
  next.perfect = Number(els.editPerfect.value || 0);
  next.great = Number(els.editGreat.value || 0);
  next.good = Number(els.editGood.value || 0);
  next.bad = Number(els.editBad.value || 0);
  next.miss = Number(els.editMiss.value || 0);
  next.combo = Number(els.editCombo.value || 0);
  next.memo = els.editMemo.value.trim();
  next.missAP = next.great + next.good + next.bad + next.miss;
  next.missContest = next.great * 1 + next.good * 2 + next.bad * 3 + next.miss * 3;
  next.missFC = next.good + next.bad + next.miss;
  next.apAchieved = next.great + next.good + next.bad + next.miss === 0;
  next.fcAchieved = next.good + next.bad + next.miss === 0;
  next.updatedAt = Date.now();
  if (!next.id || !existing) next.id = next.id || createId('record');
  await db.putRecord(next);
  state.records = state.records.filter((record) => record.id !== next.id);
  state.trash = state.trash.filter((record) => record.id !== next.id);
  if (wasTrashed) {
    next.trashedAt = existing.trashedAt;
    state.trash.unshift(next);
  } else {
    state.records.unshift(next);
  }
  state.currentDraft = null;
  renderApp();
  toast('保存しました', '楽曲情報を更新しました。', 'success');
}

async function moveToTrash(id) {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  record.trashedAt = Date.now();
  record.updatedAt = Date.now();
  await db.putRecord(record);
  state.records = state.records.filter((item) => item.id !== id);
  state.trash.unshift(record);
  scheduleRender();
  toast('ゴミ箱へ移動', '3日後に自動削除されます。', 'success');
}

async function restoreRecord(id) {
  const record = state.trash.find((item) => item.id === id);
  if (!record) return;
  record.trashedAt = null;
  record.updatedAt = Date.now();
  await db.putRecord(record);
  state.trash = state.trash.filter((item) => item.id !== id);
  state.records.unshift(record);
  scheduleRender();
  toast('復元しました', '保管庫に戻しました。', 'success');
}

async function permanentDelete(id) {
  const record = state.trash.find((item) => item.id === id) || state.records.find((item) => item.id === id);
  if (!record) return;
  if (!confirm('完全削除しますか？ この操作は取り消せません。')) return;
  if (record.driveFileId) {
    if (state.drive.isConnected()) {
      try { await state.drive.deleteFile(record.driveFileId); } catch { state.pendingDriveDeletes.push(record.driveFileId); }
    } else {
      state.pendingDriveDeletes.push(record.driveFileId);
    }
  }
  await db.deleteRecord(id);
  state.records = state.records.filter((item) => item.id !== id);
  state.trash = state.trash.filter((item) => item.id !== id);
  await saveSettingsToDb();
  scheduleRender();
  toast('完全削除しました', '画像データも含めて削除しました。', 'success');
}

function openViewer(record) {
  if (!record.imageBlob) return;
  if (state.viewerUrl && state.viewerUrl.startsWith('blob:')) URL.revokeObjectURL(state.viewerUrl);
  state.viewerUrl = URL.createObjectURL(record.imageBlob);
  els.viewerImage.src = state.viewerUrl;
  els.viewerCaption.textContent = `${record.title || '無題'} / Lv.${record.playLevel ?? '-'} / ${record.difficulty}`;
  els.viewerDialog.showModal();
}

function closeViewer() {
  if (viewerClosing) return;
  viewerClosing = true;
  try {
    if (els.viewerDialog.open) els.viewerDialog.close();
    if (state.viewerUrl && state.viewerUrl.startsWith('blob:')) {
      URL.revokeObjectURL(state.viewerUrl);
      state.viewerUrl = '';
    }
  } finally {
    viewerClosing = false;
  }
}

function updateCatalogChips() {
  setButtonActive([...document.querySelectorAll('[data-filter-best]')], (btn) => btn.dataset.filterBest === state.settings.filterBest);
  setButtonActive([...document.querySelectorAll('[data-judge-filter]')], (btn) => btn.dataset.judgeFilter === state.settings.judgeFilter);
  document.querySelectorAll('[data-difficulty]').forEach((btn) => btn.dataset.active = String(btn.dataset.difficulty === state.settings.difficulty));
}

function showBestNotification(record, previousBestAp, previousBestFc) {
  const improvements = [];
  if (previousBestAp && basisMissCount(record, 'ap') < basisMissCount(previousBestAp, 'ap')) improvements.push(`AP基準 ${basisMissCount(previousBestAp, 'ap')} → ${basisMissCount(record, 'ap')}`);
  if (previousBestFc && basisMissCount(record, 'fc') < basisMissCount(previousBestFc, 'fc')) improvements.push(`FC基準 ${basisMissCount(previousBestFc, 'fc')} → ${basisMissCount(record, 'fc')}`);
  if (!improvements.length) return;
  const message = `${record.title} で自己ベストを更新しました。${improvements.join(' / ')}`;
  toast('自己ベスト更新', message, 'success');
  if (state.settings.enableNotifications && window.Notification) {
    if (Notification.permission === 'granted') new Notification('自己ベスト更新', { body: message });
    else if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }
}

async function maybeUploadToDrive(record, blob) {
  const choice = state.settings.driveUpload;
  if (choice === 'off') return null;
  let shouldUpload = choice === 'on';
  if (choice === 'ask') shouldUpload = confirm('Google Drive にも保存しますか？');
  if (!shouldUpload) return null;
  if (!state.drive.isConnected()) {
    toast('Drive未接続', '先にDrive連携を行ってください。', 'warning');
    return null;
  }
  const result = await state.drive.uploadImage({
    blob,
    title: `${record.title || 'result'}_${record.id}.png`,
    folderId: state.settings.googleFolderId,
  });
  return result;
}

async function processUploadFiles(files) {
  if (!files.length) return;
  const profile = getProfile();
  const manualMode = state.settings.registerMode === 'manual';
  if (manualMode && files.length > 1) {
    toast('手動登録モード', '一度に複数枚は処理せず、先頭の1枚のみを開きます。', 'warning');
  }
  for (const [index, file] of files.entries()) {
    try {
      state.loading = true;
      toast('解析中', `${file.name} を読み取っています。`, 'info', 1800);
      const analysis = await analyzeResultImage(file, profile, state.master);
      const imageBlob = file;
      const draft = makeRecordFromAnalysis(analysis, imageBlob, { sourceName: file.name });
      const previousBestAp = currentBestByBasis(state.records, 'ap').find((r) => groupKey(r) === groupKey(draft));
      const previousBestFc = currentBestByBasis(state.records, 'fc').find((r) => groupKey(r) === groupKey(draft));
      if (manualMode) {
        state.currentDraft = draft;
        openDraftAsEditor(draft);
        break;
      }
      await persistDraft(draft, file, previousBestAp, previousBestFc);
    } catch (error) {
      console.error(error);
      toast('読み取り失敗', error.message || '画像の解析に失敗しました。', 'error', 5200);
    } finally {
      state.loading = false;
    }
  }
}

function openDraftAsEditor(draft) {
  state.selectedRecordId = draft.id;
  els.recordPreview.src = getRecordImageUrl(draft);
  els.editTitle.value = draft.title || '';
  els.editPronunciation.value = draft.pronunciation || '';
  els.editMusicId.value = draft.musicId || '';
  els.editLevel.value = draft.playLevel ?? '';
  els.editDifficulty.value = draft.difficulty || 'EXPERT';
  els.editPerfect.value = draft.perfect ?? 0;
  els.editGreat.value = draft.great ?? 0;
  els.editGood.value = draft.good ?? 0;
  els.editBad.value = draft.bad ?? 0;
  els.editMiss.value = draft.miss ?? 0;
  els.editCombo.value = draft.combo ?? 0;
  els.editMemo.value = draft.memo || '';
  els.recordStatusPill.textContent = draft.needsManualCheck ? '要確認' : '自動入力済み';
  els.recordDialog.showModal();
}

async function persistDraft(draft, file, previousBestAp, previousBestFc) {
  const uploaded = await maybeUploadToDrive(draft, file);
  if (uploaded) {
    draft.driveFileId = uploaded.id || '';
    draft.driveWebViewLink = uploaded.webViewLink || '';
  }
  await db.putRecord(draft);
  state.records.unshift(draft);
  state.currentDraft = null;
  renderApp();
  showBestNotification(draft, previousBestAp, previousBestFc);
  toast('登録しました', `${draft.title || file.name} を保存しました。`, draft.needsManualCheck ? 'warning' : 'success');
}

function exportJson() {
  const data = state.records.map(({ imageBlob, ...record }) => record);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `prosekai-results-${new Date().toISOString().slice(0, 10)}.json`);
}

async function connectDrive() {
  state.drive.configure({
    clientId: state.settings.googleClientId,
    apiKey: state.settings.googleApiKey,
    folderId: state.settings.googleFolderId,
  });
  try {
    await state.drive.connect();
    toast('Driveに接続しました', 'Google アカウントと連携しました。', 'success');
    await syncDriveDeletes();
    renderApp();
  } catch (error) {
    toast('Drive接続失敗', error.message || '接続できませんでした。', 'error', 5200);
  }
}

function resetFilters() {
  state.settings.query = '';
  state.settings.levelQuery = '';
  state.settings.difficulty = 'all';
  state.settings.filterBest = 'all';
  state.settings.judgeFilter = 'all';
  state.settings.sortKey = 'added';
  state.settings.sortDir = 'desc';
  state.settings.missBasis = 'ap';
  state.settings.viewBasis = 'ap';
  state.settings.apMissMin = '';
  state.settings.apMissMax = '';
  state.settings.fcMissMin = '';
  state.settings.fcMissMax = '';
  updateControlsFromState();
  renderApp();
  saveSettingsToDb();
}

async function saveSettings() {
  state.settings.googleClientId = els.googleClientIdInput.value.trim();
  state.settings.googleApiKey = els.googleApiKeyInput.value.trim();
  state.settings.googleFolderId = els.googleFolderIdInput.value.trim();
  state.settings.enableNotifications = els.enableNotificationsInput.checked;
  state.settings.showOnlyBestByDefault = els.showOnlyBestByDefaultInput.checked;
  state.settings.persistExpand = els.persistExpandInput.checked;
  await saveSettingsToDb();
  if (state.settings.googleClientId) state.drive.configure(state.settings);
  toast('設定を保存', '設定を保存しました。', 'success');
  renderApp();
}

function syncProfilePreviewFromInput(file) {
  const reader = new FileReader();
  reader.onload = () => {
    els.samplePreview.src = String(reader.result || '');
    const profile = getProfile();
    profile.sampleDataUrl = els.samplePreview.src;
    renderOverlay(profile);
  };
  reader.readAsDataURL(file);
}

function bindEvents() {
  els.fileInput.addEventListener('change', () => processUploadFiles([...els.fileInput.files || []]).finally(() => { els.fileInput.value = ''; }));
  els.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropzone.classList.add('dragging'); });
  els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragging'));
  els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragging');
    processUploadFiles([...e.dataTransfer.files].filter((file) => file.type.startsWith('image/')));
  });

  const filterInputs = [els.queryInput, els.levelQueryInput, els.difficultySelect, els.sortKeySelect, els.sortDirSelect, els.missBasisSelect, els.viewBasisSelect, els.apMissMin, els.apMissMax, els.fcMissMin, els.fcMissMax];
  filterInputs.forEach((input) => input.addEventListener('input', () => { updateFilterStateFromControls(); scheduleRender(); saveSettingsToDb(); }));
  filterInputs.forEach((input) => input.addEventListener('change', () => { updateFilterStateFromControls(); scheduleRender(); saveSettingsToDb(); }));

  els.registerModeSelect.addEventListener('change', async () => { state.settings.registerMode = els.registerModeSelect.value; await saveSettingsToDb(); });
  els.driveUploadSelect.addEventListener('change', async () => { state.settings.driveUpload = els.driveUploadSelect.value; await saveSettingsToDb(); });

  document.addEventListener('click', (e) => {
    const bestBtn = e.target.closest('[data-filter-best]');
    if (bestBtn) {
      state.settings.filterBest = bestBtn.dataset.filterBest;
      updateControlsFromState();
      saveSettingsToDb();
      renderApp();
    }
    const judgeBtn = e.target.closest('[data-judge-filter]');
    if (judgeBtn) {
      state.settings.judgeFilter = judgeBtn.dataset.judgeFilter;
      updateControlsFromState();
      saveSettingsToDb();
      renderApp();
    }
    const diffBtn = e.target.closest('[data-difficulty]');
    if (diffBtn) {
      state.settings.difficulty = diffBtn.dataset.difficulty;
      updateControlsFromState();
      saveSettingsToDb();
      renderApp();
    }
    const tabBtn = e.target.closest('[data-list-tab]');
    if (tabBtn) {
      state.currentTab = tabBtn.dataset.listTab;
      state.settings.listTab = state.currentTab;
      updateControlsFromState();
      saveSettingsToDb();
      renderApp();
    }
  });

  els.resetFiltersBtn.addEventListener('click', resetFilters);
  els.openSettingsBtn.addEventListener('click', () => els.settingsDialog.showModal());
  els.closeSettingsBtn.addEventListener('click', () => els.settingsDialog.close());
  els.saveSettingsBtn.addEventListener('click', saveSettings);
  els.connectDriveBtn.addEventListener('click', connectDrive);
  els.exportJsonBtn.addEventListener('click', exportJson);

  els.openCalibrateBtn.addEventListener('click', () => {
    refreshProfileSelect();
    renderProfileEditor();
    els.calibrateDialog.showModal();
  });
  els.closeCalibrateBtn.addEventListener('click', () => els.calibrateDialog.close());
  els.profileSelect.addEventListener('change', () => {
    state.activeProfileId = els.profileSelect.value;
    state.settings.activeProfileId = state.activeProfileId;
    renderProfileEditor();
    saveSettingsToDb();
  });
  els.newProfileBtn.addEventListener('click', async () => {
    const profile = newProfileTemplate();
    state.profiles.unshift(profile);
    state.activeProfileId = profile.id;
    state.settings.activeProfileId = profile.id;
    await db.putProfile(profile);
    await saveSettingsToDb();
    refreshProfileSelect();
    renderProfileEditor();
  });
  els.sampleImageInput.addEventListener('change', () => {
    const file = els.sampleImageInput.files?.[0];
    if (file) syncProfilePreviewFromInput(file);
  });
  els.regionEditor.addEventListener('input', syncRegionInputs);
  els.saveProfileBtn.addEventListener('click', saveProfile);
  els.deleteProfileBtn.addEventListener('click', deleteProfile);

  els.recordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitter = e.submitter;
    if (submitter?.value === 'cancel') {
      els.recordDialog.close();
      return;
    }
    await saveEditedRecord();
    els.recordDialog.close();
  });
  els.trashRecordBtn.addEventListener('click', async () => {
    const record = getCurrentEditedRecord();
    if (!record) {
      state.currentDraft = null;
      els.recordDialog.close();
      return;
    }
    if (record.trashedAt) await restoreRecord(record.id); else await moveToTrash(record.id);
    els.recordDialog.close();
  });
  els.deleteNowRecordBtn.addEventListener('click', async () => {
    const record = getCurrentEditedRecord();
    if (!record) {
      state.currentDraft = null;
      els.recordDialog.close();
      return;
    }
    await permanentDelete(record.id);
    els.recordDialog.close();
  });
  els.closeViewerBtn.addEventListener('click', closeViewer);
  els.viewerDialog.addEventListener('click', (e) => { if (e.target === els.viewerDialog) closeViewer(); });
  els.viewerDialog.addEventListener('close', () => {
    if (!state.settings.persistExpand && state.viewerUrl && !viewerClosing) {
      const url = state.viewerUrl;
      state.viewerUrl = '';
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  });
  window.addEventListener('resize', scheduleRender);
  els.listViewport.addEventListener('scroll', scheduleRender, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (els.recordDialog.open) els.recordDialog.close();
      if (els.calibrateDialog.open) els.calibrateDialog.close();
      if (els.settingsDialog.open) els.settingsDialog.close();
      if (els.viewerDialog.open) closeViewer();
    }
  });
}

function renderApp() {
  updateControlsFromState();
  renderDifficultyChips();
  refreshProfileSelect();
  renderProfileEditor();
  renderList();
}

async function bootstrap() {
  bindEvents();
  await loadInitialData();
  if (state.settings.googleClientId || state.settings.googleApiKey) {
    state.drive.configure(state.settings);
  }
  els.notifyLabel.textContent = state.settings.enableNotifications ? 'ON' : 'OFF';
  renderApp();
  autoCleanupTimer = setInterval(() => cleanupTrash().catch(console.error), 6 * 60 * 60 * 1000);
}

bootstrap().catch((error) => {
  console.error(error);
  toast('初期化失敗', error.message || 'アプリの起動に失敗しました。', 'error', 8000);
});
