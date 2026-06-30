import { normalizeText, normalizeKana, similarity } from './utils.js';

let musicRows = [];
let difficultyRows = [];
let musicById = new Map();
let difficultyByKey = new Map();
let searchItems = [];

export async function loadMusicDb() {
  const [musicsResp, diffsResp] = await Promise.all([
    fetch('https://sekai-world.github.io/sekai-master-db-diff/musics.json'),
    fetch('https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json'),
  ]);
  const musics = await musicsResp.json();
  const diffs = await diffsResp.json();
  setMusicData(musics, diffs);
  return { musics: musicRows, diffs: difficultyRows };
}

export function setMusicData(musics = [], diffs = []) {
  musicRows = Array.isArray(musics) ? musics : [];
  difficultyRows = Array.isArray(diffs) ? diffs : [];
  musicById = new Map();
  difficultyByKey = new Map();
  searchItems = [];

  for (const item of musicRows) {
    if (!item) continue;
    const row = {
      id: item.id,
      title: item.title ?? '',
      pronunciation: item.pronunciation ?? '',
      titleNorm: normalizeText(item.title ?? ''),
      pronunciationNorm: normalizeKana(item.pronunciation ?? ''),
      raw: item,
    };
    musicById.set(String(row.id), row);
    searchItems.push(row);
  }

  for (const item of difficultyRows) {
    if (!item) continue;
    const key = `${item.musicId}__${String(item.musicDifficulty).toLowerCase()}`;
    difficultyByKey.set(key, {
      musicId: item.musicId,
      musicDifficulty: String(item.musicDifficulty).toLowerCase(),
      playLevel: item.playLevel ?? '',
      totalNoteCount: item.totalNoteCount ?? null,
      raw: item,
    });
  }
}

export function getMusicById(id) {
  return musicById.get(String(id)) ?? null;
}

export function getDifficultyRow(musicId, musicDifficulty) {
  return difficultyByKey.get(`${musicId}__${String(musicDifficulty).toLowerCase()}`) ?? null;
}

export function getDifficultyLabel(key) {
  const map = {
    easy: 'EASY',
    normal: 'NORMAL',
    hard: 'HARD',
    expert: 'EXPERT',
    master: 'MASTER',
    append: 'APPEND',
  };
  return map[String(key).toLowerCase()] ?? String(key ?? '').toUpperCase();
}

export function getDiffOrder(key) {
  const order = { easy: 1, normal: 2, hard: 3, expert: 4, master: 5, append: 6 };
  return order[String(key).toLowerCase()] ?? 99;
}

export function buildMusicIndex() {
  return searchItems;
}

export function findBestMusicMatch(query) {
  const raw = String(query ?? '').trim();
  if (!raw) return null;
  const normalized = normalizeText(raw);
  const kana = normalizeKana(raw);
  let best = null;
  let bestScore = -1;
  for (const item of searchItems) {
    const titleScore = similarity(normalized, item.titleNorm);
    const pronScore = similarity(kana, item.pronunciationNorm);
    const combined = Math.max(titleScore, pronScore, similarity(raw, item.title));
    if (combined > bestScore) {
      bestScore = combined;
      best = item;
    }
  }
  if (!best) return null;
  return { ...best, score: bestScore };
}

export function resolveMusicInfo(titleQuery, fallbackDifficulty = null) {
  const match = findBestMusicMatch(titleQuery);
  if (!match) return null;
  const diffs = difficultyRows.filter((row) => String(row.musicId) === String(match.id));
  let diffMatch = null;
  if (fallbackDifficulty) {
    diffMatch = diffs.find((row) => String(row.musicDifficulty).toLowerCase() === String(fallbackDifficulty).toLowerCase()) ?? null;
  }
  return {
    musicId: match.id,
    title: match.title,
    pronunciation: match.pronunciation,
    matchScore: match.score,
    difficulties: diffs,
    difficulty: diffMatch,
  };
}

export function getExpectedLevelAndTotalNotes(musicId, difficultyKey) {
  const row = getDifficultyRow(musicId, difficultyKey);
  if (!row) return null;
  return {
    playLevel: row.playLevel != null ? String(row.playLevel) : '',
    totalNoteCount: row.totalNoteCount != null ? Number(row.totalNoteCount) : null,
  };
}

export function listMusicSearchItems() {
  return searchItems.slice();
}
