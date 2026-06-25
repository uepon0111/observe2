import { bestTextMatch, normalizeSearch, parseNumber } from './utils.js';

const MUSIC_URL = 'https://sekai-world.github.io/sekai-master-db-diff/musics.json';
const DIFFICULTY_URL = 'https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json';

let cache = null;

function pick(obj, keys, fallback = null) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function normalizeSong(entry) {
  return {
    raw: entry,
    id: String(pick(entry, ['id', 'musicId', 'music_id', 'masterMusicId'], '')),
    title: String(pick(entry, ['title', 'name', 'musicTitle'], '')).trim(),
    pronunciation: String(pick(entry, ['pronunciation', 'reading', 'kana', 'yomi'], '')).trim(),
  };
}

function normalizeDifficulty(entry) {
  const difficulty = String(pick(entry, ['musicDifficulty', 'difficulty', 'levelType'], '')).toUpperCase();
  const musicId = String(pick(entry, ['musicId', 'music_id', 'id'], ''));
  const playLevel = parseNumber(pick(entry, ['playLevel', 'level', 'difficultyLevel'], null), null);
  const totalNoteCount = parseNumber(pick(entry, ['totalNoteCount', 'noteCount', 'totalNotes'], null), null);
  return { raw: entry, musicId, musicDifficulty: difficulty, playLevel, totalNoteCount };
}

export async function loadMasterData() {
  if (cache) return cache;
  const [musicRes, diffRes] = await Promise.all([fetch(MUSIC_URL), fetch(DIFFICULTY_URL)]);
  if (!musicRes.ok) throw new Error('musics.json の取得に失敗しました');
  if (!diffRes.ok) throw new Error('musicDifficulties.json の取得に失敗しました');
  const [musicsRaw, diffsRaw] = await Promise.all([musicRes.json(), diffRes.json()]);
  const songs = musicsRaw.map(normalizeSong).filter((s) => s.title);
  const difficulties = diffsRaw.map(normalizeDifficulty).filter((d) => d.musicId && d.musicDifficulty);

  const songById = new Map();
  for (const song of songs) {
    songById.set(song.id, { ...song, difficulties: [] });
  }

  const difficultyMap = new Map();
  for (const diff of difficulties) {
    const song = songById.get(diff.musicId) || null;
    const record = {
      ...diff,
      title: song?.title || '',
      pronunciation: song?.pronunciation || '',
    };
    difficultyMap.set(`${diff.musicId}:${diff.musicDifficulty}`, record);
    if (song) song.difficulties.push(record);
  }

  const titles = songs.map((song) => ({
    id: song.id,
    title: song.title,
    pronunciation: song.pronunciation,
    normalized: normalizeSearch(`${song.title} ${song.pronunciation}`),
  }));

  cache = {
    songs,
    songById,
    difficulties,
    difficultyMap,
    titles,
    findSongByTitle(query) {
      const exact = titles.find((t) => normalizeSearch(t.title) === normalizeSearch(query));
      if (exact) return exact;
      const pronunciation = titles.find((t) => normalizeSearch(t.pronunciation) === normalizeSearch(query));
      if (pronunciation) return pronunciation;
      const match = bestTextMatch(query, titles, (item) => `${item.title} ${item.pronunciation}`);
      return match?.item || null;
    },
    findBestDifficulty(musicId, difficulty) {
      const d = difficultyMap.get(`${musicId}:${String(difficulty).toUpperCase()}`);
      if (d) return d;
      const matches = difficulties.filter((item) => item.musicId === String(musicId));
      return matches.find((item) => item.musicDifficulty === String(difficulty).toUpperCase()) || null;
    },
    findSongById(id) {
      return songById.get(String(id)) || null;
    },
  };
  return cache;
}
