import { DIFFICULTIES, bestTextMatch, clampRegion, drawCropToCanvas, enhanceCanvas, fileToImageBitmap, groupKey, normalizeSearch, parseNumber, stripNumbers, sum, toCanvasRegion } from './utils.js';

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let tesseractLoadPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((s) => s.src === src);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function ensureTesseract() {
  if (window.Tesseract) return window.Tesseract;
  if (!tesseractLoadPromise) tesseractLoadPromise = loadScript(TESSERACT_SRC);
  await tesseractLoadPromise;
  if (!window.Tesseract) throw new Error('Tesseract.js を読み込めませんでした');
  return window.Tesseract;
}

async function recognizeCanvas(canvas, lang = 'jpn+eng') {
  const Tesseract = await ensureTesseract();
  const result = await Tesseract.recognize(canvas, lang, {
    logger: () => {},
  });
  return result?.data?.text?.trim() || '';
}

function cropSourceToCanvas(source, region) {
  const canvas = document.createElement('canvas');
  canvas.width = region.w;
  canvas.height = region.h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
  return canvas;
}

async function ocrRegion(source, imageWidth, imageHeight, region, lang = 'jpn+eng', mode = 'normal') {
  const rect = toCanvasRegion(imageWidth, imageHeight, clampRegion(region));
  const canvas = cropSourceToCanvas(source, rect);
  if (mode !== 'raw') enhanceCanvas(canvas);
  return recognizeCanvas(canvas, lang);
}

function parseCounts(text) {
  const clean = text.replace(/\s+/g, ' ').replace(/[ＯO]/g, '0').replace(/[ｌI|]/g, '1');
  const labels = {
    perfect: /PERFECT[^0-9]{0,8}(\d{1,5})/i,
    great: /GREAT[^0-9]{0,8}(\d{1,5})/i,
    good: /GOOD[^0-9]{0,8}(\d{1,5})/i,
    bad: /BAD[^0-9]{0,8}(\d{1,5})/i,
    miss: /MISS[^0-9]{0,8}(\d{1,5})/i,
    combo: /COMBO[^0-9]{0,8}(\d{1,5})/i,
  };
  const out = {};
  for (const [key, regex] of Object.entries(labels)) {
    const m = clean.match(regex);
    if (m) out[key] = Number(m[1]);
  }
  const nums = [...clean.matchAll(/\d{1,5}/g)].map((m) => Number(m[0]));
  if (out.combo === undefined && nums.length) out.combo = nums.at(-1);
  return out;
}

function parseTitle(text) {
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/[\|｜]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim();
  return cleaned || '';
}

function parseLevelDifficulty(text, knownSongs, knownDifficulties = DIFFICULTIES) {
  const clean = text.replace(/\s+/g, ' ').trim();
  let difficulty = null;
  for (const diff of knownDifficulties.map((d) => d.key)) {
    if (new RegExp(diff, 'i').test(clean)) {
      difficulty = diff;
      break;
    }
  }
  const levelMatch = clean.match(/(?:Lv\.?|LEVEL|レベル|楽曲Lv\.?)\s*([0-9]{1,2})/i) || clean.match(/\b([0-9]{1,2})\b/);
  const playLevel = levelMatch ? Number(levelMatch[1]) : null;

  let candidate = null;
  if (difficulty && playLevel !== null) {
    candidate = { difficulty, playLevel };
  }
  return { difficulty, playLevel, candidateText: clean };
}

export async function analyzeResultImage(file, profile, masterData) {
  const bitmap = await fileToImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const regions = profile.regions;

  const reads = {};
  const titleText = await ocrRegion(bitmap, width, height, regions.title, 'jpn+eng', 'normal');
  const titleTextRaw = parseTitle(titleText);
  reads.titleText = titleTextRaw;

  const ldText = await ocrRegion(bitmap, width, height, regions.levelDifficulty, 'jpn+eng', 'normal');
  const ldParsed = parseLevelDifficulty(ldText, masterData.songs);
  reads.levelDifficultyText = ldParsed.candidateText;
  reads.playLevel = ldParsed.playLevel;
  reads.difficulty = ldParsed.difficulty;

  const resultText = await ocrRegion(bitmap, width, height, regions.result, 'eng+jpn', 'normal');
  const counts = parseCounts(resultText);
  reads.countText = resultText;

  const comboText = await ocrRegion(bitmap, width, height, regions.combo, 'eng+jpn', 'normal');
  const comboMatch = comboText.replace(/\s+/g, ' ').match(/COMBO[^0-9]{0,8}(\d{1,5})/i) || comboText.match(/\d{1,5}/g)?.at(-1);
  reads.comboText = comboText;
  if (comboMatch) reads.combo = Number(Array.isArray(comboMatch) ? comboMatch[1] : comboMatch);

  const songMatch = masterData.findSongByTitle(titleTextRaw) || bestTextMatch(titleTextRaw, masterData.titles, (item) => `${item.title} ${item.pronunciation}`)?.item || null;
  reads.songMatch = songMatch;

  let song = songMatch ? masterData.findSongById(songMatch.id) : null;
  if (!song && songMatch?.id) song = masterData.findSongById(songMatch.id);
  let difficultyRecord = null;
  if (song && reads.difficulty) difficultyRecord = masterData.findBestDifficulty(song.id, reads.difficulty);

  if (!song && reads.titleText) {
    // Re-run with broader OCR if no song was matched.
    const retryTitle = await ocrRegion(bitmap, width, height, regions.title, 'jpn+eng', 'raw');
    const retrySongMatch = masterData.findSongByTitle(retryTitle) || bestTextMatch(retryTitle, masterData.titles, (item) => `${item.title} ${item.pronunciation}`)?.item || null;
    reads.retryTitleText = retryTitle;
    if (retrySongMatch) {
      reads.titleText = retryTitle;
      reads.songMatch = retrySongMatch;
      song = masterData.findSongById(retrySongMatch.id);
      if (song && reads.difficulty) difficultyRecord = masterData.findBestDifficulty(song.id, reads.difficulty);
    }
  }

  const perfect = parseNumber(counts.perfect, 0);
  const great = parseNumber(counts.great, 0);
  const good = parseNumber(counts.good, 0);
  const bad = parseNumber(counts.bad, 0);
  const miss = parseNumber(counts.miss, 0);
  const combo = parseNumber(reads.combo, 0);
  const totalRead = sum([perfect, great, good, bad, miss]);
  const missAP = sum([great, good, bad, miss]);
  const missContest = great * 1 + good * 2 + bad * 3 + miss * 3;
  const missFC = sum([good, bad, miss]);
  const apAchieved = totalRead > 0 && great + good + bad + miss === 0;
  const fcAchieved = totalRead > 0 && good + bad + miss === 0;

  const validDifficulty = reads.difficulty && DIFFICULTIES.some((d) => d.key === reads.difficulty);
  const extracted = {
    file,
    width,
    height,
    title: song?.title || reads.titleText || '未取得',
    pronunciation: song?.pronunciation || '',
    musicId: song?.id || '',
    playLevel: difficultyRecord?.playLevel ?? reads.playLevel ?? null,
    difficulty: validDifficulty ? reads.difficulty : (difficultyRecord?.musicDifficulty || 'EXPERT'),
    totalNoteCount: difficultyRecord?.totalNoteCount ?? null,
    perfect,
    great,
    good,
    bad,
    miss,
    combo,
    missAP,
    missContest,
    missFC,
    apAchieved,
    fcAchieved,
    needsManualCheck: !song || !validDifficulty || !difficultyRecord,
    ocr: reads,
    cropProfile: profile.id,
  };

  if (difficultyRecord && extracted.totalNoteCount !== null) {
    const total = totalRead;
    if (Math.abs(total - extracted.totalNoteCount) > 2) {
      const retryResult = await ocrRegion(bitmap, width, height, regions.result, 'eng+jpn', 'raw');
      const retryCounts = parseCounts(retryResult);
      const retryPerfect = parseNumber(retryCounts.perfect, perfect);
      const retryGreat = parseNumber(retryCounts.great, great);
      const retryGood = parseNumber(retryCounts.good, good);
      const retryBad = parseNumber(retryCounts.bad, bad);
      const retryMiss = parseNumber(retryCounts.miss, miss);
      const retryTotal = sum([retryPerfect, retryGreat, retryGood, retryBad, retryMiss]);
      if (retryTotal === extracted.totalNoteCount) {
        extracted.perfect = retryPerfect;
        extracted.great = retryGreat;
        extracted.good = retryGood;
        extracted.bad = retryBad;
        extracted.miss = retryMiss;
        extracted.missAP = sum([retryGreat, retryGood, retryBad, retryMiss]);
        extracted.missContest = retryGreat * 1 + retryGood * 2 + retryBad * 3 + retryMiss * 3;
        extracted.missFC = sum([retryGood, retryBad, retryMiss]);
      } else {
        extracted.needsManualCheck = true;
      }
    }
  }

  return extracted;
}
