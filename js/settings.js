
window.PrskApp = window.PrskApp || {};

(function (App) {
  const state = App.state;
  const regionOrder = ['diff', 'title', 'miss'];

  const editor = {
    region: 'diff',
    dragging: false,
    resizing: null,
    startX: 0,
    startY: 0,
    startBox: null,
    pointerId: null,
  };

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function getRegion() {
    return state.settings.cropRegions[editor.region];
  }

  function getDefaultRegion(region) {
    return JSON.parse(JSON.stringify(App.CONFIG.DEFAULT_CROP_REGIONS[region]));
  }

  function parsePercentInput(id) {
    const el = App.q(id);
    const num = parseFloat(el?.value || '0');
    return Number.isFinite(num) ? num / 100 : 0;
  }

  function saveCurrentRegionFromInputs() {
    const region = state.settings.cropRegions[editor.region];
    region.x = clamp(parsePercentInput('crop-x'), 0, 0.98);
    region.y = clamp(parsePercentInput('crop-y'), 0, 0.98);
    region.w = clamp(parsePercentInput('crop-w'), 0.02, 1 - region.x);
    region.h = clamp(parsePercentInput('crop-h'), 0.02, 1 - region.y);
    region.w = clamp(region.w, 0.02, 1 - region.x);
    region.h = clamp(region.h, 0.02, 1 - region.y);
    App.saveSettings();
  }

  function syncInputsFromCurrentRegion() {
    const region = getRegion();
    App.q('crop-x').value = (region.x * 100).toFixed(1);
    App.q('crop-y').value = (region.y * 100).toFixed(1);
    App.q('crop-w').value = (region.w * 100).toFixed(1);
    App.q('crop-h').value = (region.h * 100).toFixed(1);
    const note = App.q('crop-region-note');
    if (note) {
      note.innerText = editor.region === 'diff'
        ? '難易度の読み取り位置を調整します。'
        : editor.region === 'title'
          ? '曲名の読み取り位置を調整します。'
          : '総ミスの読み取り位置を調整します。';
    }
  }

  function updateActiveButtons() {
    document.querySelectorAll('[data-crop-region]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.cropRegion === editor.region);
    });
  }

  function updateOverlayPosition() {
    const overlay = App.q('crop-overlay');
    const preview = App.q('settings-preview-wrap');
    if (!overlay || !preview) return;
    const region = getRegion();
    overlay.style.left = `${region.x * 100}%`;
    overlay.style.top = `${region.y * 100}%`;
    overlay.style.width = `${region.w * 100}%`;
    overlay.style.height = `${region.h * 100}%`;
    overlay.dataset.region = editor.region;
  }

  function applyRegionToPreview() {
    syncInputsFromCurrentRegion();
    updateOverlayPosition();
    updateActiveButtons();
  }

  function selectCropRegion(region) {
    if (!state.settings.cropRegions[region]) return;
    saveCurrentRegionFromInputs();
    editor.region = region;
    state.ui.activeCropRegion = region;
    applyRegionToPreview();
    App.saveUiState();
  }

  function resetCurrentRegion() {
    state.settings.cropRegions[editor.region] = getDefaultRegion(editor.region);
    App.saveSettings();
    applyRegionToPreview();
  }

  function resetAllRegions() {
    state.settings.cropRegions = JSON.parse(JSON.stringify(App.CONFIG.DEFAULT_CROP_REGIONS));
    App.saveSettings();
    applyRegionToPreview();
  }

  function onInputChange() {
    saveCurrentRegionFromInputs();
    updateOverlayPosition();
  }

  function onSampleImageChange(file) {
    if (!file) return;
    if (state.ui.sampleImageUrl) {
      try { URL.revokeObjectURL(state.ui.sampleImageUrl); } catch (_) {}
    }
    const url = URL.createObjectURL(file);
    state.ui.sampleImageUrl = url;
    App.saveUiState();
    App.q('settings-sample-preview').src = url;
  }

  function loadSamplePreview() {
    const img = App.q('settings-sample-preview');
    if (!img) return;
    img.src = state.ui.sampleImageUrl || '';
  }

  function bindOverlayInteractions() {
    const overlay = App.q('crop-overlay');
    const wrap = App.q('settings-preview-wrap');
    if (!overlay || !wrap) return;

    const startDrag = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const handle = e.target.closest('.crop-handle');
      const region = getRegion();
      const rect = wrap.getBoundingClientRect();
      editor.pointerId = e.pointerId;
      overlay.setPointerCapture?.(e.pointerId);

      editor.startX = e.clientX;
      editor.startY = e.clientY;
      editor.startBox = { ...region };
      editor.dragging = !handle;
      editor.resizing = handle ? handle.dataset.handle : null;
      e.preventDefault();
    };

    const moveDrag = (e) => {
      if (editor.pointerId !== e.pointerId || (!editor.dragging && !editor.resizing)) return;
      const rect = wrap.getBoundingClientRect();
      const dx = (e.clientX - editor.startX) / rect.width;
      const dy = (e.clientY - editor.startY) / rect.height;
      const box = { ...editor.startBox };
      const minSize = 0.02;

      if (editor.dragging) {
        box.x = clamp(editor.startBox.x + dx, 0, 1 - box.w);
        box.y = clamp(editor.startBox.y + dy, 0, 1 - box.h);
      } else if (editor.resizing) {
        const right = editor.startBox.x + editor.startBox.w;
        const bottom = editor.startBox.y + editor.startBox.h;
        if (editor.resizing.includes('e')) box.w = clamp(editor.startBox.w + dx, minSize, 1 - box.x);
        if (editor.resizing.includes('s')) box.h = clamp(editor.startBox.h + dy, minSize, 1 - box.y);
        if (editor.resizing.includes('w')) {
          box.x = clamp(editor.startBox.x + dx, 0, right - minSize);
          box.w = clamp(right - box.x, minSize, 1 - box.x);
        }
        if (editor.resizing.includes('n')) {
          box.y = clamp(editor.startBox.y + dy, 0, bottom - minSize);
          box.h = clamp(bottom - box.y, minSize, 1 - box.y);
        }
      }

      box.w = clamp(box.w, minSize, 1 - box.x);
      box.h = clamp(box.h, minSize, 1 - box.y);
      state.settings.cropRegions[editor.region] = box;
      App.saveSettings();
      applyRegionToPreview();
      e.preventDefault();
    };

    const endDrag = (e) => {
      if (editor.pointerId !== e.pointerId) return;
      editor.dragging = false;
      editor.resizing = null;
      editor.pointerId = null;
      overlay.releasePointerCapture?.(e.pointerId);
      saveCurrentRegionFromInputs();
    };

    overlay.addEventListener('pointerdown', startDrag);
    overlay.addEventListener('pointermove', moveDrag);
    overlay.addEventListener('pointerup', endDrag);
    overlay.addEventListener('pointercancel', endDrag);
  }

  function syncGeneralSettings() {
    const best = App.q('show-best-only');
    if (best) best.checked = !!state.settings.showBestOnly;
    const sortMode = App.q('sort-mode');
    if (sortMode) sortMode.value = state.settings.sortMode;
    App.updateSortDirectionButton();
  }

  function openSettingsModal() {
    App.loadSettings();
    syncGeneralSettings();
    editor.region = state.ui.activeCropRegion || 'diff';
    loadSamplePreview();
    App.q('settingsModal').style.display = 'flex';
    updateActiveButtons();
    applyRegionToPreview();
    setTimeout(() => {
      const img = App.q('settings-sample-preview');
      if (img?.complete) updateOverlayPosition();
    }, 100);
  }

  function closeSettingsModal() {
    App.q('settingsModal').style.display = 'none';
  }

  function saveSettingsModal() {
    saveCurrentRegionFromInputs();
    const best = App.q('show-best-only');
    if (best) state.settings.showBestOnly = !!best.checked;
    const sortMode = App.q('sort-mode');
    if (sortMode) state.settings.sortMode = sortMode.value;
    App.saveSettings();
    App.updateSortDirectionButton();
    App.updateBestOnlyCheckbox();
    App.updateSortModeSelect();
    App.updateView();
    closeSettingsModal();
    App.showToast('設定を保存しました', 'success');
  }

  function initSettingsUi() {
    const sample = App.q('settings-sample-file');
    if (sample) {
      sample.addEventListener('change', (e) => onSampleImageChange(e.target.files?.[0]));
    }
    const closeOnBackdrop = (e) => {
      if (e.target === e.currentTarget) closeSettingsModal();
    };
    const modal = App.q('settingsModal');
    if (modal) modal.addEventListener('click', closeOnBackdrop);

    ['crop-x', 'crop-y', 'crop-w', 'crop-h'].forEach((id) => {
      App.q(id)?.addEventListener('input', onInputChange);
    });

    App.q('crop-reset-current')?.addEventListener('click', resetCurrentRegion);
    App.q('crop-reset-all')?.addEventListener('click', resetAllRegions);
    App.q('crop-save')?.addEventListener('click', saveSettingsModal);
    App.q('crop-close')?.addEventListener('click', closeSettingsModal);

    regionOrder.forEach((region) => {
      App.q(`crop-btn-${region}`)?.addEventListener('click', () => selectCropRegion(region));
    });

    bindOverlayInteractions();
  }

  App.selectCropRegion = selectCropRegion;
  App.openSettingsModal = openSettingsModal;
  App.closeSettingsModal = closeSettingsModal;
  App.saveSettingsModal = saveSettingsModal;
  App.initSettingsUi = initSettingsUi;
  App.resetCurrentCropRegion = resetCurrentRegion;
  App.resetAllCropRegions = resetAllRegions;
  App.syncGeneralSettings = syncGeneralSettings;

  Object.assign(window, {
    openSettingsModal,
    closeSettingsModal,
  });
})(window.PrskApp);
