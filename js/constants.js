export const DIFFICULTIES = [
  { key: 'easy', label: 'EASY', short: 'E', color: '#66DA7E', order: 1 },
  { key: 'normal', label: 'NORMAL', short: 'N', color: '#66C9F9', order: 2 },
  { key: 'hard', label: 'HARD', short: 'H', color: '#F5CC44', order: 3 },
  { key: 'expert', label: 'EXPERT', short: 'EX', color: '#EA5577', order: 4 },
  { key: 'master', label: 'MASTER', short: 'M', color: '#BB40F5', order: 5 },
  { key: 'append', label: 'APPEND', short: 'A', color: '#EE82E2', order: 6 },
];

export const BASIS_MODES = {
  ap: { key: 'ap', label: 'AP 基準', metricKey: 'apMiss', statusKey: 'apDone' },
  tournament: { key: 'tournament', label: 'AP 基準（大会基準）', metricKey: 'tournamentMiss', statusKey: 'apDone' },
  fc: { key: 'fc', label: 'FC 基準', metricKey: 'fcMiss', statusKey: 'fcDone' },
};

export const SORT_OPTIONS = {
  title: { label: '名前順' },
  level: { label: '楽曲レベル順' },
  miss: { label: 'ミス数順' },
  createdAt: { label: '追加日順' },
};

export const DEFAULT_TEMPLATE = {
  id: 'template-default-169',
  name: '標準 16:9',
  aspectRatio: 16 / 9,
  sampleDataUrl: '',
  regions: {
    title: { x: 0.08, y: 0.02, w: 0.34, h: 0.07, color: '#ff6b81' },
    level: { x: 0.28, y: 0.03, w: 0.11, h: 0.05, color: '#4da3ff' },
    difficulty: { x: 0.39, y: 0.03, w: 0.15, h: 0.05, color: '#55d58a' },
    result: { x: 0.08, y: 0.48, w: 0.31, h: 0.28, color: '#ff9b42' },
    combo: { x: 0.33, y: 0.47, w: 0.18, h: 0.12, color: '#b57cff' },
  },
};

export const DEFAULT_SETTINGS = {
  activeTemplateId: DEFAULT_TEMPLATE.id,
  basisMode: 'ap',
  viewMode: 'all',
  sortKey: 'title',
  sortDir: 'asc',
  filterStatus: '',
  filterDifficulty: '',
  filterQuery: '',
  filterLevel: '',
  apMissMin: '',
  apMissMax: '',
  tournamentMissMin: '',
  tournamentMissMax: '',
  fcMissMin: '',
  fcMissMax: '',
  onlyPlayable: false,
  showTrash: false,
  registerMode: 'auto',
};
