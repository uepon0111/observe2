
import { APP_CONFIG, OCR_BOXES, KEYWORDS, DIFFICULTIES } from './config.js';
import { clamp, parseSafeInt, normalizeSearchText, normalizeKana, similarityScore } from './utils.js';
import { findBestMusicMatch, normalizeDifficulty, getSongDifficultyInfo } from './musicData.js';

let ocrReadyPromise = null;

function assertTesseract() {
  if (!window.Tesseract) {
    throw new Error('Tesseract.js が読み込まれていません。');
  }
}

export async function ensureOcrReady() {
  assertTesseract();
  if (!ocrReadyPromise) {
    ocrReadyPromise = Promise.resolve(true);
  }
  return ocrReadyPromise;
}

async function fileToImage(file) {
  const bitmap = await createImageBitmap(file);
  return bitmap;
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function preprocessSource(source, scale = 2.2, mode = 'normal') {
  const canvas = createCanvas(source.width * scale, source.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.filter = mode === 'strong'
    ? 'grayscale(1) contrast(2.4) brightness(1.15)'
    : 'grayscale(1) contrast(1.8) brightness(1.05)';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const threshold = mode === 'strong' ? 170 : 150;
  for (let i = 0; i < data.length; i += 4) {
    const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const bin = v > threshold ? 255 : 0;
    data[i] = bin;
    data[i + 1] = bin;
    data[i + 2] = bin;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function cropCanvas(source, box, extraScale = 1, mode = 'normal') {
  const scaled = preprocessSource(source, extraScale, mode);
  const canvas = createCanvas(scaled.width * box.w, scaled.height * box.h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const sx = scaled.width * box.x;
  const sy = scaled.height * box.y;
  const sw = scaled.width * box.w;
  const sh = scaled.height * box.h;
  ctx.drawImage(scaled, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function expandBox(box, padding = 0.02) {
  return {
    x: clamp(box.x - padding, 0, 1),
    y: clamp(box.y - padding, 0, 1),
    w: clamp(box.w + padding * 2, 0.01, 1),
    h: clamp(box.h + padding * 2, 0.01, 1),
  };
}

async function recognize(canvas, lang = APP_CONFIG.ocrLanguages) {
  const options = {
    logger: () => {},
  };
  const result = await window.Tesseract.recognize(canvas, lang, options);
  return String(result?.data?.text || '');
}

function cleanText(text = '') {
  return String(text)
    .replace(/\u0000/g, '')
    .replace(/[｜|]/g, 'I')
    .replace(/[OＯ]/g, '0')
    .replace(/[lI]/g, '1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTitleCandidate(text) {
  return cleanText(text)
    .replace(/^[^\p{L}\p{N}\u3040-\u30ff\u4e00-\u9fff]+/gu, '')
    .replace(/[^\p{L}\p{N}\u3040-\u30ff\u4e00-\u9fffぁ-んァ-ヶー\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLevel(text) {
  const normalized = cleanText(text);
  const match = normalized.match(/(?:Lv\.?|LEVEL|レベル)?\s*0?(\d{1,2})/i);
  if (match) return parseSafeInt(match[1], null);
  const digits = normalized.match(/\b(\d{1,2})\b/);
  return digits ? parseSafeInt(digits[1], null) : null;
}

function parseDifficulty(text) {
  const normalized = cleanText(text).toUpperCase();
  const match = normalized.match(KEYWORDS.difficultyRegex);
  return match ? normalizeDifficulty(match[1]) : null;
}

function parseJudgements(text) {
  const normalized = cleanText(text).toUpperCase();
  const labels = ['PERFECT', 'GREAT', 'GOOD', 'BAD', 'MISS'];
  const result = {};
  for (const label of labels) {
    const rx = new RegExp(`${label}\\D*0*(\\d{1,5})`, 'i');
    const match = normalized.match(rx);
    result[label.toLowerCase()] = match ? parseSafeInt(match[1], 0) : 0;
  }
  const comboMatch = normalized.match(/COMBO\D*0*(\d{1,5})/i);
  const scoreMatch = normalized.match(/スコア\D*0*(\d{5,9})/i);
  result.combo = comboMatch ? parseSafeInt(comboMatch[1], 0) : null;
  result.score = scoreMatch ? parseSafeInt(scoreMatch[1], 0) : null;
  return result;
}

function deriveMetrics(result) {
  const perfect = parseSafeInt(result.perfect, 0);
  const great = parseSafeInt(result.great, 0);
  const good = parseSafeInt(result.good, 0);
  const bad = parseSafeInt(result.bad, 0);
  const miss = parseSafeInt(result.miss, 0);

  const apMiss = great + good + bad + miss;
  const apTournamentMiss = great * 1 + good * 2 + bad * 3 + miss * 3;
  const fcMiss = good + bad + miss;
  const totalNoteCount = perfect + great + good + bad + miss;

  return {
    perfect,
    great,
    good,
    bad,
    miss,
    combo: parseSafeInt(result.combo, null),
    apMiss,
    apTournamentMiss,
    fcMiss,
    totalNoteCount,
    apDone: apMiss === 0,
    fcDone: fcMiss === 0,
  };
}

async function recognizeArea(source, box, lang, mode = 'normal') {
  const cropped = cropCanvas(source, expandBox(box, 0.01), mode === 'strong' ? 2.8 : 2.1, mode);
  return cleanText(await recognize(cropped, lang));
}

export async function readResultImage(file, catalog, onProgress = () => {}) {
  await ensureOcrReady();
  const bitmap = await fileToImage(file);
  const source = createCanvas(bitmap.width, bitmap.height);
  const ctx = source.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);

  const attempts = [
    { mode: 'normal', scaleTitle: 2.0, scaleDetail: 2.0 },
    { mode: 'strong', scaleTitle: 2.8, scaleDetail: 2.8 },
  ];

  let bestDraft = null;
  let finalWarnings = [];

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    const attempt = attempts[attemptIndex];
    onProgress({ step: 'title', attempt: attemptIndex + 1 });
    const titleText = await recognizeArea(source, OCR_BOXES.title, 'jpn+eng', attempt.mode);

    onProgress({ step: 'level-difficulty', attempt: attemptIndex + 1 });
    const levelText = await recognizeArea(source, { ...OCR_BOXES.level, w: Math.max(OCR_BOXES.level.w, OCR_BOXES.difficulty.w + 0.04) }, 'jpn+eng', attempt.mode);
    const difficultyText = await recognizeArea(source, OCR_BOXES.difficulty, 'jpn+eng', attempt.mode);

    onProgress({ step: 'result', attempt: attemptIndex + 1 });
    const resultText = await recognizeArea(source, OCR_BOXES.result, 'eng', attempt.mode);
    const comboText = await recognizeArea(source, OCR_BOXES.combo, 'eng', attempt.mode);

    const level = parseLevel(levelText);
    const difficulty = parseDifficulty(difficultyText) || parseDifficulty(levelText);
    const judgements = parseJudgements(`${resultText}\n${comboText}`);
    const metrics = deriveMetrics(judgements);

    const titleCandidate = parseTitleCandidate(titleText);
    const titleMatch = findBestMusicMatch(catalog, titleCandidate, {
      playLevel: level,
      musicDifficulty: difficulty,
    });

    const song = titleMatch?.song || null;
    const info = song && difficulty ? getSongDifficultyInfo(catalog, song.id, difficulty) : null;
    const title = song?.title || titleCandidate || '';
    const pronunciation = song?.pronunciation || '';

    const warnings = [];
    if (!song) warnings.push('タイトルの自動判定ができませんでした。');
    if (song && level != null && info?.playLevel != null && Number(info.playLevel) !== Number(level)) {
      warnings.push('楽曲レベルに矛盾が見つかりました。');
    }
    if (song && difficulty && info?.musicDifficulty && normalizeDifficulty(info.musicDifficulty) !== normalizeDifficulty(difficulty)) {
      warnings.push('楽曲難易度に矛盾が見つかりました。');
    }
    if (song && info?.totalNoteCount != null && metrics.totalNoteCount != null && Number(info.totalNoteCount) !== Number(metrics.totalNoteCount)) {
      warnings.push('総ノーツ数に矛盾が見つかりました。');
    }

    const draft = {
      title,
      pronunciation,
      musicId: song?.id ?? null,
      playLevel: level ?? info?.playLevel ?? null,
      difficulty: difficulty ?? info?.musicDifficulty ?? null,
      ...metrics,
      titleRaw: titleText,
      levelRaw: levelText,
      difficultyRaw: difficultyText,
      resultRaw: resultText,
      comboRaw: comboText,
      autoMatched: !!song,
      autoScore: titleMatch?.score ?? 0,
      needsReview: warnings.length > 0,
      warnings,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      readingBoxes: OCR_BOXES,
    };

    const isConsistent = warnings.length === 0 && song && level != null && difficulty != null && metrics.totalNoteCount > 0;
    if (isConsistent) {
      bestDraft = { draft, warnings };
      break;
    }

    finalWarnings = warnings;
    bestDraft = { draft, warnings };
  }

  return bestDraft;
}

export function getReadingOverlayBoxes() {
  return OCR_BOXES;
}
