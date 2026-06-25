export const DIFFICULTIES = [
  { key: 'EASY', color: '#66DA7E', order: 0 },
  { key: 'NORMAL', color: '#66C9F9', order: 1 },
  { key: 'HARD', color: '#F5CC44', order: 2 },
  { key: 'EXPERT', color: '#EA5577', order: 3 },
  { key: 'MASTER', color: '#BB40F5', order: 4 },
  { key: 'APPEND', color: '#EE82E2', order: 5 },
];

export const DIFFICULTY_ORDER = Object.fromEntries(DIFFICULTIES.map((d) => [d.key, d.order]));
export const DIFFICULTY_COLOR = Object.fromEntries(DIFFICULTIES.map((d) => [d.key, d.color]));

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function nvl(value, fallback = '') {
  return value === null || value === undefined || value === '' ? fallback : value;
}

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\[\]{}【】<>《》・,，.。!！?？/\\|_~`'"“”‘’:+;=＊*^$#@&％%]/g, '')
    .replace(/ー/g, '-');
}

export function normalizeSearch(value = '') {
  return normalizeText(value).replace(/-/g, '');
}

export function stripNumbers(value = '') {
  return String(value).replace(/[^0-9]/g, '');
}

export function parseNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export function formatNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString('ja-JP') : '0';
}

export function formatShortDateTime(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDateOnly(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export function formatRelativeDays(timestamp) {
  if (!timestamp) return '-';
  const diff = Math.max(0, Date.now() - timestamp);
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return '今日';
  if (days === 1) return '1日後';
  return `${days}日後`;
}

export function createId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function levenshtein(a = '', b = '') {
  const s = [...String(a)];
  const t = [...String(b)];
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array(n + 1).fill(0).map((_, i) => i);
  const curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

export function similarityScore(a = '', b = '') {
  const aa = normalizeSearch(a);
  const bb = normalizeSearch(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 0.92;
  const dist = levenshtein(aa, bb);
  return 1 - dist / Math.max(aa.length, bb.length);
}

export function bestTextMatch(query, candidates, accessor = (item) => item) {
  const q = normalizeSearch(query);
  if (!q) return null;
  let best = null;
  let bestScore = -1;
  for (const item of candidates) {
    const text = accessor(item);
    const score = similarityScore(q, text);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 0.42 ? { item: best, score: bestScore } : null;
}

export function parseLevelRange(input) {
  const clean = String(input ?? '').trim();
  if (!clean) return null;
  const match = clean.match(/^(\d{1,2})(?:\s*[-〜~]\s*(\d{1,2}))?$/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = match[2] ? Number(match[2]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

export function withinRange(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return false;
  if (min !== null && min !== undefined && value < min) return false;
  if (max !== null && max !== undefined && value > max) return false;
  return true;
}

export function sum(values = []) {
  return values.reduce((a, b) => a + (Number(b) || 0), 0);
}

export function roundPct(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/data:(.*?);base64/)?.[1] || 'image/png';
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeFilename(name = 'result') {
  return String(name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'result';
}

export function basisMissCount(record, basis = 'ap') {
  if (basis === 'fc') return Number(record.missFC ?? 0);
  if (basis === 'contest') return Number(record.missContest ?? 0);
  return Number(record.missAP ?? 0);
}

export function basisAchieved(record, basis = 'ap') {
  if (basis === 'fc') return Number(record.good) + Number(record.bad) + Number(record.miss) === 0;
  if (basis === 'contest') return Number(record.missContest ?? 0) === 0;
  return Number(record.great) + Number(record.good) + Number(record.bad) + Number(record.miss) === 0;
}

export function groupKey(record) {
  return `${record.musicId || ''}:${record.difficulty || ''}`;
}

export function compareDifficulty(a, b) {
  return (DIFFICULTY_ORDER[a.difficulty] ?? 99) - (DIFFICULTY_ORDER[b.difficulty] ?? 99);
}

export function compareString(a, b) {
  return new Intl.Collator('ja', { numeric: true, sensitivity: 'base' }).compare(String(a ?? ''), String(b ?? ''));
}

export function normalizeMaybeRoman(value = '') {
  return normalizeSearch(value).replace(/[ァ-ヶ]/g, (ch) => ch);
}

export function toCanvasRegion(imageWidth, imageHeight, region) {
  const x = clamp(Math.round(imageWidth * (region.x / 100)), 0, imageWidth - 1);
  const y = clamp(Math.round(imageHeight * (region.y / 100)), 0, imageHeight - 1);
  const w = clamp(Math.round(imageWidth * (region.w / 100)), 1, imageWidth - x);
  const h = clamp(Math.round(imageHeight * (region.h / 100)), 1, imageHeight - y);
  return { x, y, w, h };
}

export async function fileToImageBitmap(file) {
  if ('createImageBitmap' in window) return await createImageBitmap(file);
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return img;
}

export function drawCropToCanvas(source, crop) {
  const canvas = document.createElement('canvas');
  canvas.width = crop.w;
  canvas.height = crop.h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  return canvas;
}

export function enhanceCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const boosted = gray > 170 ? 255 : gray < 70 ? 0 : gray;
    data[i] = data[i + 1] = data[i + 2] = boosted;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function clampRegion(region) {
  return {
    x: clamp(Number(region.x) || 0, 0, 100),
    y: clamp(Number(region.y) || 0, 0, 100),
    w: clamp(Number(region.w) || 0, 1, 100),
    h: clamp(Number(region.h) || 0, 1, 100),
  };
}

export function copy(obj) {
  return JSON.parse(JSON.stringify(obj));
}
