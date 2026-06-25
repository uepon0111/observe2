
export function normalizeKana(input = '') {
  return String(input)
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function normalizeText(input = '') {
  const kana = normalizeKana(String(input).normalize('NFKC')).toLowerCase();
  return kana
    .replace(/\s+/g, '')
    .replace(/[‘’'"\-_.・,、。/()［\]【】「」『』！？!?~～:：;；|｜+*^$#@&]/g, '')
    .trim();
}

export function normalizeSearchText(input = '') {
  return normalizeText(input);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function formatDateTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function daysBetween(from, to = Date.now()) {
  return (to - from) / (1000 * 60 * 60 * 24);
}

export function isNumericText(input = '') {
  return /^-?\d+(\.\d+)?$/.test(String(input).trim());
}

export function levenshtein(a = '', b = '') {
  const s = String(a);
  const t = String(b);
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = Array(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}

export function similarityScore(a = '', b = '') {
  const sa = normalizeSearchText(a);
  const sb = normalizeSearchText(b);
  if (!sa && !sb) return 1;
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  const dist = levenshtein(sa, sb);
  return 1 - dist / Math.max(sa.length, sb.length, 1);
}

export function toHiraganaOnly(input = '') {
  return normalizeKana(input).replace(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFFぁ-んァ-ヶー0-9a-zA-Z]/g, '');
}

export function parseSafeInt(input, fallback = 0) {
  const n = parseInt(String(input).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function setText(el, text) {
  if (el) el.textContent = text;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function escapeHtml(input = '') {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
