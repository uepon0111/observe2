
import { DIFFICULTIES, DIFFICULTY_ORDER, MISS_MODES } from './config.js';
import { normalizeSearchText, safeNumber } from './utils.js';
import { normalizeDifficulty } from './musicData.js';

function getRecordMissValue(record, mode) {
  switch (mode) {
    case 'apTournament':
      return safeNumber(record.apTournamentMiss, 0);
    case 'fc':
      return safeNumber(record.fcMiss, 0);
    case 'ap':
    default:
      return safeNumber(record.apMiss, 0);
  }
}

function getSortSecondaryMiss(record, mode) {
  return getRecordMissValue(record, mode);
}

function getDifficultyOrder(record) {
  return DIFFICULTY_ORDER[normalizeDifficulty(record.difficulty)] ?? 99;
}

function getLevelValue(record) {
  return safeNumber(record.playLevel, 0);
}

function getSongName(record) {
  return normalizeSearchText(record.title || '');
}

function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareNumbers(a, b) {
  return a - b;
}

function sortByPriority(records, chain, direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1;
  return [...records].sort((a, b) => {
    for (const item of chain) {
      const va = item.value(a);
      const vb = item.value(b);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') cmp = compareNumbers(va, vb);
      else cmp = compareStrings(String(va), String(vb));
      if (cmp !== 0) return cmp * sign;
    }
    return 0;
  });
}

export function applyFilters(records, state) {
  const titleQuery = normalizeSearchText(state.titleQuery || '');
  const levelQuery = normalizeSearchText(state.levelQuery || '');
  const minMiss = state.missMin === '' ? null : Number(state.missMin);
  const maxMiss = state.missMax === '' ? null : Number(state.missMax);
  const activeDiffs = state.difficultyFilters instanceof Set ? state.difficultyFilters : new Set(DIFFICULTIES);

  return records.filter((record) => {
    if (state.view === 'trash') {
      if (!record.trashedAt) return false;
    } else if (record.trashedAt) {
      return false;
    }

    if (state.apFilter && !record.apDone) return false;
    if (state.fcFilter && !record.fcDone) return false;

    if (activeDiffs.size && !activeDiffs.has(normalizeDifficulty(record.difficulty))) return false;

    const haystack = normalizeSearchText([
      record.title,
      record.pronunciation,
      record.musicId,
      record.playLevel,
      record.difficulty,
    ].join(' '));

    if (titleQuery && !haystack.includes(titleQuery)) return false;
    if (levelQuery) {
      const levelText = normalizeSearchText(String(record.playLevel ?? ''));
      if (!levelText.includes(levelQuery)) return false;
    }

    const missValue = getRecordMissValue(record, state.missMode);
    if (minMiss != null && missValue < minMiss) return false;
    if (maxMiss != null && missValue > maxMiss) return false;

    return true;
  });
}

export function getBestRecordMap(records, state) {
  const map = new Map();
  for (const record of records) {
    if (record.trashedAt) continue;
    const key = record.songKey || `${normalizeSearchText(record.title)}|${normalizeDifficulty(record.difficulty)}|${record.playLevel}`;
    const current = map.get(key);
    const value = getRecordMissValue(record, state.missMode);
    if (!current) {
      map.set(key, record);
      continue;
    }
    const currentValue = getRecordMissValue(current, state.missMode);
    if (value < currentValue) {
      map.set(key, record);
      continue;
    }
    if (value === currentValue) {
      if (safeNumber(record.score, 0) > safeNumber(current.score, 0)) {
        map.set(key, record);
        continue;
      }
      if (safeNumber(record.combo, 0) > safeNumber(current.combo, 0)) {
        map.set(key, record);
      }
    }
  }
  return map;
}

export function applyBestOnly(records, state) {
  if (!state.showBestOnly) return records;
  const bestMap = getBestRecordMap(records, state);
  const bestIds = new Set([...bestMap.values()].map((record) => record.id));
  return records.filter((record) => bestIds.has(record.id));
}

export function sortRecords(records, state) {
  const direction = state.sortDirection || 'desc';
  const missMode = state.missMode || 'ap';

  const chains = {
    name: [
      { value: (r) => getSongName(r) },
      { value: (r) => getDifficultyOrder(r) },
      { value: (r) => getSortSecondaryMiss(r, missMode) },
      { value: (r) => safeNumber(r.createdAt, 0) },
    ],
    level: [
      { value: (r) => getLevelValue(r) },
      { value: (r) => getDifficultyOrder(r) },
      { value: (r) => getSongName(r) },
      { value: (r) => getSortSecondaryMiss(r, missMode) },
      { value: (r) => safeNumber(r.createdAt, 0) },
    ],
    miss: [
      { value: (r) => getSortSecondaryMiss(r, missMode) },
      { value: (r) => getLevelValue(r) },
      { value: (r) => getDifficultyOrder(r) },
      { value: (r) => getSongName(r) },
      { value: (r) => safeNumber(r.createdAt, 0) },
    ],
    date: [
      { value: (r) => safeNumber(r.createdAt, 0) },
    ],
  };

  return sortByPriority(records, chains[state.sortKey] || chains.date, direction);
}

export function computeVirtualWindow(container, totalItems, itemHeight, overscan = 4) {
  const scrollTop = container.scrollTop || 0;
  const viewportHeight = container.clientHeight || 0;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const end = Math.min(totalItems, Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan);
  return { start, end, topPadding: start * itemHeight, bottomPadding: Math.max(0, (totalItems - end) * itemHeight) };
}

export function getMissModeMeta(mode) {
  return MISS_MODES.find((item) => item.key === mode) || MISS_MODES[0];
}

export function getMissValue(record, mode) {
  return getRecordMissValue(record, mode);
}
