
const { showToast, recordKey, bestKeyFromRecord, recordDisplayDiff, makeFileName, makeFileDescription, getBestMissForKey } = window.PRSK_UTILS;

function gapiLoaded() {
  gapi.load('client', initializeGapiClient);
}
async function initializeGapiClient() {
  await gapi.client.init({
    apiKey: PRSK.CONFIG.API_KEY,
    discoveryDocs: [PRSK.CONFIG.DISCOVERY_DOC]
  });
  PRSK.state.gapiInited = true;
  maybeEnableAuth();
}
function gisLoaded() {
  PRSK.state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: PRSK.CONFIG.CLIENT_ID,
    scope: PRSK.CONFIG.SCOPES,
    callback: ''
  });
  PRSK.state.gisInited = true;
  maybeEnableAuth();
}
function maybeEnableAuth() {
  const btn = document.getElementById('authorize_button');
  if (!btn) return;
  btn.disabled = !(PRSK.state.gapiInited && PRSK.state.gisInited);
}

function handleAuthClick() {
  if (!PRSK.state.tokenClient) {
    showToast('認証準備中', 'Googleログインの初期化中です', 'warn', 2500);
    return;
  }
  PRSK.state.tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) {
      console.error(resp);
      return;
    }
    setAuthUI(true);
    await fetchDataFromDrive();
  };
  if (gapi.client.getToken() === null) {
    PRSK.state.tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    PRSK.state.tokenClient.requestAccessToken({ prompt: '' });
  }
}
function handleSignoutClick() {
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken('');
  }
  setAuthUI(false);
}

function setAuthUI(isAuthed) {
  document.getElementById('auth-status').innerText = isAuthed ? 'ログイン中' : '未ログイン';
  document.getElementById('authorize_button').style.display = isAuthed ? 'none' : 'inline-flex';
  document.getElementById('signout_button').style.display = isAuthed ? 'inline-flex' : 'none';
  document.getElementById('upload_button').style.display = isAuthed ? 'inline-flex' : 'none';
  if (!isAuthed) {
    document.getElementById('result-count').innerText = 'ログインしてください';
    document.getElementById('grid').innerHTML = '';
    PRSK.state.allRecords = [];
    updateSelectionUI();
  }
}

async function getFolderByName(name, parentId = null) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const resp = await gapi.client.drive.files.list({ q: query, fields: 'files(id, name, parents)', pageSize: 10 });
  return resp.result.files && resp.result.files.length ? resp.result.files[0] : null;
}
async function findOrCreateFolder(name, parentId = null) {
  const existing = await getFolderByName(name, parentId);
  if (existing) return existing;
  const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) metadata.parents = [parentId];
  const response = await gapi.client.drive.files.create({ resource: metadata, fields: 'id, name, parents' });
  return response.result;
}
async function ensureDriveFolders() {
  const root = PRSK.state.driveRootFolder || await findOrCreateFolder(PRSK.CONFIG.ROOT_FOLDER_NAME);
  PRSK.state.driveRootFolder = root;
  const data = PRSK.state.driveDataFolder || await findOrCreateFolder(PRSK.CONFIG.DATA_FOLDER_NAME, root.id);
  PRSK.state.driveDataFolder = data;
  return { root, data };
}
async function fetchAllDriveItems(query, fields) {
  let items = [];
  let pageToken = null;
  do {
    const response = await gapi.client.drive.files.list({
      q: query,
      fields: `nextPageToken, files(${fields})`,
      pageSize: 1000,
      pageToken
    });
    if (response.result.files) items = items.concat(response.result.files);
    pageToken = response.result.nextPageToken;
  } while (pageToken);
  return items;
}
function parseRecordFromDriveFile(file) {
  let meta = {};
  try {
    meta = file.description ? JSON.parse(file.description) : {};
  } catch (e) {
    meta = {};
  }
  const title = meta.title || file.name || '';
  const level = meta.level ?? '';
  const diff = meta.diff || 'master';
  const missCount = meta.totalMiss ?? parseScoreFromName(file.name);
  return {
    id: file.id,
    title,
    level,
    difficultyRaw: diff,
    difficulty: recordDisplayDiff(diff),
    missCount: Number.isFinite(missCount) ? Number(missCount) : 0,
    isFC: Number(missCount) === 0,
    thumbnail: file.thumbnailLink || null,
    description: file.description || '',
    musicId: meta.musicId || null,
    good: meta.good ?? 0,
    bad: meta.bad ?? 0,
    missDetail: meta.missDetail ?? 0
  };
}
function parseScoreFromName(fileName) {
  const match = String(fileName || '').match(/FC(?:-(\d+))?/i);
  return match ? (match[1] === undefined ? 0 : parseInt(match[1], 10)) : 0;
}
async function fetchDataFromDrive() {
  const loader = document.getElementById('loader');
  loader.style.display = 'flex';
  document.getElementById('loader-text').innerText = '保存済みリザルトを取得中...';
  document.getElementById('result-count').innerText = 'データ取得中...';
  try {
    const { data } = await ensureDriveFolders();
    const query = `'${data.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    const files = await fetchAllDriveItems(query, 'id, name, description, thumbnailLink, parents, createdTime, modifiedTime');
    PRSK.state.allRecords = files.map(parseRecordFromDriveFile);
    updateView();
    showToast('読み込み完了', `${PRSK.state.allRecords.length}件`, 'success', 2400);
  } catch (e) {
    console.error(e);
    showToast('読み込み失敗', e.message || 'Driveの取得に失敗しました', 'error', 4000);
    document.getElementById('result-count').innerText = '取得失敗';
  } finally {
    loader.style.display = 'none';
  }
}

async function uploadResultFile(item) {
  const accessToken = gapi.client.getToken().access_token;
  const { data } = await ensureDriveFolders();
  const meta = {
    name: makeFileName(item.data),
    parents: [data.id],
    description: makeFileDescription(item.data)
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', item.file);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: new Headers({ Authorization: 'Bearer ' + accessToken }),
    body: form
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}
async function updateResultFile(item, driveRecord) {
  const payload = {
    name: makeFileName(item.data),
    description: makeFileDescription(item.data)
  };
  const params = { fileId: item.originalId, resource: payload };
  await gapi.client.drive.files.update(params);
}
async function deleteResultFile(id) {
  await gapi.client.drive.files.delete({ fileId: id });
}

window.gapiLoaded = gapiLoaded;
window.gisLoaded = gisLoaded;
window.handleAuthClick = handleAuthClick;
window.handleSignoutClick = handleSignoutClick;
window.setAuthUI = setAuthUI;
window.getFolderByName = getFolderByName;
window.findOrCreateFolder = findOrCreateFolder;
window.fetchAllDriveItems = fetchAllDriveItems;
window.fetchDataFromDrive = fetchDataFromDrive;
window.uploadResultFile = uploadResultFile;
window.updateResultFile = updateResultFile;
window.deleteResultFile = deleteResultFile;
window.ensureDriveFolders = ensureDriveFolders;
window.parseScoreFromName = parseScoreFromName;
