
window.PrskApp = window.PrskApp || {};

(function (App) {
  const DIFFICULTIES = [
    { code: 'EASY', label: 'EASY', order: 0, color: '#66DA7E', legacyCodes: [], folderToken: 'EASY' },
    { code: 'NORMAL', label: 'NORMAL', order: 1, color: '#66C9F9', legacyCodes: [], folderToken: 'NORMAL' },
    { code: 'HARD', label: 'HARD', order: 2, color: '#F5CC44', legacyCodes: ['H'], folderToken: 'HARD' },
    { code: 'EXPERT', label: 'EXPERT', order: 3, color: '#EA5577', legacyCodes: ['X', 'E'], folderToken: 'EXPERT' },
    { code: 'MASTER', label: 'MASTER', order: 4, color: '#BB40F5', legacyCodes: ['M'], folderToken: 'MASTER' },
    { code: 'APPEND', label: 'APPEND', order: 5, color: '#EE82E2', legacyCodes: ['A'], folderToken: 'APPEND' },
  ];

  const DIFFICULTY_BY_CODE = new Map(DIFFICULTIES.map((d) => [d.code, d]));
  const DIFFICULTY_BY_LEGACY = new Map();
  for (const d of DIFFICULTIES) {
    for (const legacy of d.legacyCodes || []) {
      if (!DIFFICULTY_BY_LEGACY.has(legacy)) DIFFICULTY_BY_LEGACY.set(legacy, d);
    }
  }
  const DIFFICULTY_SORT_ORDER = DIFFICULTIES.map((d) => d.code);

  const DEFAULT_CROP_REGIONS = {
    diff: { x: 0.20, y: 0.07, w: 0.10, h: 0.04, type: 'threshold-diff' },
    title: { x: 0.19, y: 0.01, w: 0.32, h: 0.05, type: 'filter-standard' },
    miss: { x: 0.10, y: 0.55, w: 0.20, h: 0.28, type: 'filter-standard' },
  };

  const DEFAULT_SETTINGS = {
    showBestOnly: false,
    sortMode: 'level',
    sortDirection: 'desc',
    cropRegions: JSON.parse(JSON.stringify(DEFAULT_CROP_REGIONS)),
  };

  const STORAGE_KEYS = {
    settings: 'prsk-result-viewer.settings.v2',
    ui: 'prsk-result-viewer.ui.v2',
  };

  const ROOT_FOLDER_NAME = 'プロセカリザルト';
  const FC_FOLDER_NAME = 'FC';

  const CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
  const API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0';
  const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
  const SCOPES = 'https://www.googleapis.com/auth/drive';

  function normalizeText(input) {
    return (input || '')
      .toString()
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  function getDifficulty(codeOrLabel) {
    if (!codeOrLabel) return null;
    const raw = codeOrLabel.toString().trim().toUpperCase();
    if (DIFFICULTY_BY_CODE.has(raw)) return DIFFICULTY_BY_CODE.get(raw);
    if (DIFFICULTY_BY_LEGACY.has(raw)) return DIFFICULTY_BY_LEGACY.get(raw);
    return DIFFICULTIES.find((d) => d.label === raw) || null;
  }

  function difficultyLabel(codeOrLabel) {
    const d = getDifficulty(codeOrLabel);
    return d ? d.label : (codeOrLabel || '');
  }

  function difficultyColor(codeOrLabel) {
    const d = getDifficulty(codeOrLabel);
    return d ? d.color : '#999999';
  }

  function difficultyOrder(codeOrLabel) {
    const d = getDifficulty(codeOrLabel);
    return d ? d.order : 999;
  }

  function difficultyFolderToken(codeOrLabel) {
    const d = getDifficulty(codeOrLabel);
    return d ? d.folderToken : (codeOrLabel || '').toString().toUpperCase();
  }

  function parseDifficultyToken(token) {
    if (!token) return null;
    const upper = token.toString().trim().toUpperCase();
    const full = DIFFICULTIES.find((d) => d.label === upper);
    if (full) return full;
    if (upper === 'E' || upper === 'X') return DIFFICULTY_BY_LEGACY.get(upper);
    return DIFFICULTY_BY_LEGACY.get(upper) || null;
  }

  function diffSortRank(difficultyCode) {
    const diff = getDifficulty(difficultyCode);
    return diff ? diff.order : 999;
  }

  function compareStringsJa(a, b) {
    return (a || '').localeCompare((b || ''), 'ja');
  }

  App.CONFIG = {
    DIFFICULTIES,
    DIFFICULTY_BY_CODE,
    DIFFICULTY_BY_LEGACY,
    DIFFICULTY_SORT_ORDER,
    DEFAULT_CROP_REGIONS,
    DEFAULT_SETTINGS,
    STORAGE_KEYS,
    ROOT_FOLDER_NAME,
    FC_FOLDER_NAME,
    CLIENT_ID,
    API_KEY,
    DISCOVERY_DOC,
    SCOPES,
  };

  App.normalizeText = normalizeText;
  App.getDifficulty = getDifficulty;
  App.difficultyLabel = difficultyLabel;
  App.difficultyColor = difficultyColor;
  App.difficultyOrder = difficultyOrder;
  App.difficultyFolderToken = difficultyFolderToken;
  App.parseDifficultyToken = parseDifficultyToken;
  App.diffSortRank = diffSortRank;
  App.compareStringsJa = compareStringsJa;
})(window.PrskApp);
