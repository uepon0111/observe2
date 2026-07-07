
const { clamp, clamp01, showToast, normalizeString } = window.PRSK_UTILS;

function getCropConfig(key) {
  return PRSK.state.settings.crop[key] || PRSK.DEFAULT_SETTINGS.crop[key];
}

function cropImage(imageElement, cfg) {
  const canvas = document.createElement('canvas');
  const w = imageElement.naturalWidth;
  const h = imageElement.naturalHeight;
  const ctx = canvas.getContext('2d');
  const x = clamp01(cfg.x);
  const y = clamp01(cfg.y);
  const cw = clamp01(cfg.w);
  const ch = clamp01(cfg.h);
  const mode = cfg.mode || 'filter-standard';

  if (mode === 'threshold-diff') {
    const scale = 1.5;
    canvas.width = Math.max(1, Math.round(w * cw * scale));
    canvas.height = Math.max(1, Math.round(h * ch * scale));
    ctx.drawImage(imageElement, w * x, h * y, w * cw, h * ch, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = (gray > 180) ? 0 : 255;
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    canvas.width = Math.max(1, Math.round(w * cw));
    canvas.height = Math.max(1, Math.round(h * ch));
    ctx.filter = 'grayscale(100%) contrast(150%)';
    ctx.drawImage(imageElement, w * x, h * y, w * cw, h * ch, 0, 0, canvas.width, canvas.height);
  }
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function detectDifficulty(text) {
  const t = String(text || '').toUpperCase();
  if (/APPEND|APEND|APPND/.test(t)) return 'append';
  if (/MASTER/.test(t)) return 'master';
  if (/EXPERT/.test(t)) return 'expert';
  if (/HARD/.test(t)) return 'hard';
  if (/NORMAL|STD|STANDARD/.test(t)) return 'normal';
  if (/EASY|BEGINNER|NOVICE/.test(t)) return 'easy';
  return 'expert';
}

async function analyzeLoadedImage(imgElement, worker) {
  try {
    const diffBlob = await cropImage(imgElement, getCropConfig('diff'));
    const diffRet = await worker.recognize(diffBlob, { lang: 'eng' });
    const diff = detectDifficulty(diffRet.data.text);

    const titleBlob = await cropImage(imgElement, getCropConfig('title'));
    const titleRet = await worker.recognize(titleBlob, { lang: 'jpn' });
    const matchedMusic = findBestMatchMusic(titleRet.data.text);
    const finalTitle = matchedMusic ? matchedMusic.title : String(titleRet.data.text || '').replace(/\r?\n/g, '').trim();
    const musicId = matchedMusic ? matchedMusic.id : null;

    let level = '';
    if (musicId) level = getLevelFromDb(musicId, diff) || '';

    const missBlob = await cropImage(imgElement, getCropConfig('miss'));
    const missRet = await worker.recognize(missBlob, { lang: 'jpn' });
    const lines = String(missRet.data.text || '').split('\n');
    let cGood = 0, cBad = 0, cMiss = 0;
    const parseLine = (line, regex) => {
      if (regex.test(line)) {
        const nums = line.match(/\d+/g);
        if (nums) return parseInt(nums[nums.length - 1], 10);
      }
      return 0;
    };
    lines.forEach(line => {
      if (/G[O0QD]{2}D/i.test(line)) cGood = parseLine(line, /G[O0QD]{2}D/i);
      if (/BAD/i.test(line)) cBad = parseLine(line, /BAD/i);
      if (/MISS/i.test(line)) cMiss = parseLine(line, /MISS/i);
    });

    return {
      title: finalTitle,
      level,
      diff,
      miss: cGood + cBad + cMiss,
      missDetail: { good: cGood, bad: cBad, miss: cMiss },
      musicId
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

function normalizeStringForMatch(str) {
  return normalizeString(str);
}

function findBestMatchMusic(ocrText) {
  if (!PRSK.state.dbMusics || PRSK.state.dbMusics.length === 0) return null;
  const target = normalizeStringForMatch(ocrText);
  if (target.length === 0) return null;
  let bestMatch = null, minScore = Infinity;
  const levenshtein = (s1, s2) => {
    if (s1.length > s2.length) [s1, s2] = [s2, s1];
    let dist = Array.from({ length: s1.length + 1 }, (_, i) => i);
    for (let i2 = 0; i2 < s2.length; i2++) {
      let newDist = [i2 + 1];
      for (let i1 = 0; i1 < s1.length; i1++) {
        if (s1[i1] === s2[i2]) newDist.push(dist[i1]);
        else newDist.push(1 + Math.min(dist[i1], dist[i1 + 1], newDist[newDist.length - 1]));
      }
      dist = newDist;
    }
    return dist[dist.length - 1];
  };

  for (const music of PRSK.state.dbMusics) {
    const dbTitleNorm = normalizeStringForMatch(music.title);
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
  if (!musicId || !diffKey || !PRSK.state.dbDiffs) return null;
  const entry = PRSK.state.dbDiffs.find(d => String(d.musicId) === String(musicId) && String(d.musicDifficulty).toLowerCase() === String(diffKey).toLowerCase());
  return entry ? entry.playLevel : null;
}

window.cropImage = cropImage;
window.analyzeLoadedImage = analyzeLoadedImage;
window.findBestMatchMusic = findBestMatchMusic;
window.getLevelFromDb = getLevelFromDb;
window.detectDifficulty = detectDifficulty;
