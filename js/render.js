
window.PrskApp = window.PrskApp || {};

(function (App) {
  const state = App.state;

  function normalizeTitle(str) {
    return App.normalizeText(str || '');
  }

  function findBestMatchMusic(ocrText) {
    if (!state.dbMusics || state.dbMusics.length === 0) return null;
    const target = normalizeTitle(ocrText);
    if (target.length === 0) return null;

    let bestMatch = null;
    let minScore = Infinity;

    const levenshtein = (s1, s2) => {
      if (s1.length > s2.length) [s1, s2] = [s2, s1];
      let dist = Array.from({ length: s1.length + 1 }, (_, i) => i);
      for (let i2 = 0; i2 < s2.length; i2++) {
        const newDist = [i2 + 1];
        for (let i1 = 0; i1 < s1.length; i1++) {
          if (s1[i1] === s2[i2]) newDist.push(dist[i1]);
          else newDist.push(1 + Math.min(dist[i1], dist[i1 + 1], newDist[newDist.length - 1]));
        }
        dist = newDist;
      }
      return dist[dist.length - 1];
    };

    for (const music of state.dbMusics) {
      const dbTitleNorm = normalizeTitle(music.title);
      const dist = levenshtein(target, dbTitleNorm);
      const score = dist / Math.max(target.length, dbTitleNorm.length);
      if (score < minScore) {
        minScore = score;
        bestMatch = music;
      }
    }
    return bestMatch;
  }

  function getLevelFromDb(musicId, diffKey) {
    if (!musicId || !diffKey || !state.dbDiffs) return null;
    const key = diffKey.toString().toLowerCase();
    const entry = state.dbDiffs.find((d) => String(d.musicId) === String(musicId) && String(d.musicDifficulty).toLowerCase() === key);
    return entry ? entry.playLevel : null;
  }

  function escapeHtml(t) {
    return t ? t.toString().replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])) : '';
  }

  function getSortDirectionFactor() {
    return state.settings.sortDirection === 'desc' ? -1 : 1;
  }

  function comparePrimary(a, b, field) {
    switch (field) {
      case 'title':
        return App.compareStringsJa(a.title, b.title);
      case 'level':
        return Number(a.level || 0) - Number(b.level || 0);
      case 'miss':
        return Number(a.missCount || 0) - Number(b.missCount || 0);
      case 'created':
        return new Date(a.addedAt || 0).getTime() - new Date(b.addedAt || 0).getTime();
      default:
        return 0;
    }
  }

  function compareSecondary(a, b, field) {
    const diff = App.diffSortRank(a.difficultyCode) - App.diffSortRank(b.difficultyCode);
    const title = App.compareStringsJa(a.title, b.title);
    const level = Number(a.level || 0) - Number(b.level || 0);
    const miss = Number(a.missCount || 0) - Number(b.missCount || 0);
    const created = new Date(a.addedAt || 0).getTime() - new Date(b.addedAt || 0).getTime();

    if (field === 'title') return diff || miss || created;
    if (field === 'level') return diff || title || miss || created;
    if (field === 'miss') return level || diff || title || created;
    return 0;
  }

  function getBestOnlyRecords(records) {
    const map = new Map();
    for (const rec of records) {
      const key = App.getRecordGroupKey(rec);
      const miss = Number(rec.missCount || 0);
      const created = new Date(rec.addedAt || 0).getTime();
      const current = map.get(key);
      if (!current || miss < current.miss || (miss === current.miss && created > current.created)) {
        map.set(key, { miss, created, rec });
      }
    }
    return Array.from(map.values()).map((v) => v.rec);
  }

  function updateSortDirectionButton() {
    const btn = App.q('sort-direction');
    if (!btn) return;
    btn.innerText = state.settings.sortDirection === 'desc' ? '降順' : '昇順';
    btn.classList.toggle('desc', state.settings.sortDirection === 'desc');
  }

  function updateBestOnlyCheckbox() {
    const el = App.q('show-best-only');
    if (el) el.checked = !!state.settings.showBestOnly;
  }

  function updateSortModeSelect() {
    const el = App.q('sort-mode');
    if (el) el.value = state.settings.sortMode;
  }

  function updateView() {
    if (!state.allRecords) return;

    const fcF = App.q('filter-fc')?.value || 'all';
    const msMin = App.q('filter-miss-min')?.value || '';
    const msMax = App.q('filter-miss-max')?.value || '';
    const dfF = App.q('filter-diff')?.value || 'all';
    const lvF = App.q('filter-level')?.value || '';
    const tiF = (App.q('filter-title')?.value || '').trim().toLowerCase();

    let list = state.allRecords.slice();

    list = list.filter((r) => {
      if (fcF === 'fc' && !r.isFC) return false;
      if (fcF === 'unfc' && r.isFC) return false;
      if (!r.isFC) {
        const mVal = Number(r.missCount || 0);
        if (msMin !== '' && mVal < parseInt(msMin, 10)) return false;
        if (msMax !== '' && mVal > parseInt(msMax, 10)) return false;
      } else {
        if (msMin !== '' && 0 < parseInt(msMin, 10)) return false;
      }
      if (dfF !== 'all' && r.difficultyCode !== dfF) return false;
      if (lvF && String(r.level) !== String(lvF)) return false;
      if (tiF && !String(r.title || '').toLowerCase().includes(tiF)) return false;
      return true;
    });

    if (state.settings.showBestOnly) {
      list = getBestOnlyRecords(list);
    }

    const sortMode = state.settings.sortMode || 'level';
    const dir = getSortDirectionFactor();

    list.sort((a, b) => {
      const primary = comparePrimary(a, b, sortMode) * dir;
      if (primary !== 0) return primary;
      const secondary = compareSecondary(a, b, sortMode);
      if (secondary !== 0) return secondary;
      // stable final tie-breaker
      const title = App.compareStringsJa(a.title, b.title);
      if (title !== 0) return title;
      return new Date(a.addedAt || 0).getTime() - new Date(b.addedAt || 0).getTime();
    });

    state.filteredRecords = list;
    renderGrid(list);
  }

  function renderGrid(records) {
    const grid = App.q('grid');
    const total = state.allRecords.length;
    const visible = records.length;
    const bestTag = state.settings.showBestOnly ? ' / 自己ベストのみ' : '';
    App.setText('result-count', `表示: ${visible} 件 / 全件 ${total} 件${bestTag}`);
    if (!grid) return;
    grid.innerHTML = '';
    if (records.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:#666;">データなし</div>';
      return;
    }

    const cards = records.map((rec) => {
      const thumb = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w600') : '';
      const large = rec.thumbnail ? rec.thumbnail.replace('=s220', '=w1600') : '';
      const missDisplay = rec.isFC ? '<span class="miss-val zero">FC-0</span>' : `FC -<span class="miss-val">${rec.missCount}</span>`;
      const badge = rec.isFC ? '<div class="fc-badge"><span class="material-symbols-outlined" style="font-size:1rem;">crown</span> FULL COMBO</div>' : '';
      const isSel = state.selectedIds.has(rec.id) ? 'selected' : '';

      let clickAction = '';
      let overlayActions = '';
      if (state.isSelectMode) {
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

      const diffColor = App.difficultyColor(rec.difficultyCode);
      return `
        <div class="card ${rec.isFC ? 'is-fc' : ''} ${isSel} ${state.isSelectMode ? 'select-mode-active' : ''}" id="card-${rec.id}" onclick="${clickAction}">
          <div class="card-img-container">
            ${badge}
            ${overlayActions}
            <div class="img-loader-spinner"></div>
            ${thumb ? `<img src="${thumb}" class="card-img" loading="lazy" onload="this.style.opacity=1; this.previousElementSibling.style.display='none';">` : '<span style="color:#aaa;">NO IMAGE</span>'}
          </div>
          <div class="card-body">
            <div class="song-meta">
              <span class="tag lvl">Lv.${escapeHtml(rec.level)}</span>
              <span class="tag diff-${rec.difficultyCode}" style="background:${diffColor}22; border-color:${diffColor}; color:${diffColor};">${escapeHtml(rec.difficultyCode)}</span>
            </div>
            <div class="song-title">${escapeHtml(rec.title)}</div>
            <div class="score-info">
              <span style="display:flex;align-items:center;gap:2px;"><span class="material-symbols-outlined" style="font-size:1rem;">bar_chart</span> Result</span>
              ${missDisplay}
            </div>
          </div>
        </div>`;
    });

    grid.innerHTML = cards.join('');
  }

  function openImageModal(src) {
    if (!src) return;
    App.q('imageModal').style.display = 'flex';
    App.q('modalImg').src = src;
  }

  function closeImageModal() {
    App.q('imageModal').style.display = 'none';
  }

  function onDataLoaded() {
    App.hide('loader');
    updateSortModeSelect();
    updateSortDirectionButton();
    updateBestOnlyCheckbox();
    updateView();
  }

  App.normalizeTitle = normalizeTitle;
  App.findBestMatchMusic = findBestMatchMusic;
  App.getLevelFromDb = getLevelFromDb;
  App.escapeHtml = escapeHtml;
  App.updateView = updateView;
  App.renderGrid = renderGrid;
  App.openImageModal = openImageModal;
  App.closeImageModal = closeImageModal;
  App.onDataLoaded = onDataLoaded;
  App.updateSortDirectionButton = updateSortDirectionButton;
  App.updateBestOnlyCheckbox = updateBestOnlyCheckbox;
  App.updateSortModeSelect = updateSortModeSelect;
  App.getBestOnlyRecords = getBestOnlyRecords;

  Object.assign(window, {
    findBestMatchMusic,
    getLevelFromDb,
    escapeHtml,
    updateView,
    renderGrid,
    openImageModal,
    closeImageModal,
    onDataLoaded,
  });
})(window.PrskApp);
