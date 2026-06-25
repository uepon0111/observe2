
import { APP_CONFIG, DIFFICULTIES, DIFFICULTY_COLORS, DEFAULT_STATE, MISS_MODES, OCR_BOXES, SORT_OPTIONS } from './config.js';
import { loadMusicCatalog, getSongDifficultyInfo, findBestMusicMatch, normalizeDifficulty } from './musicData.js';
import { loadRecords, saveRecord, deleteRecord, loadAllSettings, saveSetting, loadSetting } from './db.js';
import { applyFilters, applyBestOnly, sortRecords, computeVirtualWindow, getMissValue, getMissModeMeta } from './list.js';
import { ensureOcrReady, readResultImage, getReadingOverlayBoxes } from './ocr.js';
import { createDriveTokenClient, ensureDriveFolder, uploadFileToDrive, trashDriveFile, deleteDriveFile } from './drive.js';
import { daysBetween, escapeHtml, formatDateTime, formatDate, createId, normalizeSearchText, safeNumber, clamp } from './utils.js';

const state = {
  catalog: null,
  records: [],
  settings: {},
  driveToken: null,
  tokenClient: null,
  selectedId: null,
  uploadMode: 'auto',
  view: 'all',
  ...DEFAULT_STATE,
  difficultyFilters: new Set(DIFFICULTIES),
  initialized: false,
  pendingDraft: null,
  pendingFile: null,
  currentModal: null,
  loading: true,
  refreshScheduled: false,
};

const dom = {};
let renderFrame = 0;
let visibleThumbnailUrls = [];

document.addEventListener('DOMContentLoaded', boot);

async function boot() {
  cacheDom();
  bindStaticEvents();
  applyDefaultUi();
  showLoadingState('読み込み中です…');
  try {
    const [settings, records, catalog] = await Promise.all([
      loadAllSettings().catch(() => ({})),
      loadRecords().catch(() => []),
      loadMusicCatalog(),
    ]);
    state.settings = {
      googleClientId: settings.googleClientId || '',
      driveFolderName: settings.driveFolderName || APP_CONFIG.defaultDriveFolderName,
      autoUploadToDrive: settings.autoUploadToDrive ?? false,
      driveFolderId: settings.driveFolderId || '',
      uploadMode: settings.uploadMode || 'auto',
      ...settings,
    };
    state.records = records.map(normalizeRecordShape);
    state.catalog = catalog;
    state.uploadMode = state.settings.uploadMode || 'auto';
    state.view = state.view || 'all';
    syncSettingsToUi();
    await cleanupExpiredTrash();
    state.initialized = true;
    state.loading = false;
    hideLoadingState();
    renderAll();
    scheduleCleanupLoop();
    maybeRegisterDriveClient();
    showToast('アプリを読み込みました。', 'success', '準備完了');
  } catch (error) {
    hideLoadingState();
    console.error(error);
    showToast(error.message || '初期化に失敗しました。', 'danger', '読み込みエラー');
    renderEmptyShellFallback();
  }
}

function cacheDom() {
  const ids = [
    'btnRefresh', 'btnSettings', 'btnConnectDrive', 'btnPickFiles', 'btnPasteFromClipboard', 'fileInput',
    'uploadZone', 'uploadModeAuto', 'uploadModeManual', 'driveFolderName', 'googleClientId',
    'btnSaveDriveSettings', 'btnOpenHelp', 'btnToggleBestOnly', 'btnToggleTrash',
    'sortKey', 'btnToggleSortDirection', 'missMode', 'titleQuery', 'levelQuery', 'missMin', 'missMax',
    'apFilter', 'fcFilter', 'btnClearFilters', 'difficultyFilters', 'filterBadges',
    'recordCount', 'bestModeBadge', 'trashSummary', 'resultSummary', 'listViewport', 'stateSummary',
    'trashList', 'overlayLegend', 'driveStatus', 'appSubtitle', 'modalRoot', 'toastRoot',
    'btnOpenSettingsDrawer',
  ];
  for (const id of ids) dom[id] = document.getElementById(id);
}

function applyDefaultUi() {
  dom.sortKey.value = state.sortKey;
  dom.missMode.value = state.missMode;
  dom.titleQuery.value = state.titleQuery;
  dom.levelQuery.value = state.levelQuery;
  dom.missMin.value = state.missMin;
  dom.missMax.value = state.missMax;
  dom.apFilter.checked = state.apFilter;
  dom.fcFilter.checked = state.fcFilter;
  syncUploadModeButtons();
  renderDifficultyFilters();
  renderOverlayLegend();
  setDriveStatus('未連携', '未連携');
}

function bindStaticEvents() {
  dom.btnRefresh.addEventListener('click', async () => {
    await refreshAll(true);
  });

  dom.btnSettings.addEventListener('click', () => openSettingsModal());
  dom.btnOpenSettingsDrawer.addEventListener('click', () => openSettingsModal());
  dom.btnOpenHelp.addEventListener('click', () => openHelpModal());

  dom.btnPickFiles.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', onFilesSelected);

  dom.uploadZone.addEventListener('dragenter', preventDefaults, false);
  dom.uploadZone.addEventListener('dragover', (event) => {
    preventDefaults(event);
    dom.uploadZone.classList.add('is-dragover');
  });
  dom.uploadZone.addEventListener('dragleave', () => dom.uploadZone.classList.remove('is-dragover'));
  dom.uploadZone.addEventListener('drop', async (event) => {
    preventDefaults(event);
    dom.uploadZone.classList.remove('is-dragover');
    const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith('image/'));
    if (files.length) handleUploadFiles(files);
  });

  dom.btnPasteFromClipboard.addEventListener('click', pasteFromClipboard);

  dom.uploadModeAuto.addEventListener('click', () => setUploadMode('auto'));
  dom.uploadModeManual.addEventListener('click', () => setUploadMode('manual'));

  dom.btnSaveDriveSettings.addEventListener('click', saveDriveSettings);

  dom.btnConnectDrive.addEventListener('click', connectGoogleDrive);
  dom.btnToggleBestOnly.addEventListener('click', () => {
    state.showBestOnly = !state.showBestOnly;
    renderAll();
  });
  dom.btnToggleTrash.addEventListener('click', () => {
    state.view = state.view === 'trash' ? 'all' : 'trash';
    renderAll();
  });

  dom.sortKey.addEventListener('change', (event) => {
    state.sortKey = event.target.value;
    renderList();
    saveUiPreference('sortKey', state.sortKey);
  });
  dom.btnToggleSortDirection.addEventListener('click', () => {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    renderList();
    saveUiPreference('sortDirection', state.sortDirection);
  });
  dom.missMode.addEventListener('change', (event) => {
    state.missMode = event.target.value;
    renderAll();
    saveUiPreference('missMode', state.missMode);
  });

  for (const input of [dom.titleQuery, dom.levelQuery, dom.missMin, dom.missMax]) {
    input.addEventListener('input', () => {
      state.titleQuery = dom.titleQuery.value;
      state.levelQuery = dom.levelQuery.value;
      state.missMin = dom.missMin.value;
      state.missMax = dom.missMax.value;
      renderList();
    });
  }

  dom.apFilter.addEventListener('change', () => {
    state.apFilter = dom.apFilter.checked;
    renderList();
  });
  dom.fcFilter.addEventListener('change', () => {
    state.fcFilter = dom.fcFilter.checked;
    renderList();
  });
  dom.btnClearFilters.addEventListener('click', () => {
    state.titleQuery = '';
    state.levelQuery = '';
    state.missMin = '';
    state.missMax = '';
    state.apFilter = false;
    state.fcFilter = false;
    state.showBestOnly = false;
    state.sortKey = 'date';
    state.sortDirection = 'desc';
    state.missMode = 'ap';
    state.difficultyFilters = new Set(DIFFICULTIES);
    syncSettingsToUi();
    renderAll();
  });

  window.addEventListener('resize', scheduleRenderList);
  window.addEventListener('focus', async () => {
    await cleanupExpiredTrash();
    renderAll();
  });

  dom.listViewport.addEventListener('scroll', scheduleRenderList, { passive: true });
  dom.listViewport.addEventListener('keydown', (event) => {
    if (event.key === 'Home') {
      dom.listViewport.scrollTop = 0;
      scheduleRenderList();
    }
  });

  dom.difficultyFilters.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-diff]');
    if (!btn) return;
    const diff = btn.getAttribute('data-diff');
    if (state.difficultyFilters.has(diff)) state.difficultyFilters.delete(diff);
    else state.difficultyFilters.add(diff);
    renderDifficultyFilters();
    renderList();
  });

  dom.modalRoot.addEventListener('click', (event) => {
    if (event.target.matches('[data-close-modal]') || event.target.classList.contains('modal-backdrop')) {
      closeModal();
    }
  });
  dom.toastRoot.addEventListener('click', (event) => {
    const close = event.target.closest('[data-toast-close]');
    if (close) close.parentElement?.remove();
  });
}

function saveUiPreference(key, value) {
  state.settings[key] = value;
  saveSetting(key, value).catch(console.error);
}

function preventDefaults(event) {
  event.preventDefault();
  event.stopPropagation();
}

function renderEmptyShellFallback() {
  dom.recordCount.textContent = '0';
  dom.resultSummary.textContent = '読み込み失敗';
}

function showLoadingState(message) {
  dom.appSubtitle.textContent = message;
}

function hideLoadingState() {
  dom.appSubtitle.textContent = '画像を読み取り、条件で整理して、必要に応じて Google ドライブへ保存できます。';
}

function syncSettingsToUi() {
  dom.driveFolderName.value = state.settings.driveFolderName || APP_CONFIG.defaultDriveFolderName;
  dom.googleClientId.value = state.settings.googleClientId || '';
  dom.sortKey.value = state.sortKey;
  dom.missMode.value = state.missMode;
  dom.titleQuery.value = state.titleQuery;
  dom.levelQuery.value = state.levelQuery;
  dom.missMin.value = state.missMin;
  dom.missMax.value = state.missMax;
  dom.apFilter.checked = state.apFilter;
  dom.fcFilter.checked = state.fcFilter;
  syncUploadModeButtons();
  setDriveStatus(state.driveToken ? '連携中' : '未連携', state.driveToken ? '連携中' : '未連携');
}

function syncUploadModeButtons() {
  dom.uploadModeAuto.classList.toggle('is-active', state.uploadMode === 'auto');
  dom.uploadModeManual.classList.toggle('is-active', state.uploadMode === 'manual');
}

function setUploadMode(mode) {
  state.uploadMode = mode;
  state.settings.uploadMode = mode;
  saveSetting('uploadMode', mode).catch(console.error);
  syncUploadModeButtons();
  showToast(mode === 'auto' ? '自動登録に切り替えました。' : '手動登録に切り替えました。', 'success');
}

function setDriveStatus(text, hint) {
  dom.driveStatus.textContent = text;
  dom.driveStatus.title = hint || text;
}

function renderDifficultyFilters() {
  dom.difficultyFilters.innerHTML = '';
  for (const diff of DIFFICULTIES) {
    const active = state.difficultyFilters.has(diff);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'diff-chip';
    button.dataset.diff = diff;
    button.dataset.active = String(active);
    button.style.borderColor = active ? DIFFICULTY_COLORS[diff] : 'var(--border)';
    button.style.background = active ? `${DIFFICULTY_COLORS[diff]}22` : '#fff';
    button.style.color = active ? '#223' : 'var(--muted)';
    button.innerHTML = `<span class="diff-dot" style="background:${DIFFICULTY_COLORS[diff]}"></span>${diff}`;
    dom.difficultyFilters.appendChild(button);
  }
}

function renderOverlayLegend() {
  const boxes = getReadingOverlayBoxes();
  dom.overlayLegend.innerHTML = Object.entries(boxes).map(([key, item]) => `
    <div class="legend-item">
      <span class="legend-box" style="color:${item.color}"></span>
      <div class="legend-text">${escapeHtml(item.label)} <span style="color:${item.color}">${escapeHtml(key)}</span></div>
    </div>
  `).join('');
}

function getUiRecords() {
  const base = applyFilters(state.records, state);
  const shown = state.showBestOnly && state.view !== 'trash' ? applyBestOnly(base, state) : base;
  const sorted = sortRecords(shown, state);
  return sorted;
}

function renderAll() {
  renderCounts();
  renderStateSummary();
  renderFilterBadges();
  renderTrashSummary();
  renderList();
  renderTrashPanel();
}

function renderCounts() {
  const visible = getUiRecords();
  const trash = state.records.filter((record) => !!record.trashedAt);
  dom.recordCount.textContent = String(visible.length);
  dom.resultSummary.textContent = `${visible.length} 件`;
  dom.bestModeBadge.textContent = state.showBestOnly ? '自己ベストのみ' : '全件表示';
  dom.trashSummary.textContent = `ゴミ箱 ${trash.length} 件`;
  dom.btnToggleBestOnly.innerHTML = state.showBestOnly
    ? '<i data-lucide="star"></i><span>自己ベストのみ</span>'
    : '<i data-lucide="star"></i><span>全件表示</span>';
  dom.btnToggleTrash.innerHTML = state.view === 'trash'
    ? '<i data-lucide="archive-restore"></i><span>一覧へ戻る</span>'
    : '<i data-lucide="trash-2"></i><span>ゴミ箱</span>';
  dom.btnToggleSortDirection.innerHTML = state.sortDirection === 'asc'
    ? '<i data-lucide="arrow-up-narrow-wide"></i><span>昇順</span>'
    : '<i data-lucide="arrow-down-wide-narrow"></i><span>降順</span>';
}

function renderStateSummary() {
  const activeMode = getMissModeMeta(state.missMode);
  const counts = [
    `表示モード: ${state.view === 'trash' ? 'ゴミ箱' : '一覧'}`,
    `基準: ${activeMode.label}`,
    `並び替え: ${SORT_OPTIONS.find((item) => item.key === state.sortKey)?.label || '追加日順'} / ${state.sortDirection === 'asc' ? '昇順' : '降順'}`,
    `自己ベストのみ: ${state.showBestOnly ? 'ON' : 'OFF'}`,
    `AP済み: ${state.apFilter ? '絞り込み中' : '全件'}`,
    `FC済み: ${state.fcFilter ? '絞り込み中' : '全件'}`,
  ];
  dom.stateSummary.innerHTML = counts.map((text) => `<div class="mini">${escapeHtml(text)}</div>`).join('');
}

function renderFilterBadges() {
  const activeDiffCount = state.difficultyFilters.size;
  const badges = [];
  badges.push(`<span class="badge badge-soft">難易度 ${activeDiffCount}/${DIFFICULTIES.length}</span>`);
  if (state.showBestOnly) badges.push('<span class="badge">自己ベスト</span>');
  if (state.apFilter) badges.push('<span class="badge">AP済みのみ</span>');
  if (state.fcFilter) badges.push('<span class="badge">FC済みのみ</span>');
  if (state.view === 'trash') badges.push('<span class="badge">ゴミ箱表示</span>');
  dom.filterBadges.innerHTML = badges.join('');
}

function renderTrashPanel() {
  const trashItems = state.records.filter((record) => record.trashedAt).sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
  if (!trashItems.length) {
    dom.trashList.innerHTML = '<div class="mini">ゴミ箱は空です。</div>';
    return;
  }
  dom.trashList.innerHTML = trashItems.slice(0, 5).map((record) => {
    const daysLeft = Math.max(0, APP_CONFIG.trashDays - daysBetween(record.trashedAt));
    return `
      <div class="mini">
        <strong>${escapeHtml(record.title || '未設定')}</strong><br />
        ${escapeHtml(record.difficulty || '-')}/${escapeHtml(String(record.playLevel ?? '-'))}<br />
        残り ${daysLeft.toFixed(1)} 日
      </div>
    `;
  }).join('');
}

function renderTrashSummary() {
  // already rendered in counts, keep for future extension
}

function scheduleRenderList() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderList();
  });
}

function getItemHeight() {
  return window.matchMedia('(max-width: 760px)').matches ? 214 : 194;
}

function renderList() {
  const records = getUiRecords().filter((record) => (state.view === 'trash' ? !!record.trashedAt : !record.trashedAt));
  const viewport = dom.listViewport;
  const itemHeight = getItemHeight();
  const preservedScrollTop = viewport.scrollTop;

  if (visibleThumbnailUrls.length) {
    for (const url of visibleThumbnailUrls) URL.revokeObjectURL(url);
    visibleThumbnailUrls = [];
  }

  viewport.innerHTML = '';
  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = state.view === 'trash'
      ? 'ゴミ箱に記録がありません。'
      : '条件に合う記録がありません。';
    viewport.appendChild(empty);
    return;
  }

  const totalHeight = records.length * itemHeight;
  const scroller = document.createElement('div');
  scroller.style.position = 'relative';
  scroller.style.height = `${totalHeight}px`;
  viewport.appendChild(scroller);
  viewport.scrollTop = Math.min(preservedScrollTop, Math.max(0, totalHeight - viewport.clientHeight));

  const { start, end } = computeVirtualWindow(viewport, records.length, itemHeight, 4);
  for (let index = start; index < end; index += 1) {
    const record = records[index];
    const row = document.createElement('div');
    row.className = 'record-row';
    row.style.top = `${index * itemHeight}px`;
    row.style.height = `${itemHeight}px`;

    const card = buildRecordCard(record);
    row.appendChild(card);
    scroller.appendChild(row);
  }
  renderIconSet();
}

function buildRecordCard(record) {
  const template = document.getElementById('recordCardTemplate');
  const card = template.content.firstElementChild.cloneNode(true);
  const titleEl = card.querySelector('.record-title');
  const subtitleEl = card.querySelector('.record-subtitle');
  const tagsEl = card.querySelector('.record-tags');
  const statsEl = card.querySelector('.record-stats');
  const thumb = card.querySelector('.record-thumb');
  const thumbBtn = card.querySelector('.record-thumb-btn');

  titleEl.textContent = record.title || '未設定';
  subtitleEl.innerHTML = [
    `読み方: ${escapeHtml(record.pronunciation || '-')}`,
    `追加: ${escapeHtml(formatDateTime(record.createdAt))}`,
    record.trashedAt ? `ゴミ箱: ${escapeHtml(formatDateTime(record.trashedAt))}` : '',
    record.needsReview ? '<span style="color:var(--warning);font-weight:800">要確認</span>' : '',
  ].filter(Boolean).join(' / ');

  tagsEl.innerHTML = `
    <span class="tag tag-diff" style="background:${DIFFICULTY_COLORS[normalizeDifficulty(record.difficulty)] || '#a0a0a0'}">${escapeHtml(record.difficulty || '-')}</span>
    <span class="tag">Lv. ${escapeHtml(String(record.playLevel ?? '-'))}</span>
    <span class="tag ${record.apDone ? 'tag-status ok' : 'tag-status warn'}">AP ${record.apDone ? '済み' : '未達'}</span>
    <span class="tag ${record.fcDone ? 'tag-status ok' : 'tag-status warn'}">FC ${record.fcDone ? '済み' : '未達'}</span>
    <span class="tag">AP基準 ${escapeHtml(String(getMissValue(record, 'ap')))}</span>
    <span class="tag">大会基準 ${escapeHtml(String(getMissValue(record, 'apTournament')))}</span>
    <span class="tag">FC基準 ${escapeHtml(String(getMissValue(record, 'fc')))}</span>
  `;

  const stats = [
    ['スコア', record.score != null ? String(record.score) : '-'],
    ['コンボ', record.combo != null ? String(record.combo) : '-'],
    ['PERFECT', String(record.perfect ?? '-')],
    ['GREAT/GOOD/BAD/MISS', `${record.great ?? '-'} / ${record.good ?? '-'} / ${record.bad ?? '-'} / ${record.miss ?? '-'}`],
  ];
  statsEl.innerHTML = stats.map(([label, value]) => `
    <div class="stat"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>
  `).join('');

  const src = getThumbnailSource(record);
  thumb.alt = record.title || 'リザルト画像';
  thumb.src = src;
  if (src.startsWith('blob:')) visibleThumbnailUrls.push(src);

  thumbBtn.addEventListener('click', () => openPreviewModal(record));
  const editBtn = card.querySelector('.js-edit');
  const trashBtn = card.querySelector('.js-trash');
  const actions = card.querySelector('.record-actions');
  if (record.trashedAt) {
    editBtn.innerHTML = '<i data-lucide="rotate-ccw"></i>';
    editBtn.title = '戻す';
    trashBtn.innerHTML = '<i data-lucide="trash-2"></i>';
    trashBtn.title = '今すぐ削除';
    editBtn.addEventListener('click', () => restoreRecord(record));
    trashBtn.addEventListener('click', () => deleteRecordNow(record));
  } else {
    editBtn.addEventListener('click', () => openEditorModal(record));
    trashBtn.addEventListener('click', () => trashRecord(record));
  }
  card.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    openPreviewModal(record);
  });
  return card;
}

function getThumbnailSource(record) {
  if (record.imageBlob instanceof Blob) return URL.createObjectURL(record.imageBlob);
  if (record.imageDataUrl) return record.imageDataUrl;
  if (record.driveWebViewLink) return record.driveWebViewLink;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="#eef3fb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#66728a" font-size="24" font-family="sans-serif">画像なし</text></svg>`);
}

function renderIconSet() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

function normalizeRecordShape(record) {
  const safe = { ...record };
  safe.title = safe.title || '';
  safe.pronunciation = safe.pronunciation || '';
  safe.difficulty = normalizeDifficulty(safe.difficulty || '');
  safe.playLevel = safe.playLevel != null ? Number(safe.playLevel) : null;
  safe.perfect = safe.perfect != null ? Number(safe.perfect) : 0;
  safe.great = safe.great != null ? Number(safe.great) : 0;
  safe.good = safe.good != null ? Number(safe.good) : 0;
  safe.bad = safe.bad != null ? Number(safe.bad) : 0;
  safe.miss = safe.miss != null ? Number(safe.miss) : 0;
  safe.combo = safe.combo != null ? Number(safe.combo) : null;
  safe.score = safe.score != null ? Number(safe.score) : null;
  safe.apMiss = safe.apMiss != null ? Number(safe.apMiss) : safe.great + safe.good + safe.bad + safe.miss;
  safe.apTournamentMiss = safe.apTournamentMiss != null ? Number(safe.apTournamentMiss) : safe.great + safe.good * 2 + safe.bad * 3 + safe.miss * 3;
  safe.fcMiss = safe.fcMiss != null ? Number(safe.fcMiss) : safe.good + safe.bad + safe.miss;
  safe.apDone = safe.apDone != null ? !!safe.apDone : safe.apMiss === 0;
  safe.fcDone = safe.fcDone != null ? !!safe.fcDone : safe.fcMiss === 0;
  safe.totalNoteCount = safe.totalNoteCount != null ? Number(safe.totalNoteCount) : safe.perfect + safe.great + safe.good + safe.bad + safe.miss;
  safe.songKey = safe.songKey || `${normalizeSearchText(safe.title)}|${safe.difficulty}|${safe.playLevel ?? ''}`;
  safe.trashedAt = safe.trashedAt || null;
  return safe;
}

async function onFilesSelected() {
  const files = [...dom.fileInput.files || []].filter((file) => file.type.startsWith('image/'));
  dom.fileInput.value = '';
  if (files.length) await handleUploadFiles(files);
}

async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      files.push(new File([blob], `clipboard-${Date.now()}.png`, { type }));
    }
    if (!files.length) throw new Error('画像が見つかりませんでした。');
    await handleUploadFiles(files);
  } catch (error) {
    showToast(error.message || 'クリップボードから取得できませんでした。', 'warning', '取得失敗');
  }
}

async function handleUploadFiles(files) {
  for (const file of files) {
    await processUploadFile(file);
  }
}

async function processUploadFile(file) {
  showLoadingState(`読み取り中: ${file.name}`);
  try {
    if (state.uploadMode === 'manual') {
      const blankDraft = createBlankDraft(file);
      openEditorModal(blankDraft, { fromUpload: true, rawWarnings: ['手動登録モードです。'] });
      return;
    }
    await ensureOcrReady();
    const catalog = state.catalog || await loadMusicCatalog();
    const result = await readResultImage(file, catalog, (progress) => {
      const stepMap = {
        title: 'タイトルを読み取り中',
        'level-difficulty': 'レベルと難易度を確認中',
        result: 'リザルトを読み取り中',
      };
      dom.appSubtitle.textContent = `${stepMap[progress.step] || '読み取り中'}…`;
    });

    const baseDraft = result.draft;
    const draft = createDraftFromOcr(baseDraft, file);
    openEditorModal(draft, { fromUpload: true, rawWarnings: result.warnings || [] });
  } catch (error) {
    console.error(error);
    showToast(error.message || '画像の読み取りに失敗しました。', 'danger', '読み取り失敗');
    const blankDraft = createBlankDraft(file);
    openEditorModal(blankDraft, { fromUpload: true, rawWarnings: [error.message || '読み取りに失敗しました。'] });
  } finally {
    hideLoadingState();
  }
}

function createBlankDraft(file) {
  return {
    id: createId('draft'),
    file,
    imageBlob: file,
    imageName: file.name,
    title: '',
    pronunciation: '',
    musicId: null,
    playLevel: null,
    difficulty: 'MASTER',
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    miss: 0,
    combo: null,
    score: null,
    apMiss: 0,
    apTournamentMiss: 0,
    fcMiss: 0,
    totalNoteCount: 0,
    apDone: false,
    fcDone: false,
    needsReview: true,
    warnings: ['手動で入力してください。'],
    manual: true,
    createdAt: Date.now(),
  };
}

function createDraftFromOcr(draft, file) {
  return {
    id: createId('draft'),
    file,
    imageBlob: file,
    imageName: file.name,
    manual: state.uploadMode === 'manual',
    ...draft,
    createdAt: Date.now(),
  };
}

function openPreviewModal(record) {
  state.selectedId = record.id;
  const html = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <h2>${escapeHtml(record.title || '未設定')}</h2>
            <p>${escapeHtml(record.difficulty || '-') } / Lv. ${escapeHtml(String(record.playLevel ?? '-'))}</p>
          </div>
          <button class="icon-btn" data-close-modal type="button"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body">
          <div class="modal-grid">
            <div class="preview-frame">
              <img src="${escapeHtml(getThumbnailSource(record))}" alt="${escapeHtml(record.title || 'リザルト画像')}" />
            </div>
            <div class="edit-form">
              ${renderRecordSummary(record)}
              <div class="modal-actions">
                <button class="btn btn-ghost" type="button" id="previewEdit"><i data-lucide="pencil"></i><span>${record.trashedAt ? '戻す' : '編集'}</span></button>
                <button class="btn btn-ghost" type="button" id="previewTrash"><i data-lucide="trash-2"></i><span>${record.trashedAt ? '今すぐ削除' : 'ゴミ箱へ'}</span></button>
                <button class="btn btn-primary" type="button" data-close-modal><i data-lucide="check"></i><span>閉じる</span></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  dom.modalRoot.innerHTML = html;
  renderIconSet();
  if (record.trashedAt) {
    dom.modalRoot.querySelector('#previewEdit').addEventListener('click', () => restoreRecord(record));
    dom.modalRoot.querySelector('#previewTrash').addEventListener('click', () => deleteRecordNow(record));
  } else {
    dom.modalRoot.querySelector('#previewEdit').addEventListener('click', () => openEditorModal(record));
    dom.modalRoot.querySelector('#previewTrash').addEventListener('click', () => trashRecord(record));
  }
}

function renderRecordSummary(record) {
  return `
    <div class="info-card">
      <h3>記録</h3>
      <div class="stack">
        <div class="mini">スコア: ${escapeHtml(String(record.score ?? '-'))}</div>
        <div class="mini">コンボ: ${escapeHtml(String(record.combo ?? '-'))}</div>
        <div class="mini">PERFECT / GREAT / GOOD / BAD / MISS: ${escapeHtml([record.perfect, record.great, record.good, record.bad, record.miss].map((v) => v ?? '-').join(' / '))}</div>
        <div class="mini">AP基準: ${escapeHtml(String(getMissValue(record, 'ap')))} / 大会基準: ${escapeHtml(String(getMissValue(record, 'apTournament')))} / FC基準: ${escapeHtml(String(getMissValue(record, 'fc')))}</div>
        <div class="mini">AP済み: ${record.apDone ? 'はい' : 'いいえ'} / FC済み: ${record.fcDone ? 'はい' : 'いいえ'}</div>
        <div class="mini">追加日: ${escapeHtml(formatDateTime(record.createdAt))}</div>
        ${record.warnings?.length ? `<div class="mini" style="color:var(--warning)">注意: ${escapeHtml(record.warnings.join(' / '))}</div>` : ''}
      </div>
    </div>
  `;
}

function openEditorModal(record, options = {}) {
  const isDraft = String(record.id).startsWith('draft_');
  const hasImage = record.imageBlob instanceof Blob || record.imageDataUrl;
  const src = getThumbnailSource(record);
  const boxesHtml = Object.entries(getReadingOverlayBoxes()).map(([key, item]) => `
    <div class="overlay-box" style="left:${item.x * 100}%;top:${item.y * 100}%;width:${item.w * 100}%;height:${item.h * 100}%;border-color:${item.color}">
      <div class="overlay-label">${escapeHtml(item.label)}</div>
    </div>
  `).join('');

  const html = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <h2>${isDraft ? '画像の登録' : '記録の編集'}</h2>
            <p>${options.fromUpload ? '読み取り結果を確認してから保存してください。' : '必要な項目を編集して保存します。'}</p>
          </div>
          <button class="icon-btn" data-close-modal type="button"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body">
          <div class="modal-grid">
            <div>
              <div class="preview-frame">
                <img id="editorPreview" src="${escapeHtml(src)}" alt="編集対象" />
                ${boxesHtml}
              </div>
              <div class="form-actions" style="margin-top:12px;justify-content:flex-start">
                <label class="btn btn-ghost" for="replaceImage"><i data-lucide="image-plus"></i><span>画像を差し替え</span></label>
                <input id="replaceImage" type="file" accept="image/*" hidden />
                <button class="btn btn-ghost" type="button" id="btnReRead"><i data-lucide="wand-sparkles"></i><span>再読み取り</span></button>
              </div>
              <div class="status-line" id="editorWarnings"></div>
            </div>
            <div class="edit-form">
              <div class="edit-grid">
                <label class="field wide">
                  <span>楽曲名</span>
                  <input id="editTitle" type="text" value="${escapeHtml(record.title || '')}" placeholder="タイトルを入力" />
                </label>
                <label class="field">
                  <span>読み方</span>
                  <input id="editPronunciation" type="text" value="${escapeHtml(record.pronunciation || '')}" placeholder="読み方" />
                </label>
                <label class="field">
                  <span>楽曲レベル</span>
                  <input id="editLevel" type="number" min="1" max="99" value="${escapeHtml(String(record.playLevel ?? ''))}" />
                </label>
                <label class="field">
                  <span>楽曲難易度</span>
                  <select id="editDifficulty">
                    ${DIFFICULTIES.map((diff) => `<option value="${diff}" ${normalizeDifficulty(record.difficulty) === diff ? 'selected' : ''}>${diff}</option>`).join('')}
                  </select>
                </label>
                <label class="field">
                  <span>スコア</span>
                  <input id="editScore" type="number" min="0" value="${escapeHtml(String(record.score ?? ''))}" />
                </label>
                <label class="field">
                  <span>コンボ</span>
                  <input id="editCombo" type="number" min="0" value="${escapeHtml(String(record.combo ?? ''))}" />
                </label>
                <label class="field">
                  <span>PERFECT</span>
                  <input id="editPerfect" type="number" min="0" value="${escapeHtml(String(record.perfect ?? 0))}" />
                </label>
                <label class="field">
                  <span>GREAT</span>
                  <input id="editGreat" type="number" min="0" value="${escapeHtml(String(record.great ?? 0))}" />
                </label>
                <label class="field">
                  <span>GOOD</span>
                  <input id="editGood" type="number" min="0" value="${escapeHtml(String(record.good ?? 0))}" />
                </label>
                <label class="field">
                  <span>BAD</span>
                  <input id="editBad" type="number" min="0" value="${escapeHtml(String(record.bad ?? 0))}" />
                </label>
                <label class="field">
                  <span>MISS</span>
                  <input id="editMiss" type="number" min="0" value="${escapeHtml(String(record.miss ?? 0))}" />
                </label>
                <label class="field">
                  <span>備考</span>
                  <textarea id="editNote" rows="3" placeholder="任意">${escapeHtml(record.note || '')}</textarea>
                </label>
              </div>
              <div class="info-card">
                <h3>判定</h3>
                <div class="stack">
                  <div class="mini">AP基準: <strong id="calcAp">-</strong></div>
                  <div class="mini">大会基準: <strong id="calcTournament">-</strong></div>
                  <div class="mini">FC基準: <strong id="calcFc">-</strong></div>
                  <div class="mini">AP済み: <strong id="calcApDone">-</strong> / FC済み: <strong id="calcFcDone">-</strong></div>
                </div>
              </div>
              <div class="modal-actions">
                <button class="btn btn-ghost" type="button" id="btnCancelEditor"><i data-lucide="x"></i><span>閉じる</span></button>
                <button class="btn btn-ghost" type="button" id="btnSaveOnly"><i data-lucide="save"></i><span>保存</span></button>
                <button class="btn btn-primary" type="button" id="btnSaveAndDrive"><i data-lucide="cloud-upload"></i><span>保存してDriveへ</span></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  dom.modalRoot.innerHTML = html;
  renderIconSet();

  const warningsEl = dom.modalRoot.querySelector('#editorWarnings');
  if (options.rawWarnings?.length || record.warnings?.length) {
    warningsEl.innerHTML = `<div class="status-line" style="color:var(--warning)">注意: ${escapeHtml([...(options.rawWarnings || []), ...(record.warnings || [])].filter(Boolean).join(' / ') || 'なし')}</div>`;
  } else {
    warningsEl.textContent = '';
  }

  const fields = {
    title: dom.modalRoot.querySelector('#editTitle'),
    pronunciation: dom.modalRoot.querySelector('#editPronunciation'),
    level: dom.modalRoot.querySelector('#editLevel'),
    difficulty: dom.modalRoot.querySelector('#editDifficulty'),
    score: dom.modalRoot.querySelector('#editScore'),
    combo: dom.modalRoot.querySelector('#editCombo'),
    perfect: dom.modalRoot.querySelector('#editPerfect'),
    great: dom.modalRoot.querySelector('#editGreat'),
    good: dom.modalRoot.querySelector('#editGood'),
    bad: dom.modalRoot.querySelector('#editBad'),
    miss: dom.modalRoot.querySelector('#editMiss'),
    note: dom.modalRoot.querySelector('#editNote'),
  };

  const recalc = () => {
    const perfect = safeNumber(fields.perfect.value, 0);
    const great = safeNumber(fields.great.value, 0);
    const good = safeNumber(fields.good.value, 0);
    const bad = safeNumber(fields.bad.value, 0);
    const miss = safeNumber(fields.miss.value, 0);
    const ap = great + good + bad + miss;
    const tournament = great + good * 2 + bad * 3 + miss * 3;
    const fc = good + bad + miss;
    dom.modalRoot.querySelector('#calcAp').textContent = String(ap);
    dom.modalRoot.querySelector('#calcTournament').textContent = String(tournament);
    dom.modalRoot.querySelector('#calcFc').textContent = String(fc);
    dom.modalRoot.querySelector('#calcApDone').textContent = ap === 0 ? 'はい' : 'いいえ';
    dom.modalRoot.querySelector('#calcFcDone').textContent = fc === 0 ? 'はい' : 'いいえ';
    const title = fields.title.value.trim();
    const difficulty = normalizeDifficulty(fields.difficulty.value);
    const level = safeNumber(fields.level.value, null);
    if (title && level != null) {
      const match = findBestMusicMatch(state.catalog, title, { playLevel: level, musicDifficulty: difficulty });
      if (match?.song) {
        const info = getSongDifficultyInfo(state.catalog, match.song.id, difficulty);
        const conflict = info && level != null && info.playLevel != null && Number(info.playLevel) !== Number(level);
        warningsEl.innerHTML = `
          <div class="status-line">
            自動候補: <strong>${escapeHtml(match.song.title)}</strong> / 読み方 ${escapeHtml(match.song.pronunciation || '-')}
            ${conflict ? '<br /><span style="color:var(--warning)">レベルに矛盾があります。修正してください。</span>' : ''}
          </div>`;
      }
    }
  };

  for (const field of Object.values(fields)) field.addEventListener('input', recalc);
  recalc();

  const replaceInput = dom.modalRoot.querySelector('#replaceImage');
  replaceInput.addEventListener('change', async () => {
    const newFile = replaceInput.files?.[0];
    if (!newFile) return;
    const blobUrl = URL.createObjectURL(newFile);
    dom.modalRoot.querySelector('#editorPreview').src = blobUrl;
    record.imageBlob = newFile;
    record.imageName = newFile.name;
    showToast('画像を差し替えました。', 'success');
  });

  dom.modalRoot.querySelector('#btnReRead').addEventListener('click', async () => {
    const currentFile = record.imageBlob instanceof Blob ? record.imageBlob : null;
    if (!currentFile) {
      showToast('再読み取り用の画像がありません。', 'warning');
      return;
    }
    showLoadingState('再読み取り中…');
    try {
      const result = await readResultImage(currentFile, state.catalog);
      const newDraft = { ...record, ...result.draft };
      openEditorModal(newDraft, { fromUpload: false, rawWarnings: result.warnings || [] });
    } catch (error) {
      showToast(error.message || '再読み取りに失敗しました。', 'danger');
    } finally {
      hideLoadingState();
    }
  });

  dom.modalRoot.querySelector('#btnCancelEditor').addEventListener('click', closeModal);

  const saveBase = async (uploadToDrive) => {
    try {
      const saved = await saveEditorRecord(record, fields);
      closeModal();
      renderAll();
      if (uploadToDrive) {
        await syncRecordToDrive(saved);
      } else if (state.settings.autoUploadToDrive) {
        await syncRecordToDrive(saved);
      }
      showNotificationsForBest(saved);
    } catch (error) {
      console.error(error);
      showToast(error.message || '保存に失敗しました。', 'danger', '保存失敗');
    }
  };
  dom.modalRoot.querySelector('#btnSaveOnly').addEventListener('click', () => saveBase(false));
  dom.modalRoot.querySelector('#btnSaveAndDrive').addEventListener('click', () => saveBase(true));
}

async function saveEditorRecord(record, fields) {
  const updated = normalizeRecordShape({
    ...record,
    id: record.id || createId('record'),
    title: fields.title.value.trim(),
    pronunciation: fields.pronunciation.value.trim(),
    playLevel: fields.level.value === '' ? null : Number(fields.level.value),
    difficulty: normalizeDifficulty(fields.difficulty.value),
    score: fields.score.value === '' ? null : Number(fields.score.value),
    combo: fields.combo.value === '' ? null : Number(fields.combo.value),
    perfect: safeNumber(fields.perfect.value, 0),
    great: safeNumber(fields.great.value, 0),
    good: safeNumber(fields.good.value, 0),
    bad: safeNumber(fields.bad.value, 0),
    miss: safeNumber(fields.miss.value, 0),
    note: fields.note.value.trim(),
    updatedAt: Date.now(),
  });

  updated.apMiss = updated.great + updated.good + updated.bad + updated.miss;
  updated.apTournamentMiss = updated.great + updated.good * 2 + updated.bad * 3 + updated.miss * 3;
  updated.fcMiss = updated.good + updated.bad + updated.miss;
  updated.totalNoteCount = updated.perfect + updated.great + updated.good + updated.bad + updated.miss;
  updated.apDone = updated.apMiss === 0;
  updated.fcDone = updated.fcMiss === 0;
  updated.songKey = `${normalizeSearchText(updated.title)}|${updated.difficulty}|${updated.playLevel ?? ''}`;
  updated.needsReview = !updated.title || updated.playLevel == null || !updated.difficulty;
  updated.warnings = updated.warnings || [];
  updated.trashedAt = record.trashedAt || null;
  updated.imageBlob = record.imageBlob || null;
  updated.imageName = record.imageName || null;
  updated.manual = record.manual ?? false;

  if (updated.title && updated.playLevel != null && updated.difficulty && state.catalog) {
    const songMatch = findBestMusicMatch(state.catalog, updated.title, {
      playLevel: updated.playLevel,
      musicDifficulty: updated.difficulty,
    });
    const song = songMatch?.song;
    if (song) {
      updated.musicId = song.id;
      updated.pronunciation = updated.pronunciation || song.pronunciation || '';
      const info = getSongDifficultyInfo(state.catalog, song.id, updated.difficulty);
      if (info) {
        updated.playLevel = info.playLevel ?? updated.playLevel;
        updated.difficulty = normalizeDifficulty(info.musicDifficulty || updated.difficulty);
        if (info.totalNoteCount != null) updated.totalNoteCount = safeNumber(info.totalNoteCount, updated.totalNoteCount);
      }
    }
  }

  const saved = await saveRecord(updated);
  state.records = state.records.filter((item) => item.id !== saved.id).concat(normalizeRecordShape(saved));
  renderAll();
  return normalizeRecordShape(saved);
}

async function trashRecord(record) {
  const current = normalizeRecordShape({ ...record, trashedAt: Date.now(), updatedAt: Date.now() });
  if (current.driveFileId && state.driveToken) {
    try {
      await trashDriveFile(state.driveToken, current.driveFileId);
    } catch (error) {
      console.warn(error);
    }
  }
  await saveRecord(current);
  state.records = state.records.filter((item) => item.id !== current.id).concat(current);
  closeModal();
  renderAll();
  showToast('ゴミ箱に移動しました。', 'success');
}

async function restoreRecord(record) {
  const restored = normalizeRecordShape({ ...record, trashedAt: null, updatedAt: Date.now() });
  await saveRecord(restored);
  state.records = state.records.filter((item) => item.id !== restored.id).concat(restored);
  renderAll();
  showToast('記録を戻しました。', 'success');
}

async function deleteRecordNow(record) {
  const target = state.records.find((item) => item.id === record.id);
  if (target?.driveFileId && state.driveToken) {
    try {
      await deleteDriveFile(state.driveToken, target.driveFileId);
    } catch (error) {
      console.warn(error);
    }
  }
  await deleteRecord(record.id);
  state.records = state.records.filter((item) => item.id !== record.id);
  renderAll();
  showToast('完全削除しました。', 'success');
}

async function syncRecordToDrive(record) {
  if (!state.driveToken) {
    showToast('Google 連携が完了していません。', 'warning', 'Drive 未連携');
    return;
  }
  if (!(record.imageBlob instanceof Blob)) {
    showToast('画像がないため Drive へ送れません。', 'warning');
    return;
  }
  try {
    const folderId = await ensureDriveFolder(state.driveToken, state.settings.driveFolderName || APP_CONFIG.defaultDriveFolderName);
    const upload = await uploadFileToDrive(
      state.driveToken,
      new File([record.imageBlob], record.imageName || `result-${record.id}.png`, { type: record.imageBlob.type || 'image/png' }),
      folderId,
      { recordId: record.id, app: APP_CONFIG.name, version: APP_CONFIG.version },
    );
    const updated = normalizeRecordShape({
      ...record,
      driveFileId: upload.id,
      driveWebViewLink: upload.webViewLink || '',
      driveFolderId: folderId,
      updatedAt: Date.now(),
    });
    await saveRecord(updated);
    state.records = state.records.filter((item) => item.id !== updated.id).concat(updated);
    renderAll();
    showToast('Drive へアップロードしました。', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Drive への送信に失敗しました。', 'danger');
  }
}

async function connectGoogleDrive() {
  try {
    if (!state.settings.googleClientId) {
      openSettingsModal();
      showToast('Google Client ID を入力してください。', 'warning');
      return;
    }
    if (!window.google?.accounts?.oauth2) throw new Error('Google Identity Services の読み込みを待っています。');
    state.tokenClient = createDriveTokenClient(state.settings.googleClientId, async (response) => {
      if (response.error) {
        showToast(response.error_description || 'Google 連携に失敗しました。', 'danger');
        setDriveStatus('未連携', '認証失敗');
        return;
      }
      state.driveToken = response.access_token;
      setDriveStatus('連携中', 'Google Drive に接続済み');
      showToast('Google Drive に接続しました。', 'success');
      if (!state.settings.driveFolderId) {
        try {
          const folderId = await ensureDriveFolder(state.driveToken, state.settings.driveFolderName || APP_CONFIG.defaultDriveFolderName);
          state.settings.driveFolderId = folderId;
          await saveSetting('driveFolderId', folderId);
        } catch (error) {
          console.warn(error);
        }
      }
      renderAll();
    });
    state.tokenClient.requestAccessToken({ prompt: 'consent' });
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Google 連携に失敗しました。', 'danger');
  }
}

async function maybeRegisterDriveClient() {
  if (state.settings.googleClientId && window.google?.accounts?.oauth2) {
    try {
      state.tokenClient = createDriveTokenClient(state.settings.googleClientId, () => {});
      setDriveStatus('準備完了', 'Google アカウント連携を開始できます');
    } catch (error) {
      console.warn(error);
    }
  }
}

async function saveDriveSettings() {
  state.settings.driveFolderName = dom.driveFolderName.value.trim() || APP_CONFIG.defaultDriveFolderName;
  state.settings.googleClientId = dom.googleClientId.value.trim();
  await saveSetting('driveFolderName', state.settings.driveFolderName);
  await saveSetting('googleClientId', state.settings.googleClientId);
  await saveSetting('autoUploadToDrive', state.settings.autoUploadToDrive ?? false);
  showToast('設定を保存しました。', 'success');
  maybeRegisterDriveClient();
  renderAll();
}

async function refreshAll(force = false) {
  showLoadingState('更新中…');
  try {
    if (force) state.catalog = await loadMusicCatalog(true);
    state.records = await loadRecords();
    state.records = state.records.map(normalizeRecordShape);
    await cleanupExpiredTrash();
    renderAll();
    showToast('更新しました。', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || '更新に失敗しました。', 'danger');
  } finally {
    hideLoadingState();
  }
}

async function cleanupExpiredTrash() {
  const now = Date.now();
  const expired = state.records.filter((record) => record.trashedAt && daysBetween(record.trashedAt, now) >= APP_CONFIG.trashDays);
  if (!expired.length) return;
  for (const record of expired) {
    try {
      if (record.driveFileId && state.driveToken) {
        await deleteDriveFile(state.driveToken, record.driveFileId);
      }
    } catch (error) {
      console.warn(error);
    }
    try {
      await deleteRecord(record.id);
    } catch (error) {
      console.warn(error);
    }
  }
  state.records = state.records.filter((record) => !(record.trashedAt && daysBetween(record.trashedAt, now) >= APP_CONFIG.trashDays));
  renderAll();
}

function scheduleCleanupLoop() {
  if (state.refreshScheduled) return;
  state.refreshScheduled = true;
  setInterval(async () => {
    await cleanupExpiredTrash();
  }, 1000 * 60 * 30);
}

function showNotificationsForBest(record) {
  const sameKey = state.records.filter((item) => !item.trashedAt && item.id !== record.id && item.songKey === record.songKey);
  if (!sameKey.length) {
    showToast('最初の記録として保存されました。', 'success', '新規登録');
    return;
  }
  const modes = ['ap', 'apTournament', 'fc'];
  const improvements = [];
  for (const mode of modes) {
    const thisValue = getMissValue(record, mode);
    const best = Math.min(...sameKey.map((item) => getMissValue(item, mode)));
    if (thisValue < best) improvements.push(getMissModeMeta(mode).label);
  }
  if (improvements.length) {
    showToast(`自己ベストを更新しました: ${improvements.join(' / ')}`, 'success', '更新通知');
    notifyDesktop(`自己ベスト更新`, `${record.title || '未設定'} が ${improvements.join(' / ')} で自己ベストを更新しました。`);
  }
}

function notifyDesktop(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') new Notification(title, { body });
    });
  }
}

function showToast(text, type = 'info', title = '') {
  const root = dom.toastRoot;
  const node = document.createElement('div');
  node.className = 'toast';
  node.dataset.type = type;
  node.innerHTML = `
    <div class="toast-icon"><i data-lucide="${type === 'danger' ? 'triangle-alert' : type === 'warning' ? 'circle-alert' : 'circle-check'}"></i></div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title || (type === 'success' ? '完了' : type === 'warning' ? '注意' : type === 'danger' ? 'エラー' : '通知'))}</div>
      <div class="toast-text">${escapeHtml(text)}</div>
    </div>
    <button class="icon-btn" data-toast-close type="button"><i data-lucide="x"></i></button>
  `;
  root.appendChild(node);
  renderIconSet();
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 250);
  }, 3600);
}

function closeModal() {
  dom.modalRoot.innerHTML = '';
}

function openSettingsModal() {
  dom.modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(860px,100%)">
        <div class="modal-head">
          <div>
            <h2>設定</h2>
            <p>Google 連携や保存先の基本設定を管理します。</p>
          </div>
          <button class="icon-btn" data-close-modal type="button"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body">
          <div class="edit-form">
            <div class="edit-grid">
              <label class="field wide">
                <span>Google OAuth Client ID</span>
                <input id="settingsClientId" type="text" value="${escapeHtml(state.settings.googleClientId || '')}" placeholder="xxxxxxxx.apps.googleusercontent.com" />
              </label>
              <label class="field wide">
                <span>Google Drive フォルダ名</span>
                <input id="settingsFolderName" type="text" value="${escapeHtml(state.settings.driveFolderName || APP_CONFIG.defaultDriveFolderName)}" />
              </label>
              <label class="field wide">
                <span>自動でDriveへ送る</span>
                <select id="settingsAutoDrive">
                  <option value="true" ${state.settings.autoUploadToDrive ? 'selected' : ''}>有効</option>
                  <option value="false" ${!state.settings.autoUploadToDrive ? 'selected' : ''}>無効</option>
                </select>
              </label>
            </div>
            <div class="helper-box">
              <h3>補足</h3>
              <ul>
                <li>Google Cloud 側で Web アプリの OAuth クライアントを作成し、この画面に Client ID を貼り付けてください。</li>
                <li>Drive 連携はこのアプリが作成したファイルの管理に使います。</li>
                <li>ゴミ箱の3日削除は、アプリを開いた時に自動実行されます。</li>
              </ul>
            </div>
            <div class="modal-actions">
              <button class="btn btn-ghost" type="button" data-close-modal><i data-lucide="x"></i><span>閉じる</span></button>
              <button class="btn btn-primary" type="button" id="btnSaveSettingsModal"><i data-lucide="save"></i><span>保存</span></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  renderIconSet();
  dom.modalRoot.querySelector('#btnSaveSettingsModal').addEventListener('click', async () => {
    state.settings.googleClientId = dom.modalRoot.querySelector('#settingsClientId').value.trim();
    state.settings.driveFolderName = dom.modalRoot.querySelector('#settingsFolderName').value.trim() || APP_CONFIG.defaultDriveFolderName;
    state.settings.autoUploadToDrive = dom.modalRoot.querySelector('#settingsAutoDrive').value === 'true';
    await saveSetting('googleClientId', state.settings.googleClientId);
    await saveSetting('driveFolderName', state.settings.driveFolderName);
    await saveSetting('autoUploadToDrive', state.settings.autoUploadToDrive);
    maybeRegisterDriveClient();
    closeModal();
    renderAll();
    showToast('設定を保存しました。', 'success');
  });
}

function openHelpModal() {
  dom.modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(920px,100%)">
        <div class="modal-head">
          <div>
            <h2>読み取りの見方</h2>
            <p>画像のどの部分を見ているかを確認できます。</p>
          </div>
          <button class="icon-btn" data-close-modal type="button"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body">
          <div class="helper-box">
            <h3>自動読み取りの流れ</h3>
            <ul>
              <li>左上のタイトルを読み取り、近い楽曲名へ補正します。</li>
              <li>タイトル下のレベルと難易度を照合し、矛盾があれば再読み取りします。</li>
              <li>中央左のリザルト欄と中央付近のコンボを読み取り、合計ノーツ数を検算します。</li>
              <li>合わない場合は下書きとして保存し、後から手動で修正できます。</li>
            </ul>
          </div>
          <div class="helper-box" style="margin-top:12px">
            <h3>一覧の並び替え</h3>
            <ul>
              <li>楽曲名順: 名前 → 難易度 → ミス数 → 追加日</li>
              <li>楽曲レベル順: レベル → 難易度 → 名前 → ミス数 → 追加日</li>
              <li>ミス数順: ミス数 → レベル → 難易度 → 名前 → 追加日</li>
              <li>追加日順: 追加日</li>
            </ul>
          </div>
          <div class="modal-actions">
            <button class="btn btn-primary" type="button" data-close-modal><i data-lucide="check"></i><span>閉じる</span></button>
          </div>
        </div>
      </div>
    </div>
  `;
  renderIconSet();
}

