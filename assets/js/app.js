function initApp() {
  cropSettings = loadCropSettings();
  initSettingsUI();

  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    });
  }

  const upFile = document.getElementById('up-file');
  if (upFile) {
    upFile.addEventListener('change', (e) => handleFiles(e.target.files));
  }

  setAuthUI(false);
  updateSelectionUI();
  renderCropEditor();
  maybeEnableAuth();

  loadMasterDb().then(() => {
    // preload complete
  });
}

document.addEventListener('DOMContentLoaded', initApp);
