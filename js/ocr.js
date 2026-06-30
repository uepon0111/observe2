import { clamp, deepClone, normalizeText, numberOrNull, regionToPixels, uid } from './utils.js';
import { getDifficultyLabel, getDifficultyRow, getMusicById, resolveMusicInfo } from './db.js';

let workerPromise = null;

async function getWorker() {
  if (workerPromise) return workerPromise;
  if (!window.Tesseract) throw new Error('Tesseract.js が読み込まれていません');
  workerPromise = (async () => {
    const worker = await window.Tesseract.createWorker('jpn+eng');
    return worker;
  })();
  return workerPromise;
}

export async function terminateWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}

function loadImage(blobOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const objectUrl = typeof blobOrUrl === 'string' ? '' : URL.createObjectURL(blobOrUrl);
    img.onload = () => {
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      resolve(img);
    };
    img.onerror = (err) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    img.src = typeof blobOrUrl === 'string' ? blobOrUrl : objectUrl;
  });
}

function canvasFromImage(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cropCanvas(sourceCanvas, region, pad = 0) {
  const canvas = document.createElement('canvas');
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const x = clamp(Math.round((region.x - pad) * width), 0, width - 1);
  const y = clamp(Math.round((region.y - pad) * height), 0, height - 1);
  const w = clamp(Math.round((region.w + pad * 2) * width), 1, width - x);
  const h = clamp(Math.round((region.h + pad * 2) * height), 1, height - y);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);
  return canvas;
}

function preprocessCanvas(canvas, mode = 'normal') {
  const out = document.createElement('canvas');
  out.width = canvas.width * 2;
  out.height = canvas.height * 2;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let v = gray;
    if (mode === 'threshold') v = gray > 150 ? 255 : 0;
    if (mode === 'strong') v = gray > 170 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}

async function recognize(canvas, options = {}) {
  const worker = await getWorker();
  const opts = {
    tessedit_pageseg_mode: options.psm ?? 6,
    preserve_interword_spaces: 1,
    ...options.extra,
  };
  const res = await worker.recognize(canvas, opts);
  return {
    text: res.data.text || '',
    confidence: res.data.confidence ?? 0,
  };
}

function parseCountsFromText(text) {
  const normalized = String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[|｜]/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const result = { perfect: null, great: null, good: null, bad: null, miss: null, combo: null };
  const patterns = [
    ['perfect', /PERFECT|パーフェクト|ぺるふぇくと/i],
    ['great', /GREAT|ぐれーと|グレート/i],
    ['good', /GOOD|ぐっど|グッド/i],
    ['bad', /BAD|ばっど|バッド/i],
    ['miss', /MISS|みす|ミス/i],
    ['combo', /COMBO|コンボ/i],
  ];

  for (const line of normalized) {
    const digits = line.match(/\d+/g);
    if (!digits?.length) continue;
    const value = Number.parseInt(digits[digits.length - 1], 10);
    for (const [key, regex] of patterns) {
      if (result[key] === null && regex.test(line)) {
        result[key] = value;
      }
    }
  }

  const joined = normalized.join(' ');
  for (const [key, regex] of patterns) {
    if (result[key] === null) {
      const match = joined.match(new RegExp(`${regex.source}[^\\d]{0,12}(\\d+)`, 'i'));
      if (match) result[key] = Number.parseInt(match[1], 10);
    }
  }

  return result;
}

function parseTitleCandidate(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function parseDifficulty(text) {
  const upper = String(text || '').toUpperCase().replace(/[^A-Z]/g, '');
  const choices = ['APPEND', 'MASTER', 'EXPERT', 'HARD', 'NORMAL', 'EASY'];
  for (const item of choices) {
    if (upper.includes(item)) return item.toLowerCase();
  }
  return null;
}

function parseLevel(text) {
  const matches = String(text || '').match(/\d+/g);
  if (!matches?.length) return null;
  return Number.parseInt(matches[0], 10);
}

function computeMetrics(counts) {
  const perfect = counts.perfect ?? 0;
  const great = counts.great ?? 0;
  const good = counts.good ?? 0;
  const bad = counts.bad ?? 0;
  const miss = counts.miss ?? 0;
  const combo = counts.combo ?? null;
  const apMiss = great + good + bad + miss;
  const tournamentMiss = great + good * 2 + bad * 3 + miss * 3;
  const fcMiss = good + bad + miss;
  return {
    perfect, great, good, bad, miss, combo,
    apMiss,
    tournamentMiss,
    fcMiss,
    apDone: apMiss === 0,
    fcDone: fcMiss === 0,
  };
}

function selectTemplateRegions(template, width, height) {
  const regions = deepClone(template.regions);
  return Object.fromEntries(Object.entries(regions).map(([key, region]) => [key, regionToPixels(region, width, height)]));
}

async function analyzeWithTemplate(image, template, { fileName = '', forcedPadding = 0 } = {}) {
  const base = canvasFromImage(image);
  const regions = selectTemplateRegions(template, base.width, base.height);
  const worker = await getWorker();

  const result = {
    id: uid('record'),
    fileName,
    imageWidth: base.width,
    imageHeight: base.height,
    templateId: template.id,
    templateName: template.name,
    templateAspectRatio: template.aspectRatio,
    imageBlob: null,
    imageType: 'image/png',
    raw: {},
    warnings: [],
    needsManual: false,
    matched: null,
    counts: {},
    metrics: {},
  };

  const titleCrop = preprocessCanvas(cropCanvas(base, template.regions.title, forcedPadding), 'threshold');
  const titleAltCrop = preprocessCanvas(cropCanvas(base, template.regions.title, forcedPadding), 'normal');
  const [titleA, titleB] = await Promise.all([
    recognize(titleCrop, { psm: 7, extra: { tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzぁあいうえおかきくけこさしすせそたちつてとならにぬねのはひふへほまみむめもやゆよらりるれろわをんー・() 0123456789' } }),
    recognize(titleAltCrop, { psm: 7 }),
  ]);
  const rawTitle = parseTitleCandidate(titleA.text.length >= titleB.text.length ? titleA.text : titleB.text);
  const matched = resolveMusicInfo(rawTitle);
  result.raw.title = rawTitle;
  result.matched = matched;
  result.title = matched?.title || rawTitle;
  result.pronunciation = matched?.pronunciation || '';
  result.musicId = matched?.musicId ?? null;
  result.titleScore = matched?.matchScore ?? 0;

  const levelCrop = preprocessCanvas(cropCanvas(base, template.regions.level, forcedPadding), 'strong');
  const levelAltCrop = preprocessCanvas(cropCanvas(base, template.regions.level, forcedPadding), 'normal');
  const [levelA, levelB] = await Promise.all([
    recognize(levelCrop, { psm: 7, extra: { tessedit_char_whitelist: '0123456789' } }),
    recognize(levelAltCrop, { psm: 7, extra: { tessedit_char_whitelist: '0123456789' } }),
  ]);
  const level = parseLevel(levelA.text) ?? parseLevel(levelB.text);
  result.raw.level = levelA.text || levelB.text;
  result.level = level != null ? String(level) : '';

  const diffCrop = preprocessCanvas(cropCanvas(base, template.regions.difficulty, forcedPadding), 'normal');
  const diffAltCrop = preprocessCanvas(cropCanvas(base, template.regions.difficulty, forcedPadding), 'threshold');
  const [diffA, diffB] = await Promise.all([
    recognize(diffCrop, { psm: 7, extra: { tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' } }),
    recognize(diffAltCrop, { psm: 7, extra: { tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' } }),
  ]);
  const difficulty = parseDifficulty(diffA.text) || parseDifficulty(diffB.text);
  result.raw.difficulty = diffA.text || diffB.text;
  result.difficulty = difficulty || '';

  const resultCrop = preprocessCanvas(cropCanvas(base, template.regions.result, forcedPadding), 'threshold');
  const resultAltCrop = preprocessCanvas(cropCanvas(base, template.regions.result, forcedPadding), 'normal');
  const [resA, resB] = await Promise.all([
    recognize(resultCrop, { psm: 6 }),
    recognize(resultAltCrop, { psm: 6 }),
  ]);
  const countsA = parseCountsFromText(resA.text);
  const countsB = parseCountsFromText(resB.text);
  const counts = Object.values(countsB).filter((v) => v !== null).length > Object.values(countsA).filter((v) => v !== null).length ? countsB : countsA;
  result.raw.result = countsA;
  result.counts = counts;

  const comboCrop = preprocessCanvas(cropCanvas(base, template.regions.combo, forcedPadding), 'threshold');
  const comboAltCrop = preprocessCanvas(cropCanvas(base, template.regions.combo, forcedPadding), 'normal');
  const [comboA, comboB] = await Promise.all([
    recognize(comboCrop, { psm: 7, extra: { tessedit_char_whitelist: '0123456789' } }),
    recognize(comboAltCrop, { psm: 7, extra: { tessedit_char_whitelist: '0123456789' } }),
  ]);
  const combo = parseLevel(comboA.text) ?? parseLevel(comboB.text);
  result.raw.combo = comboA.text || comboB.text;
  result.combo = combo != null ? Number(combo) : null;

  result.metrics = computeMetrics({ ...counts, combo: result.combo });
  if (matched?.musicId && result.difficulty) {
    const expected = getDifficultyRow(matched.musicId, result.difficulty);
    if (expected) {
      result.expectedLevel = String(expected.playLevel ?? '');
      result.expectedTotalNotes = expected.totalNoteCount != null ? Number(expected.totalNoteCount) : null;
      if (result.level && String(result.level) !== String(expected.playLevel ?? '')) {
        result.warnings.push(`読み取ったレベル ${result.level} と DB のレベル ${expected.playLevel} が一致しません。`);
        result.needsManual = true;
      }
      if (result.expectedTotalNotes != null && result.metrics.perfect + result.metrics.great + result.metrics.good + result.metrics.bad + result.metrics.miss !== result.expectedTotalNotes) {
        result.warnings.push(`判定数の合計が総ノーツ数 ${result.expectedTotalNotes} と一致しません。`);
        result.needsManual = true;
      }
    }
  }

  if (!result.title || result.titleScore < 0.45) {
    result.warnings.push('曲名の候補が弱いため確認が必要です。');
    result.needsManual = true;
  }
  if (!result.level) {
    result.warnings.push('楽曲レベルを読み取れませんでした。');
    result.needsManual = true;
  }
  if (!result.difficulty) {
    result.warnings.push('楽曲難易度を読み取れませんでした。');
    result.needsManual = true;
  }
  if (result.combo == null) {
    result.warnings.push('コンボ数を読み取れませんでした。');
    result.needsManual = true;
  }

  return result;
}

export async function analyzeResultImage(input, template, options = {}) {
  const blob = input instanceof Blob ? input : (input?.blob || null);
  const image = await loadImage(blob || input);
  const result = await analyzeWithTemplate(image, template, options);
  result.imageBlob = blob || await (await fetch(image.src)).blob();
  result.imageType = blob?.type || 'image/png';
  result.sourceUrl = typeof input === 'string' ? input : '';
  return result;
}

export function createEmptyDraft(templateId) {
  return {
    id: uid('record'),
    title: '',
    pronunciation: '',
    musicId: null,
    level: '',
    difficulty: 'master',
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    miss: 0,
    combo: 0,
    totalNotes: 0,
    apMiss: 0,
    tournamentMiss: 0,
    fcMiss: 0,
    apDone: false,
    fcDone: false,
    templateId,
    warnings: [],
    needsManual: false,
  };
}

export function composeRecordFromDraft(draft, extra = {}) {
  const perfect = Number(draft.perfect || 0);
  const great = Number(draft.great || 0);
  const good = Number(draft.good || 0);
  const bad = Number(draft.bad || 0);
  const miss = Number(draft.miss || 0);
  const combo = numberOrNull(draft.combo);
  const totalNotes = numberOrNull(draft.totalNotes);
  const apMiss = great + good + bad + miss;
  const tournamentMiss = great + good * 2 + bad * 3 + miss * 3;
  const fcMiss = good + bad + miss;
  return {
    ...extra,
    title: String(draft.title || '').trim(),
    pronunciation: String(draft.pronunciation || '').trim(),
    musicId: draft.musicId ?? null,
    level: String(draft.level || '').trim(),
    difficulty: String(draft.difficulty || '').toLowerCase(),
    perfect, great, good, bad, miss, combo,
    totalNotes,
    apMiss,
    tournamentMiss,
    fcMiss,
    apDone: apMiss === 0,
    fcDone: fcMiss === 0,
    needsManual: Boolean(draft.needsManual),
    warnings: Array.isArray(draft.warnings) ? draft.warnings.slice() : [],
  };
}

export function recalculateDraftMetrics(draft) {
  const perfect = Number(draft.perfect || 0);
  const great = Number(draft.great || 0);
  const good = Number(draft.good || 0);
  const bad = Number(draft.bad || 0);
  const miss = Number(draft.miss || 0);
  draft.apMiss = great + good + bad + miss;
  draft.tournamentMiss = great + good * 2 + bad * 3 + miss * 3;
  draft.fcMiss = good + bad + miss;
  draft.apDone = draft.apMiss === 0;
  draft.fcDone = draft.fcMiss === 0;
  draft.totalNotes = Number(draft.totalNotes || 0) || perfect + great + good + bad + miss;
  return draft;
}

export function buildValidationMessages(draft, expected = null) {
  const messages = [];
  if (expected?.level && String(draft.level) !== String(expected.level)) {
    messages.push(`レベルが DB と一致しません。読み取り値: ${draft.level} / 正解候補: ${expected.level}`);
  }
  if (expected?.difficulty && String(draft.difficulty).toLowerCase() !== String(expected.difficulty).toLowerCase()) {
    messages.push(`難易度が DB と一致しません。読み取り値: ${draft.difficulty} / 正解候補: ${expected.difficulty}`);
  }
  if (expected?.totalNotes != null) {
    const total = Number(draft.perfect || 0) + Number(draft.great || 0) + Number(draft.good || 0) + Number(draft.bad || 0) + Number(draft.miss || 0);
    if (total !== Number(expected.totalNotes)) {
      messages.push(`判定数の合計 ${total} が総ノーツ数 ${expected.totalNotes} と一致しません。`);
    }
  }
  return messages;
}

export async function makePreviewDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
