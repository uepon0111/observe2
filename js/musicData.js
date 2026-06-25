
import { APP_CONFIG, DIFFICULTIES, DIFFICULTY_ORDER } from './config.js';
import { normalizeSearchText, similarityScore, toHiraganaOnly } from './utils.js';

let cachedCatalog = null;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDifficulty(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  const map = {
    0: 'EASY',
    1: 'NORMAL',
    2: 'HARD',
    3: 'EXPERT',
    4: 'MASTER',
    5: 'APPEND',
  };
  if (Object.prototype.hasOwnProperty.call(map, raw)) return map[raw];
  if (DIFFICULTIES.includes(raw)) return raw;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && map[numeric] != null) return map[numeric];
  return raw;
}

function extractField(row, names) {
  for (const name of names) {
    if (row?.[name] != null) return row[name];
  }
  return null;
}

function buildSearchText(title, pronunciation, difficultyTexts = []) {
  const pieces = [title, pronunciation, ...difficultyTexts];
  return pieces
    .filter(Boolean)
    .map((value) => normalizeSearchText(value))
    .join(' ');
}

export async function loadMusicCatalog(force = false) {
  if (cachedCatalog && !force) return cachedCatalog;

  const [musicRes, diffRes] = await Promise.all([
    fetch(APP_CONFIG.musicCatalogUrl, { cache: 'no-store' }),
    fetch(APP_CONFIG.difficultyCatalogUrl, { cache: 'no-store' }),
  ]);

  if (!musicRes.ok) throw new Error(`楽曲一覧の取得に失敗しました: ${musicRes.status}`);
  if (!diffRes.ok) throw new Error(`難易度一覧の取得に失敗しました: ${diffRes.status}`);

  const musicRows = asArray(await musicRes.json());
  const difficultyRows = asArray(await diffRes.json());

  const difficultyMap = new Map();
  for (const row of difficultyRows) {
    const musicId = Number(extractField(row, ['musicId', 'music_id', 'id']));
    const difficulty = normalizeDifficulty(extractField(row, ['musicDifficulty', 'difficulty', 'music_difficulty']));
    const playLevel = Number(extractField(row, ['playLevel', 'play_level', 'level']));
    const totalNoteCount = Number(extractField(row, ['totalNoteCount', 'total_note_count', 'totalNotes', 'noteCount']));
    if (!Number.isFinite(musicId)) continue;
    difficultyMap.set(`${musicId}:${difficulty}`, {
      musicId,
      musicDifficulty: difficulty,
      playLevel: Number.isFinite(playLevel) ? playLevel : null,
      totalNoteCount: Number.isFinite(totalNoteCount) ? totalNoteCount : null,
      raw: row,
    });
  }

  const songs = musicRows.map((row) => {
    const id = Number(extractField(row, ['id', 'musicId', 'music_id']));
    const title = String(extractField(row, ['title', 'name']) ?? '');
    const pronunciation = String(extractField(row, ['pronunciation', 'reading']) ?? '');
    const diffs = DIFFICULTIES.map((difficulty) => difficultyMap.get(`${id}:${difficulty}`)).filter(Boolean);
    const searchText = buildSearchText(title, pronunciation, diffs.map((d) => `${d.musicDifficulty} ${d.playLevel}`));
    return {
      id,
      title,
      pronunciation,
      searchText,
      difficulties: diffs,
      raw: row,
    };
  }).filter((song) => Number.isFinite(song.id) && song.title);

  const titleIndex = songs.map((song) => ({
    ...song,
    normalizedTitle: normalizeSearchText(song.title),
    normalizedPronunciation: normalizeSearchText(song.pronunciation),
    hiraganaTitle: toHiraganaOnly(song.title),
    hiraganaPronunciation: toHiraganaOnly(song.pronunciation),
  }));

  cachedCatalog = {
    songs,
    titleIndex,
    difficultyMap,
    difficultyRows,
    musicRows,
  };
  return cachedCatalog;
}

export function getSongDifficultyInfo(catalog, musicId, difficulty) {
  return catalog?.difficultyMap?.get(`${Number(musicId)}:${normalizeDifficulty(difficulty)}`) || null;
}

export function findBestMusicMatch(catalog, query, hints = {}) {
  if (!catalog || !Array.isArray(catalog.titleIndex)) return null;
  const normalizedQuery = normalizeSearchText(query);
  const hiraganaQuery = toHiraganaOnly(query);

  let best = null;
  let bestScore = -1;

  for (const song of catalog.titleIndex) {
    let score = 0;
    const titleScore = similarityScore(normalizedQuery, song.normalizedTitle);
    const pronunciationScore = similarityScore(normalizedQuery, song.normalizedPronunciation);
    const hiraTitleScore = similarityScore(hiraganaQuery, song.hiraganaTitle);
    const hiraPronScore = similarityScore(hiraganaQuery, song.hiraganaPronunciation);

    score += Math.max(titleScore * 1.2, pronunciationScore * 1.0, hiraTitleScore * 1.15, hiraPronScore * 0.95);

    if (normalizedQuery && (song.normalizedTitle.includes(normalizedQuery) || song.normalizedPronunciation.includes(normalizedQuery))) {
      score += 0.25;
    }

    const levelHint = hints.playLevel != null ? Number(hints.playLevel) : null;
    const difficultyHint = hints.musicDifficulty ? normalizeDifficulty(hints.musicDifficulty) : null;

    if (levelHint != null || difficultyHint) {
      const matchedDifficulty = song.difficulties.find((d) => {
        if (difficultyHint && d.musicDifficulty !== difficultyHint) return false;
        if (levelHint != null && Number(d.playLevel) !== levelHint) return false;
        return true;
      });
      if (matchedDifficulty) score += 0.7;
      else {
        const anyLevelMatch = levelHint != null && song.difficulties.some((d) => Number(d.playLevel) === levelHint);
        const anyDifficultyMatch = difficultyHint && song.difficulties.some((d) => d.musicDifficulty === difficultyHint);
        if (anyLevelMatch) score += 0.25;
        if (anyDifficultyMatch) score += 0.25;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = song;
    }
  }

  return best ? { song: best, score: bestScore } : null;
}

export function getSongDifficultyRecord(catalog, musicId, difficulty) {
  const info = getSongDifficultyInfo(catalog, musicId, difficulty);
  return info ? { ...info } : null;
}

export function getCatalogDifficultyOrder(difficulty) {
  return DIFFICULTY_ORDER[normalizeDifficulty(difficulty)] ?? 99;
}

export { normalizeDifficulty };
