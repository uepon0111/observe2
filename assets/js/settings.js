function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCropRegion(region) {
  const clamp = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
  return {
    x: clamp(Number(region.x), 0, 100),
    y: clamp(Number(region.y), 0, 100),
    w: clamp(Number(region.w), 1, 100),
    h: clamp(Number(region.h), 1, 100),
    mode: region.mode || 'standard',
  };
}

function loadCropSettings() {
  try {
    const raw = localStorage.getItem('prsk-result-viewer-crop-settings');
    if (!raw) return deepClone(DEFAULT_CROP_SETTINGS);
    const parsed = JSON.parse(raw);
    return {
      diff: normalizeCropRegion({ ...DEFAULT_CROP_SETTINGS.diff, ...(parsed.diff || {}) }),
      title: normalizeCropRegion({ ...DEFAULT_CROP_SETTINGS.title, ...(parsed.title || {}) }),
      miss: normalizeCropRegion({ ...DEFAULT_CROP_SETTINGS.miss, ...(parsed.miss || {}) }),
    };
  } catch (error) {
    console.error(error);
    return deepClone(DEFAULT_CROP_SETTINGS);
  }
}

function saveCropSettingsToStorage() {
  localStorage.setItem('prsk-result-viewer-crop-settings', JSON.stringify(cropSettings));
}

function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;
  renderCropEditor();
  updateNotificationStatus();
  modal.style.display = 'flex';
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.style.display = 'none';
}

function resetCropSettings() {
  if (!confirm('解析範囲をデフォルトに戻しますか？')) return;
  cropSettings = deepClone(DEFAULT_CROP_SETTINGS);
  saveCropSettingsToStorage();
  renderCropEditor();
  showToast('解析範囲をデフォルトに戻しました', 'success');
}

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('このブラウザは通知に対応していません', 'warn');
    return;
  }
  Notification.requestPermission().then((result) => {
    updateNotificationStatus(result);
    if (result === 'granted') {
      showToast('通知を許可しました', 'success');
    } else {
      showToast('通知は許可されませんでした', 'warn');
    }
  });
}

function updateNotificationStatus(permission = ('Notification' in window ? Notification.permission : 'unsupported')) {
  const el = document.getElementById('notification-status');
  if (!el) return;
  if (permission === 'granted') {
    el.textContent = 'ブラウザ通知: 許可済み';
  } else if (permission === 'denied') {
    el.textContent = 'ブラウザ通知: 拒否中';
  } else if (permission === 'unsupported') {
    el.textContent = 'ブラウザ通知: 非対応';
  } else {
    el.textContent = 'ブラウザ通知: 未許可';
  }
}

function renderCropEditor() {
  const list = document.getElementById('crop-region-list');
  if (!list) return;

  const entries = [
    ['diff', '難易度'],
    ['title', '曲名'],
    ['miss', 'ミス数'],
  ];

  list.innerHTML = '';
  for (const [key, label] of entries) {
    const region = cropSettings[key];
    const card = document.createElement('div');
    card.className = 'crop-card';
    card.innerHTML = `
      <div class="crop-mini" style="margin-bottom:10px;">
        <strong>${label}</strong>
        <span>${key === 'diff' ? '難易度表示' : key === 'title' ? '楽曲名' : 'GOOD/BAD/MISS'}</span>
      </div>
      <div class="crop-row">
        <label>X<input type="number" min="0" max="100" step="0.1" data-key="${key}" data-field="x" value="${region.x}"></label>
        <label>Y<input type="number" min="0" max="100" step="0.1" data-key="${key}" data-field="y" value="${region.y}"></label>
        <label>W<input type="number" min="1" max="100" step="0.1" data-key="${key}" data-field="w" value="${region.w}"></label>
        <label>H<input type="number" min="1" max="100" step="0.1" data-key="${key}" data-field="h" value="${region.h}"></label>
      </div>
      <div class="settings-note" style="margin-top:8px;">ドラッグで位置を微調整できます。</div>
    `;
    list.appendChild(card);
  }

  list.querySelectorAll('input[type="number"]').forEach((input) => {
    input.oninput = () => {
      const key = input.dataset.key;
      const field = input.dataset.field;
      cropSettings[key] = normalizeCropRegion({ ...cropSettings[key], [field]: Number(input.value) });
      updateCropPreview();
    };
  });

  updateCropPreview();
}

function setSamplePreviewImage(fileOrUrl) {
  const img = document.getElementById('settings-preview-img');
  const stage = document.getElementById('settings-preview-stage');
  if (!img || !stage) return;

  if (typeof fileOrUrl === 'string') {
    samplePreviewUrl = fileOrUrl;
  } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
    if (samplePreviewUrl && samplePreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(samplePreviewUrl);
    }
    samplePreviewUrl = URL.createObjectURL(fileOrUrl);
  } else {
    return;
  }

  img.onload = () => {
    img.style.display = 'block';
    updateCropPreview();
  };
  img.src = samplePreviewUrl;
  img.style.display = 'block';
}

function updateCropPreview() {
  const img = document.getElementById('settings-preview-img');
  const stage = document.getElementById('settings-preview-stage');
  if (!img || !stage) return;

  stage.querySelectorAll('.crop-box').forEach((node) => node.remove());
  if (!img.src) return;

  const boxes = [
    ['diff', '難易度'],
    ['title', '曲名'],
    ['miss', 'ミス数'],
  ];

  const stageRect = stage.getBoundingClientRect();
  const stageW = stageRect.width || 1;
  const stageH = img.getBoundingClientRect().height || stageRect.height || 1;

  for (const [key, label] of boxes) {
    const region = cropSettings[key];
    const box = document.createElement('div');
    box.className = 'crop-box';
    box.dataset.key = key;
    box.innerHTML = `<span class="crop-label">${label}</span>`;
    box.style.left = `${region.x}%`;
    box.style.top = `${region.y}%`;
    box.style.width = `${region.w}%`;
    box.style.height = `${region.h}%`;

    box.addEventListener('pointerdown', startCropDrag);
    stage.appendChild(box);
  }

  function syncInputs(key, next) {
    cropSettings[key] = normalizeCropRegion(next);
    const inputs = document.querySelectorAll(`#crop-region-list input[data-key="${key}"]`);
    inputs.forEach((input) => {
      input.value = cropSettings[key][input.dataset.field];
    });
    saveCropSettingsToStorage();
    updateCropPreview();
  }

  function startCropDrag(e) {
    e.preventDefault();
    const box = e.currentTarget;
    const key = box.dataset.key;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...cropSettings[key] };

    const onMove = (ev) => {
      const dx = ((ev.clientX - startX) / stageW) * 100;
      const dy = ((ev.clientY - startY) / stageH) * 100;
      syncInputs(key, { ...start, x: start.x + dx, y: start.y + dy });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      saveCropSettingsToStorage();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
}

function saveCropSettings() {
  const inputs = document.querySelectorAll('#crop-region-list input[type="number"]');
  inputs.forEach((input) => {
    const key = input.dataset.key;
    const field = input.dataset.field;
    cropSettings[key] = normalizeCropRegion({ ...cropSettings[key], [field]: Number(input.value) });
  });
  saveCropSettingsToStorage();
  updateCropPreview();
  showToast('設定を保存しました', 'success');
  closeSettingsModal();
}

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
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

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

function notifyBestUpdates(targets, previousBestMap) {
  if (!targets || targets.length === 0) return;

  const currentBestMap = buildBestMap(allRecords);
  const improved = [];

  for (const target of targets) {
    const key = buildRecordKey(target.title, target.level, target.diff);
    const oldBest = previousBestMap?.get(key);
    const newBest = currentBestMap.get(key);
    if (typeof newBest !== 'number') continue;
    if (typeof oldBest !== 'number' || newBest < oldBest) {
      improved.push({ ...target, oldBest, newBest });
    }
  }

  if (improved.length === 0) return;

  const summary = improved.slice(0, 3).map((item) => {
    const meta = DIFFICULTY_META[item.diff] || { label: item.diff, color: '#666' };
    return `${item.title} / ${meta.label} : ${typeof item.oldBest === 'number' ? item.oldBest : '未登録'} → ${item.newBest}`;
  }).join('\n');

  showToast(`自己ベスト更新 ${improved.length}件`, 'success');

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('自己ベスト更新', {
        body: summary,
      });
    } catch (error) {
      console.error(error);
    }
  }
}

function updateNotificationStatusText() {
  updateNotificationStatus();
}

function initSettingsUI() {
  const fileInput = document.getElementById('settings-sample-file');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) setSamplePreviewImage(file);
    });
  }
  updateNotificationStatus();
}
