
const { showToast, getBestMissForKey, notifyBestUpdate, recordKey, makeFileName, makeFileDescription, recordDisplayDiff } = window.PRSK_UTILS;

function openBatchModal(mode) {
  PRSK.state.currentMode = mode;
  const modal = document.getElementById('batchModal');
  modal.style.display = 'flex';

  PRSK.state.editorQueue = [];
  PRSK.state.activeItemId = null;
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
async function handleFiles(files) {
  if (!files || files.length === 0) return;
  document.getElementById('upload-initial').style.display = 'none';
  document.getElementById('batch-workspace').style.display = 'flex';
  document.getElementById('batch-status-msg').innerText = '画像を処理中...';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const qId = 'new_' + Date.now() + '_' + i;
    PRSK.state.editorQueue.push({
      id: qId,
      file,
      imgUrl: URL.createObjectURL(file),
      status: 'pending',
      data: { title: '', level: '', diff: 'master', good: 0, bad: 0, missDetail: 0, totalMiss: 0, musicId: null },
      originalId: null,
      originalParent: null
    });
    renderSidebarItem(qId);
  }

  await runBatchAnalysis(PRSK.state.editorQueue.filter(i => i.status === 'pending'));
  if (!PRSK.state.activeItemId && PRSK.state.editorQueue.length > 0) selectItem(PRSK.state.editorQueue[0].id);
  checkBatchButton();
}
function batchEdit() {
  if (PRSK.state.selectedIds.size === 0) return;
  openBatchModal('edit');

  const targets = PRSK.state.allRecords.filter(r => PRSK.state.selectedIds.has(r.id));
  document.getElementById('batch-status-msg').innerText = '編集データを準備中...';

  for (const rec of targets) {
    const qId = 'edit_' + rec.id;
    const highResUrl = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';

    PRSK.state.editorQueue.push({
      id: qId,
      file: null,
      imgUrl: highResUrl,
      status: 'existing',
      data: {
        title: rec.title,
        level: rec.level,
        diff: rec.difficultyRaw,
        good: rec.good || 0,
        bad: rec.bad || 0,
        missDetail: rec.missDetail || 0,
        totalMiss: rec.missCount,
        musicId: rec.musicId || null
      },
      originalId: rec.id,
      originalParent: rec.parentId || null
    });
    renderSidebarItem(qId);
  }
  if (PRSK.state.editorQueue.length > 0) selectItem(PRSK.state.editorQueue[0].id);
  checkBatchButton();
  document.getElementById('batch-status-msg').innerText = '編集準備完了';
}
function renderSidebarItem(id) {
  const item = PRSK.state.editorQueue.find(q => q.id === id);
  const div = document.createElement('div');
  div.className = 'sidebar-item';
  div.id = `sb-${id}`;
  div.onclick = () => selectItem(id);
  div.innerHTML = `
    ${item.imgUrl ? `<img src="${item.imgUrl}" class="sidebar-thumb" crossorigin="anonymous">` : `<div class="sidebar-thumb" style="display:flex;align-items:center;justify-content:center;color:#94a3b8;background:#f8fafc;">NO IMAGE</div>`}
    <div class="sidebar-info">
      <div class="sidebar-title" id="sb-title-${id}">${escapeHtml(item.data.title || '名称未設定')}</div>
      <div class="sidebar-status">
        <span id="sb-status-${id}" class="upload-status ${item.status === 'existing' ? 'done' : item.status}">
          ${item.status === 'existing' ? 'EXIST' : item.status}
        </span>
        <button class="btn-remove-side" onclick="removeBatchItem(event, '${id}')">
          <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
        </button>
      </div>
    </div>
  `;
  document.getElementById('batch-sidebar-list').appendChild(div);
}
function selectItem(id) {
  PRSK.state.activeItemId = id;
  const item = PRSK.state.editorQueue.find(q => q.id === id);
  if (!item) return;
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const sbEl = document.getElementById(`sb-${id}`);
  if (sbEl) sbEl.classList.add('active');

  document.getElementById('batch-editor-container').style.display = 'flex';
  document.getElementById('batch-empty-msg').style.display = 'none';

  const imgEl = document.getElementById('batch-preview-img');
  imgEl.src = item.imgUrl || '';
  imgEl.style.display = item.imgUrl ? 'block' : 'none';

  document.getElementById('up-title').value = item.data.title || '';
  document.getElementById('up-level').value = item.data.level || '';
  document.getElementById('up-diff').value = item.data.diff || 'master';
  document.getElementById('up-good').value = item.data.good || 0;
  document.getElementById('up-bad').value = item.data.bad || 0;
  document.getElementById('up-miss-detail').value = item.data.missDetail || 0;
  document.getElementById('up-total-miss').innerText = item.data.totalMiss || 0;
}
function updateCurrentItem(field, value) {
  if (!PRSK.state.activeItemId) return;
  const item = PRSK.state.editorQueue.find(q => q.id === PRSK.state.activeItemId);
  if (!item) return;

  if (['good', 'bad', 'missDetail', 'level'].includes(field)) {
    item.data[field] = parseInt(value, 10) || 0;
  } else {
    item.data[field] = value;
  }
  if (field === 'diff' && item.data.musicId) {
    const newLvl = getLevelFromDb(item.data.musicId, value);
    if (newLvl) {
      item.data.level = newLvl;
      document.getElementById('up-level').value = newLvl;
    }
  }
  if (['good', 'bad', 'missDetail'].includes(field)) {
    item.data.totalMiss = (parseInt(item.data.good, 10) || 0) + (parseInt(item.data.bad, 10) || 0) + (parseInt(item.data.missDetail, 10) || 0);
    document.getElementById('up-total-miss').innerText = item.data.totalMiss;
  }
  if (field === 'title') document.getElementById(`sb-title-${PRSK.state.activeItemId}`).innerText = value || '名称未設定';
  item.status = 'done';
  updateSidebarStatus(PRSK.state.activeItemId);
}
function updateSidebarStatus(id) {
  const statusEl = document.getElementById(`sb-status-${id}`);
  const item = PRSK.state.editorQueue.find(q => q.id === id);
  if (!statusEl || !item) return;
  if (item.status === 'existing') {
    statusEl.innerText = 'EXIST';
    statusEl.className = 'upload-status done';
    return;
  }
  statusEl.innerText = item.status === 'error' ? 'ERR' : 'OK';
  statusEl.className = item.status === 'error' ? 'upload-status error' : 'upload-status done';
}
function removeBatchItem(e, id) {
  e.stopPropagation();
  PRSK.state.editorQueue = PRSK.state.editorQueue.filter(q => q.id !== id);
  const el = document.getElementById(`sb-${id}`);
  if (el) el.remove();
  if (PRSK.state.activeItemId === id) {
    document.getElementById('batch-editor-container').style.display = 'none';
    document.getElementById('batch-empty-msg').style.display = 'block';
    PRSK.state.activeItemId = null;
  }
  checkBatchButton();
}
function checkBatchButton() {
  const btn = document.getElementById('btn-exec-batch');
  btn.disabled = PRSK.state.editorQueue.length === 0;
  const label = PRSK.state.currentMode === 'upload' ? '全てアップロード' : '保存して反映';
  btn.innerText = PRSK.state.editorQueue.length > 0 ? `${label} (${PRSK.state.editorQueue.length}件)` : label;
}

async function runBatchAnalysis(itemsToAnalyze) {
  if (!itemsToAnalyze || itemsToAnalyze.length === 0) return;
  const statusMsg = document.getElementById('batch-status-msg');
  statusMsg.innerText = '解析中... (しばらくお待ちください)';

  const worker = await Tesseract.createWorker(['jpn', 'eng']);
  for (const item of itemsToAnalyze) {
    const el = document.getElementById(`sb-status-${item.id}`);
    if (el) {
      el.innerText = '解析中';
      el.className = 'upload-status processing';
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
          musicId: res.musicId
        };
        item.status = 'done';
      } else {
        item.status = 'error';
      }
    } catch (e) {
      console.error('Analysis Failed for ' + item.id, e);
      item.status = 'error';
    }
    updateSidebarStatus(item.id);
    if (item.status === 'done') {
      document.getElementById(`sb-title-${item.id}`).innerText = item.data.title;
      if (PRSK.state.activeItemId === item.id) selectItem(item.id);
    } else {
      const statEl = document.getElementById(`sb-status-${item.id}`);
      if (statEl) { statEl.innerText = 'ERR'; statEl.className = 'upload-status error'; }
    }
  }
  await worker.terminate();
  statusMsg.innerText = '処理完了';
}
async function reanalyzeCurrentItem() {
  if (!PRSK.state.activeItemId) return;
  const item = PRSK.state.editorQueue.find(q => q.id === PRSK.state.activeItemId);
  if (item) await runBatchAnalysis([item]);
}
async function analyzeAllInBatch() {
  if (PRSK.state.editorQueue.length === 0) return;
  await runBatchAnalysis(PRSK.state.editorQueue.filter(i => i.status !== 'existing'));
}
async function handleBatchExecution() {
  const btn = document.getElementById('btn-exec-batch');
  btn.disabled = true;
  btn.innerText = '処理中...';
  try {
    if (PRSK.state.currentMode === 'upload') await executeUploads();
    else await executeEdits();
  } catch (e) {
    console.error(e);
    showToast('処理エラー', e.message || '実行に失敗しました', 'error', 4000);
    checkBatchButton();
  }
}
async function executeUploads() {
  let successCount = 0;
  for (const item of [...PRSK.state.editorQueue]) {
    const sbStatus = document.getElementById(`sb-status-${item.id}`);
    if (sbStatus) { sbStatus.innerText = '送信中'; sbStatus.className = 'upload-status processing'; }
    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const bestBefore = getBestMissForKey(item.data);
      await uploadResultFile(item);
      PRSK.state.editorQueue = PRSK.state.editorQueue.filter(q => q.id !== item.id);
      const sb = document.getElementById(`sb-${item.id}`);
      if (sb) sb.remove();
      successCount++;

      if (item.data.totalMiss < (bestBefore ?? Infinity)) {
        await notifyBestUpdate({
          title: item.data.title,
          level: item.data.level,
          diff: item.data.diff,
          previousBest: bestBefore,
          currentMiss: item.data.totalMiss
        });
      }
    } catch (e) {
      console.error(e);
      if (sbStatus) { sbStatus.innerText = '失敗'; sbStatus.className = 'upload-status error'; }
    }
  }
  finishExecution(successCount, 'アップロード');
}
async function executeEdits() {
  let successCount = 0;
  for (const item of [...PRSK.state.editorQueue]) {
    const sbStatus = document.getElementById(`sb-status-${item.id}`);
    if (sbStatus) { sbStatus.innerText = '保存中'; sbStatus.className = 'upload-status processing'; }
    try {
      if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
      const bestBefore = getBestMissForKey(item.data, item.originalId);
      await updateResultFile(item);

      PRSK.state.editorQueue = PRSK.state.editorQueue.filter(q => q.id !== item.id);
      const sb = document.getElementById(`sb-${item.id}`);
      if (sb) sb.remove();
      successCount++;

      if (item.data.totalMiss < (bestBefore ?? Infinity)) {
        await notifyBestUpdate({
          title: item.data.title,
          level: item.data.level,
          diff: item.data.diff,
          previousBest: bestBefore,
          currentMiss: item.data.totalMiss
        });
      }
    } catch (e) {
      console.error(e);
      if (sbStatus) { sbStatus.innerText = '失敗'; sbStatus.className = 'upload-status error'; }
    }
  }
  finishExecution(successCount, '更新');
}
function finishExecution(count, actionName) {
  if (PRSK.state.editorQueue.length === 0) {
    showToast(`${actionName}完了`, `${count}件`, 'success', 3200);
    closeBatchModal();
    PRSK.state.selectedIds.clear();
    updateSelectionUI();
    fetchDataFromDrive();
  } else {
    showToast(`${count}件 ${actionName}成功`, 'エラー分を確認してください', 'warn', 3800);
    checkBatchButton();
  }
}

window.openBatchModal = openBatchModal;
window.closeBatchModal = closeBatchModal;
window.handleFiles = handleFiles;
window.batchEdit = batchEdit;
window.renderSidebarItem = renderSidebarItem;
window.selectItem = selectItem;
window.updateCurrentItem = updateCurrentItem;
window.updateSidebarStatus = updateSidebarStatus;
window.removeBatchItem = removeBatchItem;
window.checkBatchButton = checkBatchButton;
window.runBatchAnalysis = runBatchAnalysis;
window.reanalyzeCurrentItem = reanalyzeCurrentItem;
window.analyzeAllInBatch = analyzeAllInBatch;
window.handleBatchExecution = handleBatchExecution;
window.executeUploads = executeUploads;
window.executeEdits = executeEdits;
window.finishExecution = finishExecution;
