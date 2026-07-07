
async function loadMusicDatabase() {
  try {
    const [musicsResp, diffsResp] = await Promise.all([
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
      fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json')
    ]);
    PRSK.state.dbMusics = await musicsResp.json();
    PRSK.state.dbDiffs = await diffsResp.json();
  } catch (e) {
    console.error('DB Error', e);
    PRSK.state.dbMusics = [];
    PRSK.state.dbDiffs = [];
  }
}

function bindSettingsUI() {
  document.getElementById('settings-sample-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleSettingsSampleFile(file);
  });
  document.querySelectorAll('.crop-selector button').forEach(btn => {
    btn.addEventListener('click', () => setActiveRegion(btn.dataset.region));
  });
  SETTINGS_KEYS.forEach(key => {
    ['x','y','w','h','mode'].forEach(part => {
      document.getElementById(`crop-${part}-${key}`).addEventListener('input', () => updateRegionFromInputs(key));
      document.getElementById(`crop-${part}-${key}`).addEventListener('change', () => updateRegionFromInputs(key));
    });
  });
  document.getElementById('settings-save-btn').addEventListener('click', saveSettingsFromUI);
  document.getElementById('settings-reset-btn').addEventListener('click', resetSettingsToDefault);
}

function bindBatchUI() {
  const fileInput = document.getElementById('up-file');
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
}

function bindCommonUI() {
  document.getElementById('imageModal').addEventListener('click', (event) => {
    if (event.target === document.getElementById('imageModal')) closeImageModal();
  });
  document.getElementById('batchModal').addEventListener('click', (event) => {
    if (event.target === document.getElementById('batchModal')) closeBatchModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeImageModal();
      closeSettingsModal();
    }
  });
  document.getElementById('btn-exec-batch').addEventListener('click', handleBatchExecution);
}

async function initApp() {
  bindSettingsUI();
  bindBatchUI();
  bindCommonUI();
  setAuthUI(false);
  PRSK.state.settings = window.PRSK_UTILS.loadSettings();
  syncSettingsUI();
  await loadMusicDatabase();
  maybeEnableAuth();
  updateSelectionUI();
  document.getElementById('loader').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', initApp);
