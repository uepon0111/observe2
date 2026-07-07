
const { escapeHtml, showToast, clamp01 } = window.PRSK_UTILS;

const SETTINGS_KEYS = ['diff', 'title', 'miss'];

function updateView() {
  if (!PRSK.state.allRecords) return;
  const fcF = document.getElementById('filter-fc').value;
  const msMin = document.getElementById('filter-miss-min').value;
  const msMax = document.getElementById('filter-miss-max').value;
  const dfF = document.getElementById('filter-diff').value;
  const lvF = document.getElementById('filter-level').value;
  const tiF = document.getElementById('filter-title').value.trim().toLowerCase();

  let list = PRSK.state.allRecords.filter(r => {
    if (fcF === 'fc' && !r.isFC) return false;
    if (fcF === 'unfc' && r.isFC) return false;
    if (!r.isFC) {
      const mVal = r.missCount;
      if (msMin !== '' && mVal < parseInt(msMin, 10)) return false;
      if (msMax !== '' && mVal > parseInt(msMax, 10)) return false;
    } else {
      if (msMin !== '' && 0 < parseInt(msMin, 10)) return false;
    }
    if (dfF !== 'all' && r.difficultyRaw !== dfF) return false;
    if (lvF && String(r.level) !== String(lvF)) return false;
    if (tiF && !String(r.title || '').toLowerCase().includes(tiF)) return false;
    return true;
  });

  const sOrder = document.getElementById('sort-order').value;
  list.sort((a, b) => {
    const tAsc = String(a.title || '').localeCompare(String(b.title || ''), 'ja');
    const tDesc = String(b.title || '').localeCompare(String(a.title || ''), 'ja');
    const lDiff = (Number(b.level) || 0) - (Number(a.level) || 0);
    const lAsc = (Number(a.level) || 0) - (Number(b.level) || 0);
    const dDiff = (PRSK.DIFFS[b.difficultyRaw]?.rank || 0) - (PRSK.DIFFS[a.difficultyRaw]?.rank || 0);
    const mAsc = a.missCount - b.missCount;
    const mDesc = b.missCount - a.missCount;

    if (sOrder === 'title_asc') return tAsc || dDiff || mAsc;
    if (sOrder === 'title_desc') return tDesc || dDiff || mAsc;
    if (sOrder === 'level_desc') return lDiff || tAsc || dDiff || mAsc;
    if (sOrder === 'level_asc') return lAsc || tAsc || dDiff || mAsc;
    if (sOrder === 'miss_asc') return mAsc || lDiff || dDiff;
    return mDesc || lDiff || dDiff;
  });

  PRSK.state.filteredRecords = list;
  renderGrid(list);
}
function renderGrid(records) {
  const grid = document.getElementById('grid');
  document.getElementById('result-count').innerText = `表示: ${records.length} 件`;
  grid.innerHTML = '';
  if (records.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
    return;
  }

  records.forEach(rec => {
    const thumb = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w600') : '';
    const large = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
    const missDisplay = rec.isFC ? '<span class="miss-val zero">FC-0</span>' : `FC -<span class="miss-val">${rec.missCount}</span>`;
    const badge = rec.isFC ? '<div class="fc-badge"><span class="material-symbols-outlined" style="font-size:1rem;">crown</span> FULL COMBO</div>' : '';
    const isSel = PRSK.state.selectedIds.has(rec.id) ? 'selected' : '';

    let clickAction = '';
    let overlayActions = '';
    if (PRSK.state.isSelectMode) {
      clickAction = `toggleSelection('${rec.id}')`;
    } else {
      clickAction = `openImageModal('${large}')`;
      overlayActions = `
        <div class="card-overlay-actions">
          <div class="btn-overlay" onclick="event.stopPropagation(); individualEdit('${rec.id}')" title="編集"><span class="material-symbols-outlined">edit</span></div>
          <div class="btn-overlay del" onclick="event.stopPropagation(); individualDelete('${rec.id}')" title="削除"><span class="material-symbols-outlined">delete</span></div>
        </div>
      `;
    }

    const best = window.PRSK_UTILS.getBestRecordForKey({ musicId: rec.musicId, title: rec.title, level: rec.level, diff: rec.difficultyRaw });
    const bestMark = best && best.id === rec.id ? '<span class="badge-notify">自己ベスト</span>' : '';

    grid.innerHTML += `
      <div class="card ${rec.isFC ? 'is-fc' : ''} ${isSel} ${PRSK.state.isSelectMode ? 'select-mode-active' : ''}" id="card-${rec.id}" onclick="${clickAction}">
        <div class="card-img-container">
          ${badge}
          ${overlayActions}
          <div class="img-loader-spinner"></div>
          ${thumb ? `<img src="${thumb}" class="card-img" loading="lazy" onload="this.style.opacity=1; this.previousElementSibling.style.display='none';">` : '<span style="color:#aaa;">NO IMAGE</span>'}
        </div>
        <div class="card-body">
          <div class="song-meta"><span class="tag lvl">Lv.${escapeHtml(rec.level)}</span><span class="tag diff-${escapeHtml(rec.difficultyRaw)}">${escapeHtml(rec.difficulty)}</span>${bestMark}</div>
          <div class="song-title">${escapeHtml(rec.title)}</div>
          <div class="score-info"><span style="display:flex;align-items:center;gap:2px;"><span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span> Result</span>${missDisplay}</div>
        </div>
      </div>`;
  });
}
function openImageModal(src) {
  if (src) {
    document.getElementById('imageModal').style.display = 'flex';
    document.getElementById('modalImg').src = src;
  }
}
function closeImageModal() {
  document.getElementById('imageModal').style.display = 'none';
}
function toggleSelectMode() {
  PRSK.state.isSelectMode = !PRSK.state.isSelectMode;
  const btn = document.getElementById('btn-select-mode');
  if (PRSK.state.isSelectMode) btn.classList.add('active');
  else {
    btn.classList.remove('active');
    PRSK.state.selectedIds.clear();
    updateSelectionUI();
  }
  renderGrid(PRSK.state.filteredRecords);
}
function toggleSelection(id) {
  if (PRSK.state.selectedIds.has(id)) PRSK.state.selectedIds.delete(id);
  else PRSK.state.selectedIds.add(id);
  const card = document.getElementById(`card-${id}`);
  if (card) {
    if (PRSK.state.selectedIds.has(id)) card.classList.add('selected');
    else card.classList.remove('selected');
  }
  updateSelectionUI();
}
function updateSelectionUI() {
  const bar = document.getElementById('batch-actions');
  const countSpan = document.getElementById('selected-count');
  countSpan.innerText = PRSK.state.selectedIds.size;
  bar.style.display = PRSK.state.selectedIds.size > 0 ? 'flex' : 'none';
}
function clearSelection() {
  PRSK.state.selectedIds.clear();
  updateSelectionUI();
  renderGrid(PRSK.state.filteredRecords);
}
function individualEdit(id) {
  PRSK.state.selectedIds.clear();
  PRSK.state.selectedIds.add(id);
  batchEdit();
}
async function individualDelete(id) {
  if (!confirm('このリザルトを削除しますか？')) return;
  document.getElementById('loader').style.display = 'flex';
  document.getElementById('grid').innerHTML = '';
  try {
    await deleteResultFile(id);
    showToast('削除しました', '', 'success', 2500);
    await fetchDataFromDrive();
  } catch (e) {
    showToast('削除失敗', e.message || '削除できませんでした', 'error', 3500);
    await fetchDataFromDrive();
  }
}
async function batchDelete() {
  if (!confirm(`選択した ${PRSK.state.selectedIds.size} 件を削除しますか？`)) return;
  document.getElementById('loader').style.display = 'flex';
  document.getElementById('grid').innerHTML = '';
  try {
    for (const id of PRSK.state.selectedIds) {
      await deleteResultFile(id);
    }
    PRSK.state.selectedIds.clear();
    updateSelectionUI();
    showToast('削除しました', '', 'success', 2500);
    await fetchDataFromDrive();
  } catch (e) {
    showToast('削除エラー', e.message || '削除できませんでした', 'error', 3500);
    await fetchDataFromDrive();
  }
}

function openSettingsModal() {
  document.getElementById('settingsModal').style.display = 'flex';
  syncSettingsUI();
}
function closeSettingsModal() {
  document.getElementById('settingsModal').style.display = 'none';
}
function syncSettingsUI() {
  const settings = PRSK.state.settings;
  document.getElementById('setting-notify-best').checked = !!settings.notifyBest;
  document.getElementById('settings-sample-file').value = '';
  document.getElementById('sample-filename').innerText = PRSK.state.sampleImageUrl ? '読み込み済み' : '未選択';
  for (const key of SETTINGS_KEYS) {
    updateRegionInputs(key, settings.crop[key]);
  }
  renderSettingsPreview();
  setActiveRegion('diff');
}
function setActiveRegion(key) {
  document.querySelectorAll('.crop-selector button').forEach(btn => btn.classList.toggle('active', btn.dataset.region === key));
  document.querySelectorAll('.region-overlay').forEach(el => el.classList.toggle('active', el.dataset.region === key));
  SETTINGS_KEYS.forEach(region => {
    const block = document.getElementById(`region-editor-${region}`);
    if (block) block.style.display = region === key ? 'grid' : 'none';
  });
  document.getElementById('active-region-label').innerText = key.toUpperCase();
  const cfg = PRSK.state.settings.crop[key];
  updateRegionInputs(key, cfg);
  renderSettingsPreview();
}
function updateRegionInputs(key, cfg) {
  if (!cfg) return;
  document.getElementById(`crop-x-${key}`).value = Math.round(cfg.x * 1000) / 10;
  document.getElementById(`crop-y-${key}`).value = Math.round(cfg.y * 1000) / 10;
  document.getElementById(`crop-w-${key}`).value = Math.round(cfg.w * 1000) / 10;
  document.getElementById(`crop-h-${key}`).value = Math.round(cfg.h * 1000) / 10;
  document.getElementById(`crop-mode-${key}`).value = cfg.mode || 'filter-standard';
}
function updateRegionFromInputs(key) {
  const cfg = PRSK.state.settings.crop[key];
  if (!cfg) return;
  const pct = (id, fallback) => {
    const v = parseFloat(document.getElementById(id).value);
    return clamp01((Number.isFinite(v) ? v : fallback) / 100);
  };
  cfg.x = pct(`crop-x-${key}`, 0);
  cfg.y = pct(`crop-y-${key}`, 0);
  cfg.w = pct(`crop-w-${key}`, 10);
  cfg.h = pct(`crop-h-${key}`, 10);
  cfg.mode = document.getElementById(`crop-mode-${key}`).value;
  renderSettingsPreview();
}
function renderSettingsPreview() {
  const wrap = document.getElementById('settings-preview-wrap');
  const img = document.getElementById('settings-preview-img');
  wrap.innerHTML = '';
  if (!PRSK.state.sampleImageUrl) {
    wrap.innerHTML = '<div style="padding:30px;color:#94a3b8;text-align:center;">サンプル画像をアップロードしてください</div>';
    return;
  }
  const image = document.createElement('img');
  image.id = 'settings-preview-img';
  image.src = PRSK.state.sampleImageUrl;
  image.alt = 'sample';
  image.style.width = '100%';
  image.style.height = 'auto';
  image.style.display = 'block';
  wrap.appendChild(image);

  for (const key of SETTINGS_KEYS) {
    const cfg = PRSK.state.settings.crop[key];
    const box = document.createElement('div');
    box.className = 'region-overlay' + (key === document.getElementById('active-region-label').innerText.toLowerCase() ? ' active' : '');
    box.dataset.region = key;
    box.style.left = `${cfg.x * 100}%`;
    box.style.top = `${cfg.y * 100}%`;
    box.style.width = `${cfg.w * 100}%`;
    box.style.height = `${cfg.h * 100}%`;
    box.innerHTML = `<div class="region-label">${key.toUpperCase()}</div><div class="region-handle"></div>`;
    wrap.appendChild(box);
  }
}
function handleSettingsSampleFile(file) {
  if (!file) return;
  if (PRSK.state.sampleImageUrl && PRSK.state.sampleImageUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(PRSK.state.sampleImageUrl); } catch (e) {}
  }
  PRSK.state.sampleImageUrl = URL.createObjectURL(file);
  document.getElementById('sample-filename').innerText = file.name;
  renderSettingsPreview();
}
function saveSettingsFromUI() {
  PRSK.state.settings.notifyBest = document.getElementById('setting-notify-best').checked;
  for (const key of SETTINGS_KEYS) updateRegionFromInputs(key);
  window.PRSK_UTILS.saveSettings();
  showToast('設定を保存しました', '', 'success', 2500);
  closeSettingsModal();
}
function resetSettingsToDefault() {
  PRSK.state.settings = JSON.parse(JSON.stringify(PRSK.DEFAULT_SETTINGS));
  window.PRSK_UTILS.saveSettings();
  syncSettingsUI();
  showToast('初期設定に戻しました', '', 'success', 2500);
}

window.updateView = updateView;
window.renderGrid = renderGrid;
window.openImageModal = openImageModal;
window.closeImageModal = closeImageModal;
window.toggleSelectMode = toggleSelectMode;
window.toggleSelection = toggleSelection;
window.updateSelectionUI = updateSelectionUI;
window.clearSelection = clearSelection;
window.individualEdit = individualEdit;
window.individualDelete = individualDelete;
window.batchDelete = batchDelete;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.syncSettingsUI = syncSettingsUI;
window.setActiveRegion = setActiveRegion;
window.handleSettingsSampleFile = handleSettingsSampleFile;
window.saveSettingsFromUI = saveSettingsFromUI;
window.resetSettingsToDefault = resetSettingsToDefault;
window.updateRegionFromInputs = updateRegionFromInputs;
window.renderSettingsPreview = renderSettingsPreview;
