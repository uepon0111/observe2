
window.PrskApp = window.PrskApp || {};

(function (App) {
  const state = App.state;

  function showToast(message, type = 'info', timeout = 2600) {
    let container = App.q('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 250);
    }, timeout);
  }

  function renderSidebarItem(id) {
    const item = state.editorQueue.find((q) => q.id === id);
    if (!item) return;
    const div = document.createElement('div');
    div.className = 'sidebar-item';
    div.id = `sb-${id}`;
    div.onclick = () => selectItem(id);
    const thumbUrl = item.imgUrl;
    div.innerHTML = `
      <img src="${thumbUrl}" class="sidebar-thumb" crossorigin="anonymous">
      <div class="sidebar-info">
        <div class="sidebar-title" id="sb-title-${id}">${App.escapeHtml(item.data.title || '名称未設定')}</div>
        <div class="sidebar-status">
          <span id="sb-status-${id}" class="upload-status ${item.status === 'existing' ? 'done' : item.status}">${item.status === 'existing' ? 'EXIST' : item.status}</span>
          <button class="btn-remove-side" onclick="removeBatchItem(event, '${id}')">
            <span class="material-symbols-outlined" style="font-size:1rem;">delete</span>
          </button>
        </div>
      </div>
    `;
    App.q('batch-sidebar-list').appendChild(div);
  }

  function openBatchModal(mode) {
    state.currentMode = mode;
    const modal = App.q('batchModal');
    modal.style.display = 'flex';

    state.editorQueue = [];
    state.activeItemId = null;
    App.q('batch-sidebar-list').innerHTML = '';
    App.q('batch-editor-container').style.display = 'none';
    App.q('batch-empty-msg').style.display = 'block';
    App.q('batch-status-msg').innerText = '待機中...';
    App.q('btn-exec-batch').disabled = true;

    if (mode === 'upload') {
      App.q('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">cloud_upload</span> 画像アップロード';
      App.q('upload-initial').style.display = 'flex';
      App.q('batch-workspace').style.display = 'none';
      App.q('up-file').value = '';
      App.q('btn-exec-batch').innerText = '全てアップロード';
    } else {
      App.q('batch-modal-title').innerHTML = '<span class="material-symbols-outlined">edit_square</span> 編集・解析モード';
      App.q('upload-initial').style.display = 'none';
      App.q('batch-workspace').style.display = 'flex';
      App.q('btn-exec-batch').innerText = '保存して反映';
    }
  }

  function closeBatchModal() {
    App.q('batchModal').style.display = 'none';
  }

  function checkBatchButton() {
    const btn = App.q('btn-exec-batch');
    btn.disabled = state.editorQueue.length === 0;
    const label = state.currentMode === 'upload' ? '全てアップロード' : '保存して反映';
    btn.innerText = state.editorQueue.length > 0 ? `${label} (${state.editorQueue.length}件)` : label;
  }

  function updateCurrentItem(field, value) {
    const item = state.editorQueue.find((q) => q.id === state.activeItemId);
    if (!item) return;
    item.data[field] = value;

    if (field === 'good' || field === 'bad' || field === 'missDetail') {
      const good = Number(App.q('up-good').value || 0);
      const bad = Number(App.q('up-bad').value || 0);
      const miss = Number(App.q('up-miss-detail').value || 0);
      item.data.good = good;
      item.data.bad = bad;
      item.data.missDetail = miss;
      item.data.totalMiss = good + bad + miss;
      App.q('up-total-miss').innerText = String(item.data.totalMiss);
    }

    if (field === 'title') {
      const titleEl = App.q(`sb-title-${item.id}`);
      if (titleEl) titleEl.innerText = value || '名称未設定';
    }
    item.status = 'done';
    updateSidebarStatus(item.id);
    checkBatchButton();
  }

  function selectItem(id) {
    state.activeItemId = id;
    const item = state.editorQueue.find((q) => q.id === id);
    if (!item) return;

    document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
    const sbEl = App.q(`sb-${id}`);
    if (sbEl) sbEl.classList.add('active');

    App.q('batch-editor-container').style.display = 'flex';
    App.q('batch-empty-msg').style.display = 'none';

    const imgEl = App.q('batch-preview-img');
    imgEl.src = item.imgUrl;
    App.q('up-title').value = item.data.title || '';
    App.q('up-level').value = item.data.level || '';
    App.q('up-diff').value = item.data.diff || 'EXPERT';
    App.q('up-good').value = item.data.good || 0;
    App.q('up-bad').value = item.data.bad || 0;
    App.q('up-miss-detail').value = item.data.missDetail || 0;
    App.q('up-total-miss').innerText = String(item.data.totalMiss || 0);
  }

  function updateSidebarStatus(id) {
    const item = state.editorQueue.find((q) => q.id === id);
    if (!item) return;
    const statusEl = App.q(`sb-status-${id}`);
    if (!statusEl) return;
    statusEl.innerText = item.status === 'done' ? 'OK' : item.status === 'existing' ? 'EXIST' : item.status;
    statusEl.className = `upload-status ${item.status === 'error' ? 'error' : item.status === 'processing' ? 'processing' : 'done'}`;
  }

  function removeBatchItem(e, id) {
    e.stopPropagation();
    const item = state.editorQueue.find((q) => q.id === id);
    if (item?.imgUrl && item.file instanceof File) {
      try { URL.revokeObjectURL(item.imgUrl); } catch (_) {}
    }
    state.editorQueue = state.editorQueue.filter((q) => q.id !== id);
    const node = App.q(`sb-${id}`);
    if (node) node.remove();
    if (state.activeItemId === id) {
      App.q('batch-editor-container').style.display = 'none';
      App.q('batch-empty-msg').style.display = 'block';
      state.activeItemId = null;
    }
    checkBatchButton();
  }

  function handleFiles(files) {
    if (!files || files.length === 0) return Promise.resolve();
    App.q('upload-initial').style.display = 'none';
    App.q('batch-workspace').style.display = 'flex';
    App.q('batch-status-msg').innerText = '画像を処理中...';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const qId = `new_${Date.now()}_${i}`;
      state.editorQueue.push({
        id: qId,
        file,
        imgUrl: URL.createObjectURL(file),
        status: 'pending',
        data: {
          title: '',
          level: '',
          diff: 'EXPERT',
          good: 0,
          bad: 0,
          missDetail: 0,
          totalMiss: 0,
          musicId: null,
        },
        originalId: null,
      });
      renderSidebarItem(qId);
    }

    const pending = state.editorQueue.filter((i) => i.status === 'pending');
    return App.runBatchAnalysis(pending).then(() => {
      if (!state.activeItemId && state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
      checkBatchButton();
    });
  }

  async function batchEdit() {
    if (state.selectedIds.size === 0) return;
    openBatchModal('edit');

    const targets = state.allRecords.filter((r) => state.selectedIds.has(r.id));
    App.q('batch-status-msg').innerText = '編集データを準備中...';

    for (const rec of targets) {
      const qId = `edit_${rec.id}`;
      const highResUrl = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
      state.editorQueue.push({
        id: qId,
        file: null,
        imgUrl: highResUrl,
        status: 'existing',
        data: {
          title: rec.title,
          level: rec.level,
          diff: rec.difficultyCode || rec.difficultyRaw || 'EXPERT',
          good: 0,
          bad: 0,
          missDetail: 0,
          totalMiss: rec.missCount,
          musicId: null,
        },
        originalId: rec.id,
        originalParent: rec.parentId,
        originalAddedAt: rec.addedAt || null,
      });
      renderSidebarItem(qId);
    }
    if (state.editorQueue.length > 0) selectItem(state.editorQueue[0].id);
    checkBatchButton();
    App.q('batch-status-msg').innerText = '編集準備完了';
  }

  async function handleBatchExecution() {
    const btn = App.q('btn-exec-batch');
    btn.disabled = true;
    btn.innerText = '処理中...';
    if (state.currentMode === 'upload') await App.executeUploads();
    else await App.executeEdits();
  }

  function toggleSelectMode() {
    state.isSelectMode = !state.isSelectMode;
    const btn = App.q('btn-select-mode');
    if (state.isSelectMode) btn.classList.add('active');
    else {
      btn.classList.remove('active');
      state.selectedIds.clear();
      updateSelectionUI();
    }
    App.renderGrid(state.filteredRecords);
  }

  function toggleSelection(id) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
    const card = App.q(`card-${id}`);
    if (card) card.classList.toggle('selected', state.selectedIds.has(id));
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const bar = App.q('batch-actions');
    const countSpan = App.q('selected-count');
    countSpan.innerText = String(state.selectedIds.size);
    bar.style.display = state.selectedIds.size > 0 ? 'flex' : 'none';
  }

  function clearSelection() {
    state.selectedIds.clear();
    updateSelectionUI();
    App.renderGrid(state.filteredRecords);
  }

  function individualEdit(id) {
    state.selectedIds.clear();
    state.selectedIds.add(id);
    batchEdit();
  }

  async function individualDelete(id) {
    if (!confirm('このリザルトを削除しますか？')) return;
    App.show('loader', 'flex');
    App.q('grid').innerHTML = '';
    try {
      await gapi.client.drive.files.delete({ fileId: id });
      alert('削除しました');
      await App.fetchDataFromDrive();
    } catch (e) {
      alert('エラー: ' + e.message);
      App.fetchDataFromDrive();
    }
  }

  async function batchDelete() {
    if (!confirm(`選択した ${state.selectedIds.size} 件を削除しますか？`)) return;
    App.show('loader', 'flex');
    App.q('grid').innerHTML = '';
    try {
      for (const id of state.selectedIds) {
        await gapi.client.drive.files.delete({ fileId: id });
      }
      alert('削除しました');
      state.selectedIds.clear();
      updateSelectionUI();
      await App.fetchDataFromDrive();
    } catch (e) {
      alert('削除エラー: ' + e.message);
      App.fetchDataFromDrive();
    }
  }

  function toggleBestOnly() {
    state.settings.showBestOnly = !!App.q('show-best-only').checked;
    App.saveSettings();
    App.updateView();
  }

  function toggleSortDirection() {
    state.settings.sortDirection = state.settings.sortDirection === 'desc' ? 'asc' : 'desc';
    App.saveSettings();
    App.updateSortDirectionButton();
    App.updateView();
  }

  function setSortMode(mode) {
    state.settings.sortMode = mode;
    App.saveSettings();
    App.updateView();
  }

  function bindUiEvents() {
    App.q('drop-zone')?.addEventListener('dragover', (e) => { e.preventDefault(); App.q('drop-zone').classList.add('dragover'); });
    App.q('drop-zone')?.addEventListener('dragleave', (e) => { e.preventDefault(); App.q('drop-zone').classList.remove('dragover'); });
    App.q('drop-zone')?.addEventListener('drop', (e) => {
      e.preventDefault();
      App.q('drop-zone').classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    });
    App.q('up-file')?.addEventListener('change', (e) => handleFiles(e.target.files));
  }

  App.showToast = showToast;
  App.renderSidebarItem = renderSidebarItem;
  App.openBatchModal = openBatchModal;
  App.closeBatchModal = closeBatchModal;
  App.checkBatchButton = checkBatchButton;
  App.updateCurrentItem = updateCurrentItem;
  App.selectItem = selectItem;
  App.updateSidebarStatus = updateSidebarStatus;
  App.removeBatchItem = removeBatchItem;
  App.handleFiles = handleFiles;
  App.batchEdit = batchEdit;
  App.handleBatchExecution = handleBatchExecution;
  App.toggleSelectMode = toggleSelectMode;
  App.toggleSelection = toggleSelection;
  App.updateSelectionUI = updateSelectionUI;
  App.clearSelection = clearSelection;
  App.individualEdit = individualEdit;
  App.individualDelete = individualDelete;
  App.batchDelete = batchDelete;
  App.toggleBestOnly = toggleBestOnly;
  App.toggleSortDirection = toggleSortDirection;
  App.setSortMode = setSortMode;
  App.bindUiEvents = bindUiEvents;

  Object.assign(window, {
    showToast,
    openBatchModal,
    closeBatchModal,
    checkBatchButton,
    updateCurrentItem,
    selectItem,
    updateSidebarStatus,
    removeBatchItem,
    handleFiles,
    batchEdit,
    handleBatchExecution,
    toggleSelectMode,
    toggleSelection,
    updateSelectionUI,
    clearSelection,
    individualEdit,
    individualDelete,
    batchDelete,
    toggleBestOnly,
    toggleSortDirection,
  });
})(window.PrskApp);
