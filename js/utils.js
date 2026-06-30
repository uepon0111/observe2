export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function nowISO() {
  return new Date().toISOString();
}

export function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function deepClone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function toHiragana(text = '') {
  return String(text)
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0x60));
}

export function normalizeText(text = '') {
  return toHiragana(String(text))
    .toLowerCase()
    .replace(/[\s\u3000\-_・･.,/\\()【】\[\]{}「」『』'"`~!@#$%^&*+=|:;<>?！？。、]/g, '')
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

export function normalizeKana(text = '') {
  return toHiragana(String(text))
    .replace(/[\s\u3000\-_・･.,/\\()【】\[\]{}「」『』'"`~!@#$%^&*+=|:;<>?！？。、]/g, '')
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

export function levenshtein(a = '', b = '') {
  const s = String(a);
  const t = String(b);
  const rows = s.length + 1;
  const cols = t.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[rows - 1][cols - 1];
}

export function similarity(a = '', b = '') {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  const dist = levenshtein(x, y);
  const denom = Math.max(x.length, y.length);
  return Math.max(0, 1 - dist / Math.max(1, denom));
}

export function parseIntLoose(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number.parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function crcLikeKey(parts) {
  return parts.filter(Boolean).join('::');
}

export function getBasisMetric(record, basisMode) {
  if (!record) return Infinity;
  if (basisMode === 'tournament') return record.tournamentMiss ?? Infinity;
  if (basisMode === 'fc') return record.fcMiss ?? Infinity;
  return record.apMiss ?? Infinity;
}

export function getStatusByBasis(record, basisMode) {
  if (!record) return { ap: false, fc: false };
  if (basisMode === 'tournament') {
    return { ap: (record.tournamentMiss ?? 1) === 0, fc: (record.fcMiss ?? 1) === 0 };
  }
  return { ap: (record.apMiss ?? 1) === 0, fc: (record.fcMiss ?? 1) === 0 };
}

export function escapeText(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function regionToPixels(region, width, height) {
  return {
    x: region.x * width,
    y: region.y * height,
    w: region.w * width,
    h: region.h * height,
  };
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
