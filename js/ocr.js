
window.PrskApp = window.PrskApp || {};

(function (App) {
  const state = App.state;

  function normalizeString(str) {
    return App.normalizeText(str || '').replace(/[_\-]/g, '');
  }

  function detectDifficultyFromText(text) {
    const normalized = normalizeString(text);
    const patterns = [
      { label: 'APPEND', code: 'A', key: 'append', regex: /APPEND/ },
      { label: 'MASTER', code: 'M', key: 'master', regex: /MASTER/ },
      { label: 'EXPERT', code: 'X', key: 'expert', regex: /EXPERT/ },
      { label: 'HARD', code: 'H', key: 'hard', regex: /HARD/ },
      { label: 'NORMAL', code: 'N', key: 'normal', regex: /NORMAL/ },
      { label: 'EASY', code: 'E', key: 'easy', regex: /EASY/ },
    ];
    for (const item of patterns) {
      if (item.regex.test(normalized)) return item;
    }
    if (/AP{1,2}E?N?D?/.test(normalized)) return patterns[0];
    return patterns[2]; // EXPERT fallback
  }

  function getCropRegion(regionKey) {
    return state.settings.cropRegions[regionKey] || App.CONFIG.DEFAULT_CROP_REGIONS[regionKey];
  }

  async function cropImage(imageElement, regionKey) {
    const region = getCropRegion(regionKey);
    const canvas = document.createElement('canvas');
    const w = imageElement.naturalWidth;
    const h = imageElement.naturalHeight;
    const ctx = canvas.getContext('2d');
    const x = w * region.x;
    const y = h * region.y;
    const cw = w * region.w;
    const ch = h * region.h;

    if (region.type === 'threshold-diff') {
      const scale = 1.5;
      canvas.width = Math.max(1, Math.round(cw * scale));
      canvas.height = Math.max(1, Math.round(ch * scale));
      ctx.drawImage(imageElement, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const value = gray > 180 ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = value;
      }
      ctx.putImageData(imageData, 0, 0);
    } else {
      canvas.width = Math.max(1, Math.round(cw));
      canvas.height = Math.max(1, Math.round(ch));
      ctx.filter = 'grayscale(100%) contrast(150%)';
      ctx.drawImage(imageElement, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
    }

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  async function analyzeLoadedImage(imgElement, worker) {
    try {
      const diffBlob = await cropImage(imgElement, 'diff');
      const diffRet = await worker.recognize(diffBlob, { lang: 'eng' });
      const diffInfo = detectDifficultyFromText(diffRet.data.text);
      const diffLabel = diffInfo.label;
      const diffKey = diffInfo.key;

      const titleBlob = await cropImage(imgElement, 'title');
      const titleRet = await worker.recognize(titleBlob, { lang: 'jpn' });
      const matchedMusic = App.findBestMatchMusic(titleRet.data.text);
      const finalTitle = matchedMusic ? matchedMusic.title : titleRet.data.text.replace(/\r?\n/g, '').trim();
      const musicId = matchedMusic ? matchedMusic.id : null;

      let level = '';
      if (musicId) level = App.getLevelFromDb(musicId, diffKey) || '';

      const missBlob = await cropImage(imgElement, 'miss');
      const missRet = await worker.recognize(missBlob, { lang: 'jpn' });
      const lines = missRet.data.text.split('\n');
      let cGood = 0, cBad = 0, cMiss = 0;
      const parseLine = (line, regex) => {
        if (regex.test(line)) {
          const nums = line.match(/\d+/g);
          if (nums) return parseInt(nums[nums.length - 1], 10);
        }
        return 0;
      };
      lines.forEach((line) => {
        if (/G[O0QD]{2}D/i.test(line)) cGood = parseLine(line, /G[O0QD]{2}D/i);
        if (/BAD/i.test(line)) cBad = parseLine(line, /BAD/i);
        if (/MISS/i.test(line)) cMiss = parseLine(line, /MISS/i);
      });

      return {
        title: finalTitle,
        level: level === '' ? '' : Number(level),
        diff: diffLabel,
        diffKey,
        miss: cGood + cBad + cMiss,
        missDetail: { good: cGood, bad: cBad, miss: cMiss },
        musicId,
      };
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async function runBatchAnalysis(itemsToAnalyze) {
    if (!itemsToAnalyze || itemsToAnalyze.length === 0) return;
    const statusMsg = App.q('batch-status-msg');
    if (statusMsg) statusMsg.innerText = '解析中... (しばらくお待ちください)';

    const worker = await Tesseract.createWorker(['jpn', 'eng']);
    for (const item of itemsToAnalyze) {
      const el = App.q(`sb-status-${item.id}`);
      if (el) { el.innerText = '解析中'; el.className = 'upload-status processing'; }

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
            diff: App.difficultyLabel(res.diff),
            diffCode: App.difficultyLabel(res.diff),
            diffKey: res.diffKey,
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
      } catch (e) {
        console.error('Analysis Failed for ' + item.id, e);
        item.status = 'error';
      }

      App.updateSidebarStatus(item.id);
      if (item.status === 'done') {
        const titleEl = App.q(`sb-title-${item.id}`);
        if (titleEl) titleEl.innerText = item.data.title;
        if (state.activeItemId === item.id) App.selectItem(item.id);
      } else {
        const statEl = App.q(`sb-status-${item.id}`);
        if (statEl) { statEl.innerText = 'ERR'; statEl.className = 'upload-status error'; }
      }
    }
    await worker.terminate();
    if (statusMsg) statusMsg.innerText = '処理完了';
  }

  async function reanalyzeCurrentItem() {
    if (!state.activeItemId) return;
    const item = state.editorQueue.find((q) => q.id === state.activeItemId);
    if (item) await runBatchAnalysis([item]);
  }

  async function analyzeAllInBatch() {
    if (state.editorQueue.length === 0) return;
    await runBatchAnalysis(state.editorQueue);
  }

  App.normalizeString = normalizeString;
  App.detectDifficultyFromText = detectDifficultyFromText;
  App.getCropRegion = getCropRegion;
  App.cropImage = cropImage;
  App.analyzeLoadedImage = analyzeLoadedImage;
  App.runBatchAnalysis = runBatchAnalysis;
  App.reanalyzeCurrentItem = reanalyzeCurrentItem;
  App.analyzeAllInBatch = analyzeAllInBatch;

  Object.assign(window, {
    normalizeString,
    cropImage,
    analyzeLoadedImage,
    runBatchAnalysis,
    reanalyzeCurrentItem,
    analyzeAllInBatch,
  });
})(window.PrskApp);
