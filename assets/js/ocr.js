function normalizeString(str) {
  if (!str) return '';
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .replace(/[\s\-_]/g, '');
}

function levenshtein(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 0; j < b.length; j++) {
    const cur = [j + 1];
    for (let i = 0; i < a.length; i++) {
      cur[i + 1] = a[i] === b[j]
        ? prev[i]
        : 1 + Math.min(prev[i], prev[i + 1], cur[i]);
    }
    prev = cur;
  }
  return prev[prev.length - 1];
}

function findBestMatchMusic(ocrText) {
  if (!dbMusics || dbMusics.length === 0) return null;
  const target = normalizeString(ocrText);
  if (!target) return null;

  let bestMatch = null;
  let minScore = Infinity;

  for (const music of dbMusics) {
    const dbTitleNorm = normalizeString(music.title);
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
  if (!musicId || !diffKey || !dbDiffs) return null;
  const normalized = String(diffKey).toLowerCase();
  const entry = dbDiffs.find((item) => item.musicId === musicId && String(item.musicDifficulty).toLowerCase() === normalized);
  return entry ? entry.playLevel : null;
}

function detectDifficulty(diffText) {
  const text = normalizeString(diffText).toUpperCase();

  if (/APP?E?N?D/.test(text) || text.includes('APPEND')) return 'APPEND';
  if (text.includes('MASTER')) return 'MASTER';
  if (text.includes('EXPERT')) return 'EXPERT';
  if (text.includes('HARD')) return 'HARD';
  if (text.includes('NORMAL') || text.includes('NORM')) return 'NORMAL';
  if (text.includes('EASY') || text.includes('EAS')) return 'EASY';

  return 'EXPERT';
}

async function cropImage(imageElement, region, type = 'standard') {
  const canvas = document.createElement('canvas');
  const w = imageElement.naturalWidth;
  const h = imageElement.naturalHeight;
  const ctx = canvas.getContext('2d');

  const xRatio = region.x / 100;
  const yRatio = region.y / 100;
  const wRatio = region.w / 100;
  const hRatio = region.h / 100;

  if (type === 'threshold-diff') {
    const scale = 1.5;
    canvas.width = Math.max(1, Math.round(w * wRatio * scale));
    canvas.height = Math.max(1, Math.round(h * hRatio * scale));
    ctx.drawImage(imageElement, w * xRatio, h * yRatio, w * wRatio, h * hRatio, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray > 180 ? 0 : 255;
    }
    ctx.putImageData(imageData, 0, 0);
  } else {
    canvas.width = Math.max(1, Math.round(w * wRatio));
    canvas.height = Math.max(1, Math.round(h * hRatio));
    ctx.filter = 'grayscale(100%) contrast(150%)';
    ctx.drawImage(imageElement, w * xRatio, h * yRatio, w * wRatio, h * hRatio, 0, 0, canvas.width, canvas.height);
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function analyzeLoadedImage(imgElement, worker) {
  try {
    const diffBlob = await cropImage(imgElement, cropSettings.diff, cropSettings.diff.mode);
    const diffRet = await worker.recognize(diffBlob, { lang: 'eng' });
    const diffText = diffRet.data.text || '';
    const diffKey = detectDifficulty(diffText);

    const titleBlob = await cropImage(imgElement, cropSettings.title, cropSettings.title.mode);
    const titleRet = await worker.recognize(titleBlob, { lang: 'jpn' });
    const matchedMusic = findBestMatchMusic(titleRet.data.text || '');
    const finalTitle = matchedMusic ? matchedMusic.title : String(titleRet.data.text || '').replace(/\r?\n/g, '').trim();
    const musicId = matchedMusic ? matchedMusic.id : null;

    let level = '';
    if (musicId) {
      level = getLevelFromDb(musicId, diffKey.toLowerCase()) || '';
    }

    const missBlob = await cropImage(imgElement, cropSettings.miss, cropSettings.miss.mode);
    const missRet = await worker.recognize(missBlob, { lang: 'jpn' });
    const lines = String(missRet.data.text || '').split('\n');
    let cGood = 0;
    let cBad = 0;
    let cMiss = 0;

    const parseLine = (line, regex) => {
      if (regex.test(line)) {
        const nums = line.match(/\d+/g);
        if (nums && nums.length > 0) return parseInt(nums[nums.length - 1], 10);
      }
      return 0;
    };

    lines.forEach((line) => {
      if (/G[O0QD]{2}D/i.test(line)) cGood = parseLine(line, /G[O0QD]{2}D/i);
      if (/BAD/i.test(line)) cBad = parseLine(line, /BAD/i);
      if (/MISS/i.test(line)) cMiss = parseLine(line, /MISS/i);
    });

    const miss = cGood + cBad + cMiss;

    return {
      title: finalTitle,
      level: level,
      diff: diffKey,
      miss,
      missDetail: { good: cGood, bad: cBad, miss: cMiss },
      musicId,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}
