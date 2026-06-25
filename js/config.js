
export const APP_CONFIG = {
  name: 'プロセカ リザルト整理帳',
  version: '1.0.0',
  trashDays: 3,
  ocrLanguages: 'jpn+eng',
  musicCatalogUrl: 'https://sekai-world.github.io/sekai-master-db-diff/musics.json',
  difficultyCatalogUrl: 'https://sekai-world.github.io/sekai-master-db-diff/musicDifficulties.json',
  defaultDriveFolderName: 'プロセカ リザルト整理帳',
  storageKey: 'sekai-result-archive-settings-v1',
};

export const DIFFICULTIES = [
  'EASY',
  'NORMAL',
  'HARD',
  'EXPERT',
  'MASTER',
  'APPEND',
];

export const DIFFICULTY_ORDER = Object.fromEntries(DIFFICULTIES.map((d, i) => [d, i]));

export const DIFFICULTY_COLORS = {
  EASY: '#66DA7E',
  NORMAL: '#66C9F9',
  HARD: '#F5CC44',
  EXPERT: '#EA5577',
  MASTER: '#BB40F5',
  APPEND: '#EE82E2',
};

export const MISS_MODES = [
  { key: 'ap', label: 'AP基準', short: 'AP', description: 'GREAT・GOOD・BAD・MISS の合計' },
  { key: 'apTournament', label: 'AP基準(大会基準)', short: '大会', description: 'GREAT-1・GOOD-2・BAD-3・MISS-3 の合計' },
  { key: 'fc', label: 'FC基準', short: 'FC', description: 'GOOD・BAD・MISS の合計' },
];

export const SORT_OPTIONS = [
  { key: 'name', label: '楽曲名順' },
  { key: 'level', label: '楽曲レベル順' },
  { key: 'miss', label: 'ミス数順' },
  { key: 'date', label: '追加日順' },
];

export const DEFAULT_STATE = {
  sortKey: 'date',
  sortDirection: 'desc',
  missMode: 'ap',
  showBestOnly: false,
  apFilter: false,
  fcFilter: false,
  difficultyFilters: new Set(DIFFICULTIES),
  titleQuery: '',
  levelQuery: '',
  missMin: '',
  missMax: '',
  view: 'all',
};

export const OCR_BOXES = {
  title: { x: 0.09, y: 0.02, w: 0.24, h: 0.09, color: '#ff4b4b', label: 'タイトル' },
  level: { x: 0.19, y: 0.06, w: 0.22, h: 0.06, color: '#4b7bff', label: '楽曲レベル' },
  difficulty: { x: 0.19, y: 0.04, w: 0.18, h: 0.09, color: '#21c45a', label: '楽曲難易度' },
  result: { x: 0.08, y: 0.34, w: 0.42, h: 0.24, color: '#ff9a2f', label: 'リザルト' },
  combo: { x: 0.36, y: 0.38, w: 0.17, h: 0.10, color: '#a855f7', label: 'コンボ' },
};

export const KEYWORDS = {
  difficultyRegex: /(EASY|NORMAL|HARD|EXPERT|MASTER|APPEND)/i,
};
