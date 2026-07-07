function onDataLoaded() {
  document.getElementById('loader').style.display = 'none';
  updateView();
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

function openBatchModal(mode) {
  currentMode = mode;
  const modal = document.getElementById('batchModal');
  modal.style.display = 'flex';

  editorQueue = [];
  activeItemId = null;
  document.getElementById('batch-sidebar-list').innerHTML = '';
  document.getElementById('batch-editor-container').style.display = 'none';
  document.getElementById('batch-empty-msg').style.display = 'block';
  document.getElementById('batch-status-msg').innerText = '待機中...';
  document.getElementById('btn-exec-batch').disabled = true;

  if (mode === 'upload') {
    document.getElementById('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
    document.getElementById('upload-initial').style.display = 'flex';
    document.getElementById('batch-workspace').style.display = 'none';
    document.getElementById('up-file').value = '';
    document.getElementById('btn-exec-batch').innerText = '全てアップロード';
  } else {
    document.getElementById('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析モード';
    document.getElementById('upload-initial').style.display = 'none';
    document.getElementById('batch-workspace').style.display = 'flex';
    document.getElementById('btn-exec-batch').innerText = '保存して反映';
  }
}

function closeBatchModal() {
  document.getElementById('batchModal').style.display = 'none';
}

function checkBatchButton() {
  const btn = document.getElementById('btn-exec-batch');
  btn.disabled = editorQueue.length === 0;
  const label = currentMode === 'upload' ? '全てアップロード' : '保存して反映';
  btn.innerText = editorQueue.length > 0 ? `${label} (${editorQueue.length}件)` : label;
}

function renderSidebarItem(id) {
  const item = editorQueue.find((q) => q.id === id);
  if (!item) return;

  const div = document.createElement('div');
  div.className = 'sidebar-item';
  div.id = `sb-${id}`;
  div.onclick = () => selectItem(id);
  div.innerHTML = `
    <img src="${item.imgUrl}" class="sidebar-thumb" crossorigin="anonymous">
    <div class="sidebar-info">
      <div class="sidebar-title" id="sb-title-${id}">${item.data.title || '名称未設定'}</div>
      <div class="sidebar-status">
        <span id="sb-status-${id}" class="upload-status ${item.status === 'existing' ? 'done' : item.status}">${item.status === 'existing' ? 'EXIST' : item.status}</span>
        <button class="btn-remove-side" onclick="removeBatchItem(event, '${id}')">
          <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
        </button>
      </div>
    </div>
  `;
  document.getElementById('batch-sidebar-list').appendChild(div);
}

function selectItem(id) {
  activeItemId = id;
  const item = editorQueue.find((q) => q.id === id);
  if (!item) return;

  document.getElementById('batch-editor-container').style.display = 'flex';
  document.getElementById('batch-empty-msg').style.display = 'none';

  const preview = document.getElementById('batch-preview-img');
  preview.src = item.imgUrl;

  document.getElementById('up-title').value = item.data.title || '';
  document.getElementById('up-level').value = item.data.level || '';
  document.getElementById('up-diff').value = item.data.diff || 'EXPERT';
  document.getElementById('up-good').value = item.data.good || 0;
  document.getElementById('up-bad').value = item.data.bad || 0;
  document.getElementById('up-miss-detail').value = item.data.missDetail || 0;
  document.getElementById('up-total-miss').innerText = item.data.totalMiss || 0;
}

function updateSidebarStatus(id) {
  const item = editorQueue.find((q) => q.id === id);
  if (!item) return;
  const statusEl = document.getElementById(`sb-status-${id}`);
  if (!statusEl) return;
  statusEl.innerText = item.status === 'done' ? 'OK' : item.status === 'existing' ? 'EXIST' : item.status;
  statusEl.className = `upload-status ${item.status === 'done' ? 'done' : item.status === 'existing' ? 'done' : item.status}`;
}

function removeBatchItem(e, id) {
  e.stopPropagation();
  editorQueue = editorQueue.filter((q) => q.id !== id);
  const node = document.getElementById(`sb-${id}`);
  if (node) node.remove();

  if (activeItemId === id) {
    document.getElementById('batch-editor-container').style.display = 'none';
    document.getElementById('batch-empty-msg').style.display = 'block';
    activeItemId = null;
  }
  checkBatchButton();
}

function updateCurrentItem(field, value) {
  if (!activeItemId) return;
  const item = editorQueue.find((q) => q.id === activeItemId);
  if (!item) return;

  if (['good', 'bad', 'missDetail', 'level'].includes(field)) {
    item.data[field] = parseInt(value, 10) || 0;
  } else {
    item.data[field] = value;
  }

  if (field === 'diff' && item.data.musicId) {
    const newLvl = getLevelFromDb(item.data.musicId, String(value).toLowerCase());
    if (newLvl) {
      item.data.level = newLvl;
      document.getElementById('up-level').value = newLvl;
    }
  }

  if (['good', 'bad', 'missDetail'].includes(field)) {
    item.data.totalMiss = (parseInt(item.data.good, 10) || 0) + (parseInt(item.data.bad, 10) || 0) + (parseInt(item.data.missDetail, 10) || 0);
    document.getElementById('up-total-miss').innerText = item.data.totalMiss;
  }

  if (field === 'title') {
    document.getElementById(`sb-title-${activeItemId}`).innerText = value || '名称未設定';
  }

  item.status = 'done';
  updateSidebarStatus(activeItemId);
}

async function runBatchAnalysis(itemsToAnalyze) {
  if (itemsToAnalyze.length === 0) return;
  const statusMsg = document.getElementById('batch-status-msg');
  statusMsg.innerText = '解析中... (しばらくお待ちください)';

  const worker = await Tesseract.createWorker(['jpn', 'eng']);

  for (const item of itemsToAnalyze) {
    const statusEl = document.getElementById(`sb-status-${item.id}`);
    if (statusEl) {
      statusEl.innerText = '解析中';
      statusEl.className = 'upload-status processing';
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = item.imgUrl;

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const res = await analyzeLoadedImage(img, worker);
      if (res) {
        item.data = {
          title: res.title,
          level: res.level,
          diff: res.diff,
          good: res.missDetail.good,
          bad: res.missDetail.bad,
          missDetail: res.missDetail.miss,
          totalMiss: res.miss,
          musicId: res.musicId,
        };
        item.status = 'done';
      } else {
        item.status = 'error';
      }
    } catch (error) {
      console.error('Analysis Failed for ' + item.id, error);
      item.status = 'error';
    }

    updateSidebarStatus(item.id);
    if (item.status === 'done') {
      document.getElementById(`sb-title-${item.id}`).innerText = item.data.title;
      if (activeItemId === item.id) selectItem(item.id);
    } else {
      const statEl = document.getElementById(`sb-status-${item.id}`);
      if (statEl) {
        statEl.innerText = 'ERR';
        statEl.className = 'upload-status error';
      }
    }
  }

  await worker.terminate();
  statusMsg.innerText = '処理完了';
  checkBatchButton();
}

async function reanalyzeCurrentItem() {
  if (!activeItemId) return;
  const item = editorQueue.find((q) => q.id === activeItemId);
  if (item) await runBatchAnalysis([item]);
}

async function analyzeAllInBatch() {
  if (editorQueue.length === 0) return;
  await runBatchAnalysis(editorQueue);
}

async function handleFiles(files) {
  if (files.length === 0) return;
  document.getElementById('upload-initial').style.display = 'none';
  document.getElementById('batch-workspace').style.display = 'flex';
  document.getElementById('batch-status-msg').innerText = '画像を処理中...';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const qId = 'new_' + Date.now() + '_' + i;
    editorQueue.push({
      id: qId,
      file,
      imgUrl: URL.createObjectURL(file),
      status: 'pending',
      data: { title: '', level: '', diff: 'EXPERT', good: 0, bad: 0, missDetail: 0, totalMiss: 0, musicId: null },
      originalId: null,
      originalParent: null,
    });
    renderSidebarItem(qId);
  }

  await runBatchAnalysis(editorQueue.filter((item) => item.status === 'pending'));
  if (editorQueue.length > 0) {
    selectItem(editorQueue[0].id);
  }
  checkBatchButton();
}

async function batchEdit() {
  if (selectedIds.size === 0) return;
  openBatchModal('edit');

  const targets = allRecords.filter((r) => selectedIds.has(r.id));
  document.getElementById('batch-status-msg').innerText = '編集データを準備中...';

  for (const rec of targets) {
    const qId = 'edit_' + rec.id;
    const highResUrl = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
    editorQueue.push({
      id: qId,
      file: null,
      imgUrl: highResUrl,
      status: 'existing',
      data: {
        title: rec.title,
        level: rec.level,
        diff: rec.difficultyKey || rec.difficultyRaw || 'EXPERT',
        good: 0,
        bad: 0,
        missDetail: 0,
        totalMiss: rec.missCount,
        musicId: null,
      },
      originalId: rec.id,
      originalParent: rec.parentId,
    });
    renderSidebarItem(qId);
  }

  if (editorQueue.length > 0) selectItem(editorQueue[0].id);
  checkBatchButton();
  document.getElementById('batch-status-msg').innerText = '編集準備完了';
}

function individualEdit(id) {
  selectedIds.clear();
  selectedIds.add(id);
  batchEdit();
}

function toggleSelectMode() {
  isSelectMode = !isSelectMode;
  const btn = document.getElementById('btn-select-mode');
  if (isSelectMode) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
    selectedIds.clear();
    updateSelectionUI();
  }
  renderGrid(filteredRecords);
}

function toggleSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);

  const card = document.getElementById(`card-${id}`);
  if (card) {
    if (selectedIds.has(id)) card.classList.add('selected');
    else card.classList.remove('selected');
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  const bar = document.getElementById('batch-actions');
  const countSpan = document.getElementById('selected-count');
  if (countSpan) countSpan.innerText = selectedIds.size;
  if (bar) bar.style.display = selectedIds.size > 0 ? 'flex' : 'none';
}

function clearSelection() {
  selectedIds.clear();
  updateSelectionUI();
  renderGrid(filteredRecords);
}

function updateView() {
  if (!allRecords) return;

  const fcF = document.getElementById('filter-fc').value;
  const msMin = document.getElementById('filter-miss-min').value;
  const msMax = document.getElementById('filter-miss-max').value;
  const dfF = document.getElementById('filter-diff').value;
  const lvF = document.getElementById('filter-level').value;
  const tiF = document.getElementById('filter-title').value.trim().toLowerCase();

  let list = allRecords.slice();

  list = list.filter((r) => {
    if (fcF === 'fc' && !r.isFC) return false;
    if (fcF === 'unfc' && r.isFC) return false;
    if (!r.isFC) {
      const mVal = r.missCount;
      if (msMin !== '' && mVal < parseInt(msMin, 10)) return false;
      if (msMax !== '' && mVal > parseInt(msMax, 10)) return false;
    } else {
      if (msMin !== '' && 0 < parseInt(msMin, 10)) return false;
    }
    if (dfF !== 'all' && canonicalDifficulty(dfF) !== canonicalDifficulty(r.difficultyKey)) return false;
    if (lvF && String(r.level) !== String(lvF)) return false;
    if (tiF && !String(r.title).toLowerCase().includes(tiF)) return false;
    return true;
  });

  const sOrder = document.getElementById('sort-order').value;

  const compare = {
    titleAsc: (a, b) => a.title.localeCompare(b.title, 'ja'),
    titleDesc: (a, b) => b.title.localeCompare(a.title, 'ja'),
    levelAsc: (a, b) => Number(a.level) - Number(b.level),
    levelDesc: (a, b) => Number(b.level) - Number(a.level),
    missAsc: (a, b) => Number(a.missCount) - Number(b.missCount),
    missDesc: (a, b) => Number(b.missCount) - Number(a.missCount),
    dateAsc: (a, b) => new Date(a.createdTime || 0) - new Date(b.createdTime || 0),
    dateDesc: (a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0),
    diffAsc: (a, b) => (DIFFICULTY_RANK[a.difficultyKey] ?? 99) - (DIFFICULTY_RANK[b.difficultyKey] ?? 99),
  };

  const tieBreakDifficulty = (a, b) => compare.diffAsc(a, b);
  const tieBreakTitle = (a, b) => compare.titleAsc(a, b);
  const tieBreakMiss = (a, b) => compare.missAsc(a, b);
  const tieBreakDate = (a, b) => compare.dateAsc(a, b);

  list.sort((a, b) => {
    const title = compare.titleAsc(a, b);
    const titleDesc = compare.titleDesc(a, b);
    const levelAsc = compare.levelAsc(a, b);
    const levelDesc = compare.levelDesc(a, b);
    const missAsc = compare.missAsc(a, b);
    const missDesc = compare.missDesc(a, b);
    const dateDesc = compare.dateDesc(a, b);

    if (sOrder === 'title_asc') return title || tieBreakDifficulty(a, b) || tieBreakMiss(a, b) || tieBreakDate(a, b);
    if (sOrder === 'title_desc') return titleDesc || tieBreakDifficulty(a, b) || tieBreakMiss(a, b) || tieBreakDate(a, b);
    if (sOrder === 'level_asc') return levelAsc || tieBreakDifficulty(a, b) || tieBreakTitle(a, b) || tieBreakMiss(a, b) || tieBreakDate(a, b);
    if (sOrder === 'level_desc') return levelDesc || tieBreakDifficulty(a, b) || tieBreakTitle(a, b) || tieBreakMiss(a, b) || tieBreakDate(a, b);
    if (sOrder === 'miss_asc') return missAsc || levelAsc || tieBreakDifficulty(a, b) || tieBreakTitle(a, b) || tieBreakDate(a, b);
    if (sOrder === 'miss_desc') return missDesc || levelDesc || tieBreakDifficulty(a, b) || tieBreakTitle(a, b) || tieBreakDate(a, b);
    if (sOrder === 'date_desc') return dateDesc || tieBreakTitle(a, b);
    return title || tieBreakDifficulty(a, b) || tieBreakMiss(a, b) || tieBreakDate(a, b);
  });

  filteredRecords = list;
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

  records.forEach((rec) => {
    const thumb = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w600') : '';
    const large = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
    const missDisplay = rec.isFC ? `<span class="miss-val zero">FC-0</span>` : `FC -<span class="miss-val">${rec.missCount}</span>`;
    const badge = rec.isFC ? `<div class="fc-badge"><span class="material-symbols-outlined" style="font-size:1rem;">crown</span> FULL COMBO</div>` : '';
    const isSel = selectedIds.has(rec.id) ? 'selected' : '';

    let clickAction = '';
    let overlayActions = '';

    if (isSelectMode) {
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

    grid.innerHTML += `
      <div class="card ${rec.isFC ? 'is-fc' : ''} ${isSel} ${isSelectMode ? 'select-mode-active' : ''}" id="card-${rec.id}" onclick="${clickAction}">
        <div class="card-img-container">
          <div class="img-loader-spinner"></div>
          <img src="${thumb}" class="card-img" onload="this.style.opacity='1'; this.previousElementSibling.style.display='none';">
          ${badge}
          ${overlayActions}
        </div>
        <div class="card-body">
          <div class="song-meta">
            <span class="tag lvl">Lv.${rec.level}</span>
            <span class="tag diff-${rec.difficultyKey}">${escapeHtml(rec.difficultyLabel || rec.difficultyKey)}</span>
          </div>
          <div class="song-title">${escapeHtml(rec.title)}</div>
          <div class="score-info"><span style="display:flex;align-items:center;gap:2px;"><span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span> Result</span>${missDisplay}</div>
        </div>
      </div>
    `;
  });
}

function escapeHtml(t) {
  return t ? t.toString().replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])) : '';
}

function updateNotificationStatus() {
  const el = document.getElementById('notification-status');
  if (!el) return;
  if (!('Notification' in window)) {
    el.textContent = 'ブラウザ通知: 非対応';
  } else {
    el.textContent = `ブラウザ通知: ${Notification.permission === 'granted' ? '許可済み' : Notification.permission === 'denied' ? '拒否中' : '未許可'}`;
  }
}
