
window.PrskApp = window.PrskApp || {};

(function (App) {
  const state = App.state;

  async function loadMasterDatabase() {
    try {
      const [musicsResp, diffsResp] = await Promise.all([
        fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
        fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json'),
      ]);
      state.dbMusics = await musicsResp.json();
      state.dbDiffs = await diffsResp.json();
    } catch (e) {
      console.error('DB Error', e);
      state.dbMusics = [];
      state.dbDiffs = [];
    }
  }

  function syncDifficultySelectors() {
    const diffSelect = App.q('filter-diff');
    const editorSelect = App.q('up-diff');
    if (diffSelect && diffSelect.options.length === 0) {
      diffSelect.innerHTML = `
        <option value="all">すべて</option>
        <option value="EASY">EASY</option>
        <option value="NORMAL">NORMAL</option>
        <option value="HARD">HARD</option>
        <option value="EXPERT">EXPERT</option>
        <option value="MASTER">MASTER</option>
        <option value="APPEND">APPEND</option>
      `;
    }
    if (editorSelect && editorSelect.options.length === 0) {
      editorSelect.innerHTML = `
        <option value="EASY">EASY</option>
        <option value="NORMAL">NORMAL</option>
        <option value="HARD">HARD</option>
        <option value="EXPERT">EXPERT</option>
        <option value="MASTER">MASTER</option>
        <option value="APPEND">APPEND</option>
      `;
    }
  }

  function syncSettingsControls() {
    App.loadSettings();
    App.loadUiState();
    if (App.q('sort-mode')) App.q('sort-mode').value = state.settings.sortMode;
    if (App.q('show-best-only')) App.q('show-best-only').checked = state.settings.showBestOnly;
    App.updateSortDirectionButton();
    App.updateBestOnlyCheckbox();
  }

  function initStaticUi() {
    syncDifficultySelectors();
    syncSettingsControls();
    App.bindUiEvents();
    App.initSettingsUi();
    App.setAuthUI(false);
    App.updateSelectionUI();
    App.updateSortModeSelect();
    App.updateSortDirectionButton();
    App.updateBestOnlyCheckbox();
  }

  async function bootstrap() {
    initStaticUi();
    await loadMasterDatabase();
  }

  window.addEventListener('DOMContentLoaded', bootstrap);
})(window.PrskApp);
