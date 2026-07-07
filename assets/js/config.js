const CLIENT_ID = '966636096862-8hrrm5heb4g5r469veoels7u6ifjguuk.apps.googleusercontent.com';
const API_KEY = 'AIzaSyC-m1rkHuJTmNK2k-s89bJFshvXCS5MZZ0';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive';

const ROOT_FOLDER_NAME = 'プロセカリザルト';
const FC_FOLDER_NAME = 'FC';

const DIFFICULTY_META = {
  EASY:   { key: 'EASY',   label: 'EASY',   color: '#66DA7E', rank: 0, aliases: ['EASY', 'EAS', 'EZ'] },
  NORMAL: { key: 'NORMAL', label: 'NORMAL', color: '#66C9F9', rank: 1, aliases: ['NORMAL', 'NORM', 'N'] },
  HARD:   { key: 'HARD',   label: 'HARD',   color: '#F5CC44', rank: 2, aliases: ['HARD', 'H'] },
  EXPERT: { key: 'EXPERT', label: 'EXPERT', color: '#EA5577', rank: 3, aliases: ['EXPERT', 'EX'] },
  MASTER: { key: 'MASTER', label: 'MASTER', color: '#BB40F5', rank: 4, aliases: ['MASTER', 'M'] },
  APPEND: { key: 'APPEND', label: 'APPEND', color: '#EE82E2', rank: 5, aliases: ['APPEND', 'A'] },
};

const DIFFICULTY_ORDER = Object.keys(DIFFICULTY_META);
const DIFFICULTY_RANK = Object.fromEntries(DIFFICULTY_ORDER.map((k) => [k, DIFFICULTY_META[k].rank]));
const DIFFICULTY_LOOKUP = {};
for (const key of DIFFICULTY_ORDER) {
  for (const alias of DIFFICULTY_META[key].aliases) {
    DIFFICULTY_LOOKUP[alias] = key;
  }
}

const DEFAULT_CROP_SETTINGS = {
  diff:  { x: 20, y: 7,  w: 10, h: 4,  mode: 'threshold-diff' },
  title: { x: 19, y: 1,  w: 32, h: 5,  mode: 'standard' },
  miss:  { x: 10, y: 55, w: 20, h: 28, mode: 'standard' },
};

let tokenClient = null;
let gapiInited = false;
let gisInited = false;

let allRecords = [];
let filteredRecords = [];

let isSelectMode = false;
let selectedIds = new Set();

let dbMusics = [];
let dbDiffs = [];

let editorQueue = [];
let activeItemId = null;
let currentMode = 'upload';

let folderCache = new Map();
let mutationSnapshot = null;
let pendingBestTargets = [];

let cropSettings = JSON.parse(JSON.stringify(DEFAULT_CROP_SETTINGS));
let samplePreviewUrl = '';

let toastTimer = null;
