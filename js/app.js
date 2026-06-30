import { DEFAULT_SETTINGS, DIFFICULTIES, BASIS_MODES } from './constants.js';
import { loadMusicDb, getDifficultyRow, getMusicById, getDifficultyLabel, getDiffOrder, resolveMusicInfo, findBestMusicMatch } from './db.js';
import { getAllRecords, upsertRecord, upsertRecords, deleteRecord, getAllTemplates, getTemplate, upsertTemplate, deleteTemplate, seedTemplatesIfEmpty, getSettings, saveSettings, exportAllData, importAllData } from './storage.js';
import { initDriveClient, signInDrive, signOutDrive, isDriveSignedIn, listDriveRecords, uploadRecordToDrive, updateDriveRecord, trashDriveRecord, restoreDriveRecord, deleteDriveRecord, getDriveFileBlob, getRootFolderId, driveConnectedLabel } from './drive.js';
import { analyzeResultImage, composeRecordFromDraft, recalculateDraftMetrics, buildValidationMessages, createEmptyDraft, makePreviewDataUrl } from './ocr.js';
import { APP_VERSION, MAX_TRASH_DAYS } from './config.js';
import { clamp, deepClone, downloadJson, escapeText, formatDateTime, getBasisMetric, getStatusByBasis, normalizeText, numberOrNull, nowISO, uid, wait } from './utils.js';

const state = {
  ready: false,
  records: [],
  templates: [],
  settings: { ...DEFAULT_SETTINGS },
  musicLoaded: false,
  activeTab: 'library',
  filtered: [],
  bestMap: new Map(),
  imageUrlCache: new Map(),
  editor: null,
  templateEditor: null,
  isSyncing: false,
};

const els = {};
let listRaf = 0;

function $(id) { return document.getElementById(id); }

function initEls() {
  [
    'btnConnectDrive','btnSyncDrive','btnUpload','driveStatus','filterQuery','filterLevel','filterDifficulty','filterStatus','basisMode','viewMode','sortKey','sortDir','apMissMin','apMissMax','tournamentMissMin','tournamentMissMax','fcMissMin','fcMissMax','onlyPlayable','showTrash','btnTemplates','btnExport','importJson','tabLibrary','tabTrash','statCount','statAp','statFc','statBest','listEmpty','listViewport','listSpacerTop','listItems','listSpacerBottom','trashFooter','trashInfo','btnPurgeTrash','toastContainer','editorModal','editorTitle','editorSubtitle','btnCloseEditor','registerModeAuto','registerModeManual','btnAnalyzeQueue','btnSaveQueue','queueList','editorPreview','templateOverlay','recordTitle','recordPronunciation','recordLevel','recordDifficulty','countPerfect','countGreat','countGood','countBad','countMiss','recordCombo','recordTotalNotes','recordSource','validationBox','metricAp','metricTournament','metricFc','templateModal','btnCloseTemplate','btnTemplates','templateList','btnAddTemplate','templateName','templateAspect','templateImageInput','templatePreviewImage','templatePreviewOverlay','btnCloneTemplate','btnDeleteTemplate','btnSaveTemplate'
  ].forEach((id) => { els[id] = $(id); });
}

function showToast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? 'check_circle' : type === 'warn' ? 'warning' : type === 'info' ? 'info' : 'notifications';
  el.innerHTML = `<span class="material-symbols-outlined">${icon}</span><div class="text">${escapeText(message)}</div>`;
  els.toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }, 3000);
  setTimeout(() => el.remove(), 3600);
}

function currentBasis() { return BASIS_MODES[state.settings.basisMode] || BASIS_MODES.ap; }

function getRecordMetric(record, basisMode = state.settings.basisMode) {
  return getBasisMetric(record, basisMode);
}

function isPlayable(record) {
  return Boolean(record?.apDone || record?.fcDone);
}

function getRecordKey(record) {
  const musicId = record.musicId ?? '';
  const title = normalizeText(record.title || '');
  return `${musicId || title}__${String(record.level || '').trim()}__${String(record.difficulty || '').trim().toLowerCase()}`;
}

function compareForBasis(a, b, basisMode) {
  const ma = getRecordMetric(a, basisMode);
  const mb = getRecordMetric(b, basisMode);
  if (ma !== mb) return ma - mb;
  if ((a.perfect ?? 0) !== (b.perfect ?? 0)) return (b.perfect ?? 0) - (a.perfect ?? 0);
  if ((a.combo ?? -1) !== (b.combo ?? -1)) return (b.combo ?? -1) - (a.combo ?? -1);
  if ((a.createdAt ?? '') !== (b.createdAt ?? '')) return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
  return String(a.id).localeCompare(String(b.id));
}

function getBestMap(records = state.records, basisMode = state.settings.basisMode) {
  const map = new Map();
  const groups = new Map();
  for (const record of records) {
    if (record.deletedAt) continue;
    const key = getRecordKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const [key, group] of groups.entries()) {
    const best = group.slice().sort((a, b) => compareForBasis(a, b, basisMode))[0];
    if (best) map.set(key, best.id);
  }
  return map;
}

function applyFilters(records) {
  const f = state.settings;
  const basis = currentBasis().key;
  const query = normalizeText(f.filterQuery || '');
  const levelQuery = String(f.filterLevel || '').trim();
  const status = f.filterStatus;
  const difficulty = String(f.filterDifficulty || '').toLowerCase();

  let list = records.slice();
  if (state.activeTab === 'trash' || f.showTrash) {
    list = list.filter((r) => Boolean(r.deletedAt));
  } else {
    list = list.filter((r) => !r.deletedAt);
  }
  if (query) {
    list = list.filter((r) => {
      const hay = normalizeText([r.title, r.pronunciation, r.musicId, r.level, r.difficulty].filter(Boolean).join(' '));
      return hay.includes(query);
    });
  }
  if (levelQuery) list = list.filter((r) => String(r.level ?? '').includes(levelQuery));
  if (difficulty) list = list.filter((r) => String(r.difficulty || '').toLowerCase() === difficulty);

  if (status === 'ap') list = list.filter((r) => (basis === 'tournament' ? r.tournamentMiss : r.apMiss) === 0);
  if (status === 'fc') list = list.filter((r) => r.fcMiss === 0);
  if (status === 'best' || f.viewMode === 'best') {
    const best = getBestMap(list, basis);
    list = list.filter((r) => best.get(getRecordKey(r)) === r.id);
  }
  if (f.onlyPlayable) list = list.filter((r) => isPlayable(r));

  const minMax = {
    ap: [numberOrNull(f.apMissMin), numberOrNull(f.apMissMax)],
    tournament: [numberOrNull(f.tournamentMissMin), numberOrNull(f.tournamentMissMax)],
    fc: [numberOrNull(f.fcMissMin), numberOrNull(f.fcMissMax)],
  };
  list = list.filter((r) => {
    const values = {
      ap: r.apMiss,
      tournament: r.tournamentMiss,
      fc: r.fcMiss,
    };
    return Object.entries(minMax).every(([key, [min, max]]) => {
      const value = values[key];
      if (min != null && value < min) return false;
      if (max != null && value > max) return false;
      return true;
    });
  });

  list.sort((a, b) => sortRecords(a, b));
  state.bestMap = getBestMap(list, basis);
  return list;
}

function compareText(a, b, dir = 'asc') {
  const cmp = String(a ?? '').localeCompare(String(b ?? ''), 'ja');
  return dir === 'desc' ? -cmp : cmp;
}

function sortRecords(a, b) {
  const { sortKey, sortDir } = state.settings;
  const dir = sortDir === 'desc' ? -1 : 1;
  if (sortKey === 'title') {
    return dir * compareText(a.title, b.title, 'asc')
      || compareText(a.difficulty, b.difficulty, 'asc')
      || (getRecordMetric(a) - getRecordMetric(b))
      || compareText(a.createdAt, b.createdAt, 'asc');
  }
  if (sortKey === 'level') {
    const lvA = Number(a.level ?? 0);
    const lvB = Number(b.level ?? 0);
    return dir * ((lvA - lvB) || 0)
      || compareText(a.difficulty, b.difficulty, 'asc')
      || compareText(a.title, b.title, 'asc')
      || (getRecordMetric(a) - getRecordMetric(b))
      || compareText(a.createdAt, b.createdAt, 'asc');
  }
  if (sortKey === 'miss') {
    const basis = currentBasis().key;
    return dir * (getRecordMetric(a, basis) - getRecordMetric(b, basis))
      || ((Number(a.level ?? 0) - Number(b.level ?? 0)))
      || compareText(a.difficulty, b.difficulty, 'asc')
      || compareText(a.title, b.title, 'asc')
      || compareText(a.createdAt, b.createdAt, 'asc');
  }
  return dir * compareText(a.createdAt, b.createdAt, 'asc');
}

function updateStats() {
  const visible = state.filtered.filter((r) => !r.deletedAt);
  const trash = state.records.filter((r) => r.deletedAt);
  const ap = visible.filter((r) => r.apDone).length;
  const fc = visible.filter((r) => r.fcDone).length;
  const basis = currentBasis().key;
  const best = getBestMap(visible, basis);
  els.statCount.textContent = String(visible.length);
  els.statAp.textContent = String(ap);
  els.statFc.textContent = String(fc);
  els.statBest.textContent = String(best.size);
  els.trashInfo.textContent = `ゴミ箱 ${trash.length} 件 / ${MAX_TRASH_DAYS} 日で自動削除`;
}

function recordImageSrc(record) {
  if (record.imageBlob instanceof Blob) {
    if (!state.imageUrlCache.has(record.id)) {
      state.imageUrlCache.set(record.id, URL.createObjectURL(record.imageBlob));
    }
    return state.imageUrlCache.get(record.id);
  }
  if (record.thumbnailDataUrl) return record.thumbnailDataUrl;
  if (record.driveThumbLink) return record.driveThumbLink;
  return '';
}

function renderRecordCard(record) {
  const basis = currentBasis().key;
  const metric = getRecordMetric(record, basis);
  const bestId = state.bestMap.get(getRecordKey(record));
  const isBest = bestId === record.id;
  const status = getStatusByBasis(record, basis);
  const diff = String(record.difficulty || '').toLowerCase();
  const coverBadgeClass = record.deletedAt ? 'trash' : (status.ap ? 'ap' : status.fc ? 'fc' : 'trash');
  const coverBadgeText = record.deletedAt ? '削除済み' : status.ap ? 'AP' : status.fc ? 'FC' : '未達成';
  const imageSrc = recordImageSrc(record);
  const updated = formatDateTime(record.updatedAt || record.createdAt);
  const metricText = basis === 'tournament' ? `大会基準 ${record.tournamentMiss ?? 0}` : basis === 'fc' ? `FC 基準 ${record.fcMiss ?? 0}` : `AP 基準 ${record.apMiss ?? 0}`;
  const bestNote = isBest ? `<div class="best-note"><strong>自己ベスト</strong> この曲・難易度の ${currentBasis().label} で最良です。</div>` : '';
  const warnings = (record.validationMessages || []).slice(0, 2).map((w) => `<div class="validation-line">${escapeText(w)}</div>`).join('');
  const tags = `
    <span class="chip level">Lv ${escapeText(record.level ?? '')}</span>
    <span class="chip diff ${escapeText(diff)}">${escapeText(getDifficultyLabel(diff))}</span>
    <span class="chip badge">${escapeText(metricText)}</span>
    <span class="chip badge">AP ${record.apMiss ?? 0}</span>
    <span class="chip badge">大会 ${record.tournamentMiss ?? 0}</span>
    <span class="chip badge">FC ${record.fcMiss ?? 0}</span>
  `;
  const stats = `
    <div class="stat-box"><div class="label">PERFECT</div><div class="value">${record.perfect ?? 0}</div></div>
    <div class="stat-box"><div class="label">GREAT / GOOD / BAD / MISS</div><div class="value">${record.great ?? 0} / ${record.good ?? 0} / ${record.bad ?? 0} / ${record.miss ?? 0}</div></div>
    <div class="stat-box"><div class="label">COMBO / 総ノーツ</div><div class="value">${record.combo ?? '-'} / ${record.totalNotes ?? '-'}</div></div>
  `;
  const actions = record.deletedAt
    ? `<button class="icon-pill" data-action="restore" data-id="${record.id}" title="復元"><span class="material-symbols-outlined">restore_from_trash</span></button>
       <button class="icon-pill" data-action="purge" data-id="${record.id}" title="完全削除"><span class="material-symbols-outlined">delete_forever</span></button>`
    : `<button class="icon-pill" data-action="edit" data-id="${record.id}" title="編集"><span class="material-symbols-outlined">edit</span></button>
       <button class="icon-pill" data-action="trash" data-id="${record.id}" title="ゴミ箱へ"><span class="material-symbols-outlined">delete</span></button>`;

  return `
    <article class="record-card" data-id="${record.id}">
      <div class="record-cover">
        ${imageSrc ? `<img src="${imageSrc}" alt="${escapeText(record.title || '')}">` : ''}
        <div class="cover-badge ${coverBadgeClass}">${escapeText(coverBadgeText)}</div>
      </div>
      <div class="record-main">
        <div class="record-header">
          <div class="record-title">${escapeText(record.title || '未設定')}</div>
          ${isBest ? '<span class="chip badge">最良</span>' : ''}
        </div>
        <div class="record-meta">${tags}</div>
        <div class="record-stats">${stats}</div>
        <div class="record-footer">
          <div class="timestamp">${escapeText(updated || '')}</div>
          <div class="metrics-inline">
            <span class="chip badge">${status.ap ? 'AP' : 'AP なし'}</span>
            <span class="chip badge">${status.fc ? 'FC' : 'FC なし'}</span>
          </div>
        </div>
      </div>
      <div class="record-side">
        <div class="action-row">${actions}</div>
        <div>
          ${bestNote}
          ${warnings}
        </div>
      </div>
    </article>
  `;
}

function renderListSoon() {
  cancelAnimationFrame(listRaf);
  listRaf = requestAnimationFrame(() => renderList());
}

function renderList() {
  state.filtered = applyFilters(state.records);
  updateStats();
  const list = state.filtered;
  const empty = list.length === 0;
  els.listEmpty.hidden = !empty;
  els.trashFooter.hidden = state.activeTab !== 'trash';
  if (empty) {
    els.listItems.innerHTML = '';
    els.listSpacerTop.style.height = '0px';
    els.listSpacerBottom.style.height = '0px';
    return;
  }

  const viewport = els.listViewport;
  const itemHeight = window.innerWidth < 881 ? 260 : 194;
  const gap = 12;
  const rowHeight = itemHeight + gap;
  const scrollTop = viewport.scrollTop;
  const viewHeight = viewport.clientHeight || 800;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 3);
  const end = Math.min(list.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + 3);
  const visible = list.slice(start, end);
  els.listSpacerTop.style.height = `${start * rowHeight}px`;
  els.listSpacerBottom.style.height = `${Math.max(0, (list.length - end) * rowHeight)}px`;
  els.listItems.innerHTML = visible.map((record) => renderRecordCard(record)).join('');
}

function setSettingsFromUI() {
  state.settings.filterQuery = els.filterQuery.value;
  state.settings.filterLevel = els.filterLevel.value;
  state.settings.filterDifficulty = els.filterDifficulty.value;
  state.settings.filterStatus = els.filterStatus.value;
  state.settings.basisMode = els.basisMode.value;
  state.settings.viewMode = els.viewMode.value;
  state.settings.sortKey = els.sortKey.value;
  state.settings.sortDir = els.sortDir.value;
  state.settings.apMissMin = els.apMissMin.value;
  state.settings.apMissMax = els.apMissMax.value;
  state.settings.tournamentMissMin = els.tournamentMissMin.value;
  state.settings.tournamentMissMax = els.tournamentMissMax.value;
  state.settings.fcMissMin = els.fcMissMin.value;
  state.settings.fcMissMax = els.fcMissMax.value;
  state.settings.onlyPlayable = els.onlyPlayable.checked;
  state.settings.showTrash = els.showTrash.checked;
}

function applySettingsToUI() {
  els.filterQuery.value = state.settings.filterQuery || '';
  els.filterLevel.value = state.settings.filterLevel || '';
  els.filterDifficulty.value = state.settings.filterDifficulty || '';
  els.filterStatus.value = state.settings.filterStatus || '';
  els.basisMode.value = state.settings.basisMode || 'ap';
  els.viewMode.value = state.settings.viewMode || 'all';
  els.sortKey.value = state.settings.sortKey || 'title';
  els.sortDir.value = state.settings.sortDir || 'asc';
  els.apMissMin.value = state.settings.apMissMin ?? '';
  els.apMissMax.value = state.settings.apMissMax ?? '';
  els.tournamentMissMin.value = state.settings.tournamentMissMin ?? '';
  els.tournamentMissMax.value = state.settings.tournamentMissMax ?? '';
  els.fcMissMin.value = state.settings.fcMissMin ?? '';
  els.fcMissMax.value = state.settings.fcMissMax ?? '';
  els.onlyPlayable.checked = Boolean(state.settings.onlyPlayable);
  els.showTrash.checked = Boolean(state.settings.showTrash);
  const auto = state.settings.registerMode === 'manual' ? els.registerModeManual : els.registerModeAuto;
  auto.classList.add('active');
  (auto === els.registerModeAuto ? els.registerModeManual : els.registerModeAuto).classList.remove('active');
}

async function persistSettings() {
  await saveSettings(state.settings);
}

async function refreshDataFromStorage() {
  const [records, templates, settings] = await Promise.all([getAllRecords(), seedTemplatesIfEmpty(), getSettings()]);
  state.records = records || [];
  state.templates = templates || [];
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  applySettingsToUI();
  state.activeTab = state.settings.showTrash ? 'trash' : 'library';
  els.tabLibrary.classList.toggle('active', state.activeTab === 'library');
  els.tabTrash.classList.toggle('active', state.activeTab === 'trash');
  renderTemplateList();
  renderTemplateEditor();
  renderListSoon();
}

function openModal(modal) { modal.hidden = false; document.body.style.overflow = 'hidden'; }
function closeModal(modal) { modal.hidden = true; document.body.style.overflow = ''; }

function openEditorModal(title, subtitle) {
  els.editorTitle.textContent = title;
  els.editorSubtitle.textContent = subtitle;
  openModal(els.editorModal);
}

function closeEditorModal() {
  closeModal(els.editorModal);
  state.editor = null;
}

function openTemplateModal() { openModal(els.templateModal); }
function closeTemplateModal() { closeModal(els.templateModal); }

function editorCurrentItem() {
  if (!state.editor) return null;
  return state.editor.queue[state.editor.activeIndex] || null;
}

function recalculateEditorMetrics() {
  const item = editorCurrentItem();
  if (!item) return;
  recalculateDraftMetrics(item.draft);
  els.metricAp.textContent = String(item.draft.apMiss ?? 0);
  els.metricTournament.textContent = String(item.draft.tournamentMiss ?? 0);
  els.metricFc.textContent = String(item.draft.fcMiss ?? 0);
}

function updateEditorFormFromDraft(draft) {
  els.recordTitle.value = draft.title || '';
  els.recordPronunciation.value = draft.pronunciation || '';
  els.recordLevel.value = draft.level || '';
  els.recordDifficulty.value = draft.difficulty || 'master';
  els.countPerfect.value = draft.perfect ?? 0;
  els.countGreat.value = draft.great ?? 0;
  els.countGood.value = draft.good ?? 0;
  els.countBad.value = draft.bad ?? 0;
  els.countMiss.value = draft.miss ?? 0;
  els.recordCombo.value = draft.combo ?? '';
  els.recordTotalNotes.value = draft.totalNotes ?? '';
  els.recordSource.value = draft.source || 'auto';
  recalculateEditorMetrics();
  const messages = draft.validationMessages || draft.warnings || [];
  els.validationBox.innerHTML = messages.length
    ? messages.map((m) => `<div class="validation-line">${escapeText(m)}</div>`).join('')
    : '<div class="validation-line">問題は見つかっていません。</div>';
}

function loadPreviewIntoEditor(item) {
  if (!item) return;
  const src = item.previewUrl || item.record?.imageBlob instanceof Blob ? recordImageSrc(item.record) : item.previewUrl;
  if (src) els.editorPreview.src = src;
  else els.editorPreview.removeAttribute('src');
}

function renderEditorQueue() {
  if (!state.editor) return;
  els.queueList.innerHTML = state.editor.queue.map((item, index) => {
    const active = index === state.editor.activeIndex ? 'active' : '';
    const status = item.status || '待機';
    const cls = item.error ? 'err' : item.warnings?.length ? 'warn' : item.ready ? 'ok' : '';
    return `
      <button class="queue-item ${active}" type="button" data-queue-index="${index}">
        <img class="queue-thumb" src="${item.previewUrl || ''}" alt="">
        <div style="min-width:0">
          <div class="queue-title">${escapeText(item.draft?.title || item.fileName || item.record?.title || '未設定')}</div>
          <div class="queue-sub">${escapeText(item.draft?.level || item.record?.level || '')} / ${escapeText(getDifficultyLabel(item.draft?.difficulty || item.record?.difficulty || ''))}</div>
        </div>
        <div class="queue-status ${cls}">${escapeText(status)}</div>
      </button>
    `;
  }).join('');
  const item = editorCurrentItem();
  if (item) updateEditorFormFromDraft(item.draft);
  if (item) {
    if (item.previewUrl) els.editorPreview.src = item.previewUrl;
    renderEditorOverlay();
  }
}

function renderEditorOverlay() {
  const item = editorCurrentItem();
  if (!item || !state.templates.length) return;
  const template = state.templates.find((t) => t.id === (item.templateId || state.settings.activeTemplateId)) || state.templates[0];
  if (!template || !els.editorPreview?.naturalWidth) {
    els.templateOverlay.innerHTML = '';
    return;
  }
  const width = els.editorPreview.clientWidth || 1;
  const height = els.editorPreview.clientHeight || 1;
  els.templateOverlay.innerHTML = Object.entries(template.regions).map(([key, region]) => {
    const color = region.color || '#f00';
    const x = region.x * width;
    const y = region.y * height;
    const w = region.w * width;
    const h = region.h * height;
    const label = { title: 'タイトル', level: 'レベル', difficulty: '難易度', result: 'リザルト', combo: 'コンボ' }[key] || key;
    return `<div class="region-box" style="left:${x}px; top:${y}px; width:${w}px; height:${h}px; color:${color}"><div class="tag">${label}</div></div>`;
  }).join('');
}

function loadDraftFromForm(item) {
  if (!item) return;
  const d = item.draft;
  d.title = els.recordTitle.value.trim();
  d.pronunciation = els.recordPronunciation.value.trim();
  d.level = els.recordLevel.value.trim();
  d.difficulty = els.recordDifficulty.value;
  d.perfect = Number(els.countPerfect.value || 0);
  d.great = Number(els.countGreat.value || 0);
  d.good = Number(els.countGood.value || 0);
  d.bad = Number(els.countBad.value || 0);
  d.miss = Number(els.countMiss.value || 0);
  d.combo = numberOrNull(els.recordCombo.value);
  d.totalNotes = numberOrNull(els.recordTotalNotes.value);
  d.source = els.recordSource.value;
  recalculateDraftMetrics(d);
  d.validationMessages = buildValidationMessages(d, item.expected || null);
  item.ready = true;
}

function setEditorMode(mode) {
  state.settings.registerMode = mode;
  els.registerModeAuto.classList.toggle('active', mode === 'auto');
  els.registerModeManual.classList.toggle('active', mode === 'manual');
  persistSettings();
}

async function analyzeQueueIndex(index, rerun = false) {
  const item = state.editor?.queue[index];
  if (!item) return;
  item.status = '解析中';
  item.warnings = [];
  item.error = '';
  renderEditorQueue();
  try {
    const template = state.templates.find((t) => t.id === item.templateId) || state.templates[0];
    const source = item.file instanceof Blob ? item.file : item.record?.imageBlob || null;
    if (!source) throw new Error('画像データがありません');
    const analysis = await analyzeResultImage(source, template, { fileName: item.fileName || item.record?.title || '' , forcedPadding: rerun ? 0.01 : 0 });
    const draft = createEmptyDraft(template.id);
    draft.title = analysis.title || '';
    draft.pronunciation = analysis.pronunciation || '';
    draft.musicId = analysis.musicId ?? null;
    draft.level = analysis.level || '';
    draft.difficulty = analysis.difficulty || 'master';
    draft.perfect = analysis.metrics.perfect ?? 0;
    draft.great = analysis.metrics.great ?? 0;
    draft.good = analysis.metrics.good ?? 0;
    draft.bad = analysis.metrics.bad ?? 0;
    draft.miss = analysis.metrics.miss ?? 0;
    draft.combo = analysis.combo ?? null;
    draft.totalNotes = analysis.expectedTotalNotes ?? (analysis.metrics.perfect + analysis.metrics.great + analysis.metrics.good + analysis.metrics.bad + analysis.metrics.miss);
    draft.validationMessages = analysis.warnings || [];
    draft.needsManual = analysis.needsManual;
    draft.source = state.settings.registerMode;
    recalculateDraftMetrics(draft);
    const expected = analysis.musicId && analysis.difficulty ? { level: analysis.expectedLevel, difficulty: analysis.difficulty, totalNotes: analysis.expectedTotalNotes } : null;
    draft.validationMessages = buildValidationMessages(draft, expected).concat(draft.validationMessages || []);
    item.draft = draft;
    item.previewUrl = item.previewUrl || (item.file instanceof Blob ? URL.createObjectURL(item.file) : (item.record ? recordImageSrc(item.record) : ''));
    item.matched = analysis.matched;
    item.expected = expected;
    item.warnings = draft.validationMessages.slice();
    item.needsManual = draft.needsManual;
    item.ready = true;
    item.status = item.warnings.length ? '要確認' : '完了';
    if (state.editor.activeIndex === index) {
      updateEditorFormFromDraft(draft);
      renderEditorOverlay();
    }
    renderEditorQueue();
    return analysis;
  } catch (error) {
    item.error = String(error?.message || error);
    item.status = '失敗';
    renderEditorQueue();
    showToast(`解析に失敗しました: ${item.error}`, 'warn');
    return null;
  }
}

async function analyzeAllQueue(rerun = false) {
  if (!state.editor) return;
  for (let i = 0; i < state.editor.queue.length; i += 1) {
    await analyzeQueueIndex(i, rerun);
  }
}

async function prepareEditorWithFiles(files) {
  const activeTemplateId = state.settings.activeTemplateId || state.templates[0]?.id;
  const queue = [];
  for (const file of files) {
    const previewUrl = URL.createObjectURL(file);
    queue.push({
      id: uid('queue'),
      file,
      fileName: file.name,
      previewUrl,
      record: null,
      draft: createEmptyDraft(activeTemplateId),
      templateId: activeTemplateId,
      status: '待機',
      ready: false,
      warnings: [],
      error: '',
      expected: null,
    });
  }
  state.editor = { mode: 'upload', queue, activeIndex: 0 };
  openEditorModal('画像登録', 'OCR 結果を確認して保存してください。');
  renderEditorQueue();
  if (queue.length) {
    els.editorPreview.src = queue[0].previewUrl;
    await analyzeAllQueue(false);
    renderEditorQueue();
    if (state.settings.registerMode === 'auto' && queue.length === 1 && !queue[0].warnings.length && !queue[0].error) {
      await saveEditorQueue();
    }
  }
}

async function openEditorForRecord(record) {
  let working = deepClone(record);
  if (!working.imageBlob && working.driveFileId) {
    try {
      const blob = await getDriveFileBlob(working.driveFileId);
      working.imageBlob = blob;
    } catch {
      // ignore preview fallback
    }
  }
  const queue = [{
    id: uid('queue'),
    record: working,
    file: working.imageBlob || null,
    fileName: working.title || 'record',
    previewUrl: recordImageSrc(working),
    draft: {
      id: working.id,
      title: working.title || '',
      pronunciation: working.pronunciation || '',
      musicId: working.musicId ?? null,
      level: String(working.level ?? ''),
      difficulty: working.difficulty || 'master',
      perfect: working.perfect ?? 0,
      great: working.great ?? 0,
      good: working.good ?? 0,
      bad: working.bad ?? 0,
      miss: working.miss ?? 0,
      combo: working.combo ?? null,
      totalNotes: working.totalNotes ?? null,
      source: working.source || 'manual',
      validationMessages: working.validationMessages || [],
      needsManual: working.needsManual || false,
    },
    templateId: working.templateId || state.settings.activeTemplateId,
    status: '既存',
    ready: true,
    warnings: working.validationMessages || [],
    error: '',
    expected: null,
  }];
  state.editor = { mode: 'edit', queue, activeIndex: 0 };
  openEditorModal('リザルト編集', '保存すると一覧と Drive の内容が更新されます。');
  renderEditorQueue();
  els.editorPreview.src = queue[0].previewUrl || '';
  updateEditorFormFromDraft(queue[0].draft);
  renderEditorOverlay();
}

async function saveEditorQueue() {
  if (!state.editor) return;
  const results = [];
  for (const item of state.editor.queue) {
    loadDraftFromForm(item);
    const base = item.record || {};
    const composed = composeRecordFromDraft(item.draft, {
      id: base.id || item.draft.id || uid('record'),
      createdAt: base.createdAt || nowISO(),
      updatedAt: nowISO(),
      deletedAt: base.deletedAt || null,
      templateId: item.templateId || base.templateId || state.settings.activeTemplateId,
      driveFileId: base.driveFileId || null,
      driveFolderId: base.driveFolderId || null,
      driveName: base.driveName || '',
      driveViewLink: base.driveViewLink || '',
      driveThumbLink: base.driveThumbLink || '',
      source: item.draft.source,
      imageBlob: base.imageBlob || item.file || null,
      imageType: base.imageType || (item.file?.type || 'image/png'),
      thumbnailDataUrl: base.thumbnailDataUrl || (item.file ? await makePreviewDataUrl(item.file) : ''),
      validationMessages: item.draft.validationMessages || [],
      needsManual: item.draft.needsManual || false,
      musicId: item.draft.musicId ?? null,
      recordId: base.recordId || item.draft.id || uid('record'),
    });
    if (!composed.title) {
      showToast('曲名が空のため保存できません。', 'warn');
      continue;
    }
    if (state.imageUrlCache.has(composed.id)) {
      try { URL.revokeObjectURL(state.imageUrlCache.get(composed.id)); } catch {}
      state.imageUrlCache.delete(composed.id);
    }
    await upsertRecord(composed);
    results.push(composed);
    item.record = composed;
    item.status = '保存済み';
    item.ready = true;
    if (isDriveSignedIn()) {
      try {
        if (composed.driveFileId) {
          const updated = await updateDriveRecord(composed.driveFileId, composed, { replaceBlob: Boolean(item.file) });
          composed.driveName = updated.name || composed.driveName;
        } else {
          const uploaded = await uploadRecordToDrive(composed);
          composed.driveFileId = uploaded.id;
          composed.driveName = uploaded.name || composed.title;
          composed.driveViewLink = uploaded.webViewLink || '';
          composed.driveThumbLink = uploaded.thumbnailLink || '';
          await upsertRecord(composed);
        }
      } catch (error) {
        showToast(`Drive 同期に失敗しました: ${error.message || error}`, 'warn');
      }
    }
  }
  if (results.length) {
    state.records = await getAllRecords();
    state.bestMap = getBestMap(state.records, currentBasis().key);
    renderListSoon();
    await persistSettings();
    notifyBestImprovements(results);
    showToast(`${results.length} 件を保存しました`, 'success');
    if (state.editor.mode === 'upload' && state.settings.registerMode === 'auto') closeEditorModal();
  }
}

function notifyBestImprovements(newRecords) {
  const existing = state.records.filter((r) => !r.deletedAt && !newRecords.some((n) => n.id === r.id));
  for (const rec of newRecords) {
    const key = getRecordKey(rec);
    const same = existing.filter((r) => getRecordKey(r) === key);
    if (!same.length) continue;
    const hit = [];
    for (const basis of ['ap', 'tournament', 'fc']) {
      const currentBest = same.slice().sort((a, b) => compareForBasis(a, b, basis))[0];
      if (currentBest && compareForBasis(rec, currentBest, basis) < 0) hit.push(BASIS_MODES[basis]?.label || basis);
    }
    if (hit.length) showToast(`${rec.title} が ${hit.join(' / ')} の自己ベストを更新しました`, 'success');
  }
}

async function trashRecord(recordId) {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return;
  if (!confirm(`「${record.title || '未設定'}」をゴミ箱へ移動しますか？`)) return;
  record.deletedAt = nowISO();
  record.updatedAt = nowISO();
  await upsertRecord(record);
  if (state.imageUrlCache.has(record.id)) {
    try { URL.revokeObjectURL(state.imageUrlCache.get(record.id)); } catch {}
    state.imageUrlCache.delete(record.id);
  }
  if (record.driveFileId && isDriveSignedIn()) {
    try { await trashDriveRecord(record.driveFileId); } catch (error) { showToast(`Drive への移動に失敗しました: ${error.message || error}`, 'warn'); }
  }
  state.records = await getAllRecords();
  renderListSoon();
}

async function restoreRecord(recordId) {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return;
  record.deletedAt = null;
  record.updatedAt = nowISO();
  await upsertRecord(record);
  if (state.imageUrlCache.has(record.id)) {
    try { URL.revokeObjectURL(state.imageUrlCache.get(record.id)); } catch {}
    state.imageUrlCache.delete(record.id);
  }
  if (record.driveFileId && isDriveSignedIn()) {
    try { await restoreDriveRecord(record.driveFileId); } catch (error) { showToast(`Drive の復元に失敗しました: ${error.message || error}`, 'warn'); }
  }
  state.records = await getAllRecords();
  renderListSoon();
}

async function purgeRecord(recordId) {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return;
  if (!confirm(`「${record.title || '未設定'}」を完全削除しますか？`)) return;
  if (record.driveFileId && isDriveSignedIn()) {
    try { await deleteDriveRecord(record.driveFileId); } catch (error) { showToast(`Drive の完全削除に失敗しました: ${error.message || error}`, 'warn'); }
  }
  await deleteRecord(recordId);
  if (state.imageUrlCache.has(record.id)) {
    try { URL.revokeObjectURL(state.imageUrlCache.get(record.id)); } catch {}
    state.imageUrlCache.delete(record.id);
  }
  state.records = await getAllRecords();
  renderListSoon();
}

async function purgeExpiredTrash() {
  const expiry = MAX_TRASH_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const expired = state.records.filter((r) => r.deletedAt && now - new Date(r.deletedAt).getTime() >= expiry);
  if (!expired.length) return;
  for (const record of expired) {
    if (record.driveFileId && isDriveSignedIn()) {
      try { await deleteDriveRecord(record.driveFileId); } catch {}
    }
    await deleteRecord(record.id);
  }
  state.records = await getAllRecords();
  renderListSoon();
  showToast(`ゴミ箱から ${expired.length} 件を自動削除しました`, 'info');
}

async function syncFromDrive() {
  if (!isDriveSignedIn()) {
    await signInDrive();
  }
  await initDriveClient();
  state.isSyncing = true;
  showToast('Drive 同期を開始しました', 'info');
  try {
    const remote = await listDriveRecords();
    const existing = await getAllRecords();
    const byDriveId = new Map(existing.filter((r) => r.driveFileId).map((r) => [r.driveFileId, r]));
    const merged = [];
    for (const file of remote) {
      const local = byDriveId.get(file.driveFileId);
      if (local) {
        merged.push({
          ...local,
          driveFileId: file.driveFileId,
          driveFolderId: file.driveFolderId,
          driveName: file.driveName,
          driveViewLink: file.driveViewLink,
          driveThumbLink: file.driveThumbLink,
          updatedAt: local.updatedAt || file.driveModifiedTime,
        });
      } else {
        const app = file.driveAppProperties || {};
        merged.push({
          id: app.recordId || file.id,
          recordId: app.recordId || file.id,
          title: app.title || '未設定',
          pronunciation: app.pronunciation || '',
          musicId: app.musicId || null,
          level: app.level || '',
          difficulty: app.difficulty || 'master',
          perfect: 0, great: 0, good: 0, bad: 0, miss: 0, combo: null,
          totalNotes: null, apMiss: 0, tournamentMiss: 0, fcMiss: 0, apDone: false, fcDone: false,
          deletedAt: file.driveTrashed ? file.driveModifiedTime : null,
          createdAt: app.createdAt || file.driveCreatedTime || nowISO(),
          updatedAt: app.updatedAt || file.driveModifiedTime || nowISO(),
          templateId: state.settings.activeTemplateId,
          driveFileId: file.driveFileId,
          driveFolderId: file.driveFolderId,
          driveName: file.driveName,
          driveViewLink: file.driveViewLink,
          driveThumbLink: file.driveThumbLink,
          imageBlob: null,
          imageType: 'image/png',
          source: 'drive',
          thumbnailDataUrl: '',
          validationMessages: [],
          needsManual: false,
        });
      }
    }
    if (merged.length) await upsertRecords(merged);
    state.records = await getAllRecords();
    renderListSoon();
    showToast(`Drive から ${remote.length} 件を同期しました`, 'success');
  } catch (error) {
    showToast(`Drive 同期に失敗しました: ${error.message || error}`, 'warn');
  } finally {
    state.isSyncing = false;
  }
}

async function connectDrive() {
  try {
    await signInDrive();
    syncDriveStatus();
    showToast('Drive に接続しました', 'success');
    await syncFromDrive();
  } catch (error) {
    showToast(`Drive 接続に失敗しました: ${error.message || error}`, 'warn');
  }
}

function syncDriveStatus() {
  if (isDriveSignedIn()) {
    els.driveStatus.className = 'status-chip ok';
    els.driveStatus.innerHTML = '<span class="material-symbols-outlined">cloud_done</span><span>Drive 接続済み</span>';
    els.btnConnectDrive.innerHTML = '<span class="material-symbols-outlined">logout</span><span>Drive 切断</span>';
  } else {
    els.driveStatus.className = 'status-chip neutral';
    els.driveStatus.innerHTML = '<span class="material-symbols-outlined">cloud_off</span><span>Drive 未接続</span>';
    els.btnConnectDrive.innerHTML = '<span class="material-symbols-outlined">login</span><span>Drive 接続</span>';
  }
}

async function toggleDriveConnection() {
  if (isDriveSignedIn()) {
    await signOutDrive();
    syncDriveStatus();
    showToast('Drive から切断しました', 'info');
  } else {
    await connectDrive();
  }
}

function setTab(tab) {
  state.activeTab = tab;
  els.tabLibrary.classList.toggle('active', tab === 'library');
  els.tabTrash.classList.toggle('active', tab === 'trash');
  els.showTrash.checked = tab === 'trash';
  state.settings.showTrash = tab === 'trash';
  persistSettings();
  renderListSoon();
}

function bindListEvents() {
  els.listItems.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    const id = event.target.closest('[data-id]')?.dataset.id;
    const card = event.target.closest('.record-card');
    if (action && id) {
      event.stopPropagation();
      if (action === 'edit') {
        const record = state.records.find((r) => r.id === id);
        if (record) await openEditorForRecord(record);
      }
      if (action === 'trash') await trashRecord(id);
      if (action === 'restore') await restoreRecord(id);
      if (action === 'purge') await purgeRecord(id);
      return;
    }
    if (card) {
      const record = state.records.find((r) => r.id === card.dataset.id);
      if (record) await openEditorForRecord(record);
    }
  });
  els.listViewport.addEventListener('scroll', renderListSoon);
  window.addEventListener('resize', renderListSoon);
}

function bindFilterEvents() {
  const controls = ['filterQuery','filterLevel','filterDifficulty','filterStatus','basisMode','viewMode','sortKey','sortDir','apMissMin','apMissMax','tournamentMissMin','tournamentMissMax','fcMissMin','fcMissMax','onlyPlayable','showTrash'];
  controls.forEach((id) => {
    const el = els[id];
    el.addEventListener('input', async () => {
      setSettingsFromUI();
      if (id === 'showTrash') setTab(els.showTrash.checked ? 'trash' : 'library');
      await persistSettings();
      renderListSoon();
    });
    el.addEventListener('change', async () => {
      setSettingsFromUI();
      if (id === 'showTrash') setTab(els.showTrash.checked ? 'trash' : 'library');
      await persistSettings();
      renderListSoon();
    });
  });
}

function bindEditorEvents() {
  els.btnCloseEditor.addEventListener('click', closeEditorModal);
  els.editorModal.addEventListener('click', (event) => { if (event.target === els.editorModal) closeEditorModal(); });
  els.registerModeAuto.addEventListener('click', () => setEditorMode('auto'));
  els.registerModeManual.addEventListener('click', () => setEditorMode('manual'));
  els.btnAnalyzeQueue.addEventListener('click', async () => { await analyzeAllQueue(true); });
  els.btnSaveQueue.addEventListener('click', async () => { await saveEditorQueue(); });

  ['recordTitle','recordPronunciation','recordLevel','recordDifficulty','countPerfect','countGreat','countGood','countBad','countMiss','recordCombo','recordTotalNotes','recordSource'].forEach((id) => {
    els[id].addEventListener('input', () => {
      const item = editorCurrentItem();
      if (!item) return;
      loadDraftFromForm(item);
      item.draft.validationMessages = buildValidationMessages(item.draft, item.expected || null).concat(item.draft.validationMessages || []);
      renderEditorQueue();
    });
    els[id].addEventListener('change', () => {
      const item = editorCurrentItem();
      if (!item) return;
      loadDraftFromForm(item);
      item.draft.validationMessages = buildValidationMessages(item.draft, item.expected || null).concat(item.draft.validationMessages || []);
      renderEditorQueue();
    });
  });

  els.queueList.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-queue-index]');
    if (!btn || !state.editor) return;
    state.editor.activeIndex = Number(btn.dataset.queueIndex);
    renderEditorQueue();
  });

  els.editorPreview.addEventListener('load', () => renderEditorOverlay());
}

function renderTemplateList() {
  els.templateList.innerHTML = state.templates.map((template) => `
    <button class="template-item ${template.id === state.settings.activeTemplateId ? 'active' : ''}" type="button" data-template-id="${template.id}">
      <div class="template-item-title">${escapeText(template.name || '未設定')}</div>
      <div class="template-item-sub">比率 ${escapeText(String(template.aspectRatio ?? ''))}</div>
    </button>
  `).join('');
}

function renderTemplateEditor(template = null) {
  const selected = template || state.templates.find((t) => t.id === state.settings.activeTemplateId) || state.templates[0] || null;
  if (!selected) return;
  state.templateEditor = deepClone(selected);
  els.templateName.value = selected.name || '';
  els.templateAspect.value = String(selected.aspectRatio ?? '');
  els.templatePreviewImage.src = selected.sampleDataUrl || '';
  for (const input of document.querySelectorAll('.region-inputs input')) {
    const key = input.dataset.region;
    const prop = input.dataset.key;
    if (selected.regions?.[key]) input.value = selected.regions[key][prop] ?? '';
  }
  renderTemplateOverlay();
}

function renderTemplateOverlay() {
  const tmpl = state.templateEditor;
  if (!tmpl) return;
  const img = els.templatePreviewImage;
  if (!img.complete || !img.naturalWidth) {
    els.templatePreviewOverlay.innerHTML = '';
    return;
  }
  const width = img.clientWidth || 1;
  const height = img.clientHeight || 1;
  els.templatePreviewOverlay.innerHTML = Object.entries(tmpl.regions).map(([key, region]) => {
    const labelMap = { title: 'タイトル', level: 'レベル', difficulty: '難易度', result: 'リザルト', combo: 'コンボ' };
    return `<div class="region-box" style="left:${region.x * width}px; top:${region.y * height}px; width:${region.w * width}px; height:${region.h * height}px; color:${region.color || '#22a'}"><div class="tag">${labelMap[key] || key}</div></div>`;
  }).join('');
}

function bindTemplateEvents() {
  els.btnTemplates.addEventListener('click', openTemplateModal);
  els.btnCloseTemplate.addEventListener('click', closeTemplateModal);
  els.templateModal.addEventListener('click', (event) => { if (event.target === els.templateModal) closeTemplateModal(); });
  els.btnAddTemplate.addEventListener('click', () => {
    const base = deepClone(state.templates.find((t) => t.id === state.settings.activeTemplateId) || state.templates[0]);
    const created = base ? { ...base, id: uid('template'), name: `${base.name || 'テンプレート'} コピー` } : { id: uid('template'), name: '新規テンプレート', aspectRatio: 16 / 9, regions: {} };
    state.templates.push(created);
    state.templateEditor = deepClone(created);
    state.settings.activeTemplateId = created.id;
    renderTemplateList();
    renderTemplateEditor(created);
    persistSettings();
  });
  els.templateList.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-template-id]');
    if (!btn) return;
    const template = state.templates.find((t) => t.id === btn.dataset.templateId);
    if (!template) return;
    state.settings.activeTemplateId = template.id;
    renderTemplateList();
    renderTemplateEditor(template);
    persistSettings();
  });
  els.templateImageInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file || !state.templateEditor) return;
    state.templateEditor.sampleDataUrl = await makePreviewDataUrl(file);
    els.templatePreviewImage.src = state.templateEditor.sampleDataUrl;
    renderTemplateOverlay();
  });
  els.templatePreviewImage.addEventListener('load', renderTemplateOverlay);
  els.templateAspect.addEventListener('input', () => { if (state.templateEditor) state.templateEditor.aspectRatio = Number(els.templateAspect.value) || state.templateEditor.aspectRatio; });
  els.templateName.addEventListener('input', () => { if (state.templateEditor) state.templateEditor.name = els.templateName.value; renderTemplateList(); });
  document.querySelectorAll('.region-inputs input').forEach((input) => {
    input.addEventListener('input', () => {
      if (!state.templateEditor) return;
      const region = input.dataset.region;
      const key = input.dataset.key;
      if (!state.templateEditor.regions[region]) return;
      state.templateEditor.regions[region][key] = Number(input.value);
      renderTemplateOverlay();
    });
  });
  els.btnCloneTemplate.addEventListener('click', () => {
    if (!state.templateEditor) return;
    const cloned = deepClone(state.templateEditor);
    cloned.id = uid('template');
    cloned.name = `${cloned.name || 'テンプレート'} コピー`;
    state.templates.push(cloned);
    state.templateEditor = cloned;
    state.settings.activeTemplateId = cloned.id;
    renderTemplateList();
    renderTemplateEditor(cloned);
    persistSettings();
  });
  els.btnDeleteTemplate.addEventListener('click', async () => {
    if (!state.templateEditor) return;
    if (!confirm(`テンプレート「${state.templateEditor.name}」を削除しますか？`)) return;
    await deleteTemplate(state.templateEditor.id);
    state.templates = state.templates.filter((t) => t.id !== state.templateEditor.id);
    if (!state.templates.length) {
      const fallback = {
        id: uid('template'), name: '標準 16:9', aspectRatio: 16 / 9, sampleDataUrl: '',
        regions: {
          title: { x: 0.08, y: 0.02, w: 0.34, h: 0.07, color: '#ff6b81' },
          level: { x: 0.28, y: 0.03, w: 0.11, h: 0.05, color: '#4da3ff' },
          difficulty: { x: 0.39, y: 0.03, w: 0.15, h: 0.05, color: '#55d58a' },
          result: { x: 0.08, y: 0.48, w: 0.31, h: 0.28, color: '#ff9b42' },
          combo: { x: 0.33, y: 0.47, w: 0.18, h: 0.12, color: '#b57cff' },
        },
      };
      state.templates.push(fallback);
      await upsertTemplate(fallback);
    }
    state.settings.activeTemplateId = state.templates[0].id;
    renderTemplateList();
    renderTemplateEditor(state.templates[0]);
    persistSettings();
  });
  els.btnSaveTemplate.addEventListener('click', async () => {
    if (!state.templateEditor) return;
    const merged = deepClone(state.templateEditor);
    merged.name = els.templateName.value.trim() || merged.name;
    merged.aspectRatio = Number(els.templateAspect.value) || merged.aspectRatio;
    state.templates = state.templates.filter((t) => t.id !== merged.id).concat([merged]);
    await upsertTemplate(merged);
    state.settings.activeTemplateId = merged.id;
    renderTemplateList();
    renderTemplateEditor(merged);
    persistSettings();
    showToast('テンプレートを保存しました', 'success');
  });
  els.templatePreviewOverlay.addEventListener('click', renderTemplateOverlay);
}

function bindTopbarEvents() {
  els.btnConnectDrive.addEventListener('click', toggleDriveConnection);
  els.btnSyncDrive.addEventListener('click', syncFromDrive);
  document.getElementById('fileInput').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    await prepareEditorWithFiles(files);
  });
  els.btnUpload.addEventListener('click', () => document.getElementById('fileInput').click());
  els.btnExport.addEventListener('click', async () => {
    const data = await exportAllData();
    downloadJson(`prsk-results-${new Date().toISOString().slice(0, 10)}.json`, data);
    showToast('JSON を書き出しました', 'success');
  });
  els.importJson.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text);
    await importAllData(parsed);
    await refreshDataFromStorage();
    showToast('JSON を読み込みました', 'success');
  });
  els.btnPurgeTrash.addEventListener('click', async () => {
    const trashed = state.records.filter((r) => r.deletedAt);
    if (!trashed.length) return showToast('ゴミ箱は空です', 'info');
    if (!confirm(`ゴミ箱の ${trashed.length} 件を完全削除しますか？`)) return;
    for (const record of trashed) {
      if (record.driveFileId && isDriveSignedIn()) {
        try { await deleteDriveRecord(record.driveFileId); } catch {}
      }
      await deleteRecord(record.id);
    }
    state.records = await getAllRecords();
    renderListSoon();
    showToast('ゴミ箱を完全削除しました', 'success');
  });
  els.tabLibrary.addEventListener('click', () => setTab('library'));
  els.tabTrash.addEventListener('click', () => setTab('trash'));
}

async function init() {
  initEls();
  bindListEvents();
  bindFilterEvents();
  bindEditorEvents();
  bindTemplateEvents();
  bindTopbarEvents();

  try { await initDriveClient(); } catch {}
  syncDriveStatus();

  try {
    await loadMusicDb();
    state.musicLoaded = true;
  } catch (error) {
    console.warn('music db load failed', error);
    showToast('楽曲データベースの読み込みに失敗しました。', 'warn');
  }

  await refreshDataFromStorage();
  syncDriveStatus();
  await purgeExpiredTrash();
  setInterval(() => purgeExpiredTrash().catch(() => {}), 60 * 60 * 1000);
  state.ready = true;
  showToast(`準備完了 v${APP_VERSION}`, 'success');
}

window.addEventListener('load', () => { init().catch((error) => { console.error(error); showToast(`初期化に失敗しました: ${error.message || error}`, 'warn'); }); });
