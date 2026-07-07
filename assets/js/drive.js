function gapiLoaded() {
  gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
  await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
  gapiInited = true;
  maybeEnableAuth();
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: '',
  });
  gisInited = true;
  maybeEnableAuth();
}

function maybeEnableAuth() {
  const btn = document.getElementById('authorize_button');
  if (btn) btn.disabled = !(gapiInited && gisInited);
}

function handleAuthClick() {
  tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) throw resp;
    setAuthUI(true);
    await fetchDataFromDrive();
  };
  if (gapi.client.getToken() === null) tokenClient.requestAccessToken({ prompt: 'consent' });
  else tokenClient.requestAccessToken({ prompt: '' });
}

function handleSignoutClick() {
  const token = gapi.client.getToken();
  if (token !== null) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken('');
    setAuthUI(false);
    document.getElementById('result-count').innerText = 'ログアウトしました';
    document.getElementById('grid').innerHTML = '';
    allRecords = [];
    filteredRecords = [];
    selectedIds.clear();
    updateSelectionUI();
    clearFolderCache();
  }
}

function setAuthUI(isLoggedIn) {
  const signoutButton = document.getElementById('signout_button');
  const uploadButton = document.getElementById('upload_button');
  const authorizeButton = document.getElementById('authorize_button');
  if (signoutButton) signoutButton.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (uploadButton) uploadButton.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (authorizeButton) authorizeButton.style.display = isLoggedIn ? 'none' : 'inline-flex';
  const authStatus = document.getElementById('auth-status');
  if (authStatus) authStatus.innerText = isLoggedIn ? 'ログイン済み' : '未ログイン';
}

function clearFolderCache() {
  folderCache = new Map();
}

function canonicalDifficulty(value) {
  if (!value) return null;
  const upper = String(value).trim().toUpperCase();
  return DIFFICULTY_LOOKUP[upper] || null;
}

function difficultyLabel(value) {
  const key = canonicalDifficulty(value);
  return key ? DIFFICULTY_META[key].label : String(value || '');
}

function difficultyColor(value) {
  const key = canonicalDifficulty(value);
  return key ? DIFFICULTY_META[key].color : '#999';
}

function parseFolderTitle(folderName) {
  if (!folderName) return null;

  // New format: "10 EASY Title"
  let match = folderName.match(/^(\d+)\s+([A-Z]+)\s+(.+)$/);
  if (match) {
    const diff = canonicalDifficulty(match[2]);
    if (diff) {
      return {
        level: parseInt(match[1], 10),
        difficultyKey: diff,
        title: match[3],
      };
    }
  }

  // Legacy format: "10A Title"
  match = folderName.match(/^(\d+)([A-Z])\s+(.+)$/);
  if (match) {
    const diff = canonicalDifficulty(match[2]);
    if (diff) {
      return {
        level: parseInt(match[1], 10),
        difficultyKey: diff,
        title: match[3],
      };
    }
  }

  return null;
}

function parseScore(fileName) {
  const match = String(fileName || '').match(/^FC(?:-(\d+))?/);
  return match ? (match[1] === undefined ? 0 : parseInt(match[1], 10)) : null;
}

function buildRecordKey(title, level, diff) {
  return `${String(title || '').trim()}||${String(level || '').trim()}||${canonicalDifficulty(diff) || String(diff || '').trim().toUpperCase()}`;
}

function buildBestMap(records) {
  const map = new Map();
  for (const rec of records || []) {
    const key = buildRecordKey(rec.title, rec.level, rec.difficultyKey || rec.difficultyRaw || rec.diff);
    const miss = Number(rec.missCount);
    if (!map.has(key) || miss < map.get(key)) {
      map.set(key, miss);
    }
  }
  return map;
}

function fetchAllDriveItems(query, fields) {
  return (async () => {
    let items = [];
    let pageToken = null;
    do {
      const response = await gapi.client.drive.files.list({
        q: query,
        fields: `nextPageToken, files(${fields})`,
        pageSize: 1000,
        pageToken,
      });
      if (response.result.files) items = items.concat(response.result.files);
      pageToken = response.result.nextPageToken;
    } while (pageToken);
    return items;
  })();
}

async function getFolderByName(name, parentId = null) {
  const key = `${parentId || 'root'}::${name}`;
  if (folderCache.has(key)) return folderCache.get(key);

  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const response = await gapi.client.drive.files.list({ q: query, fields: 'files(id, name)', pageSize: 1 });
  const folder = (response.result.files && response.result.files.length > 0) ? response.result.files[0] : null;
  folderCache.set(key, folder);
  return folder;
}

async function findOrCreateFolder(name, parentId = null) {
  const key = `${parentId || 'root'}::${name}`;
  if (folderCache.has(key) && folderCache.get(key)) return folderCache.get(key);

  const existing = await getFolderByName(name, parentId);
  if (existing) return existing;

  const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) metadata.parents = [parentId];
  const response = await gapi.client.drive.files.create({ resource: metadata, fields: 'id, name' });
  folderCache.set(key, response.result);
  return response.result;
}

async function ensureRootFolders() {
  const rootFolder = await findOrCreateFolder(ROOT_FOLDER_NAME);
  const fcFolder = await findOrCreateFolder(FC_FOLDER_NAME, rootFolder.id);
  return { rootFolder, fcFolder };
}

async function fetchDataFromDrive() {
  const loader = document.getElementById('loader');
  const loaderText = document.getElementById('loader-text');
  loader.style.display = 'flex';
  document.getElementById('result-count').innerText = 'データ取得中...';

  try {
    const { rootFolder, fcFolder } = await ensureRootFolders();
    if (!rootFolder || !fcFolder) {
      allRecords = [];
      onDataLoaded();
      return;
    }

    loaderText.innerText = '楽曲情報を取得中...';
    const folderQuery = `'${fcFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const songFolders = await fetchAllDriveItems(folderQuery, 'id, name, createdTime');

    const folderMap = new Map();
    for (const folder of songFolders) {
      const meta = parseFolderTitle(folder.name);
      if (meta) folderMap.set(folder.id, { ...meta, folderId: folder.id, createdTime: folder.createdTime || null });
    }

    if (songFolders.length === 0) {
      allRecords = [];
      onDataLoaded();
      return;
    }

    loaderText.innerText = 'リザルト画像を処理中...';
    const fileQuery = `name contains 'FC' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
    const candidateFiles = await fetchAllDriveItems(fileQuery, 'id, name, parents, thumbnailLink, createdTime, modifiedTime');

    const records = [];
    for (const file of candidateFiles) {
      if (!file.parents || file.parents.length === 0) continue;
      const parentId = file.parents.find((pid) => folderMap.has(pid));
      if (!parentId) continue;

      const songInfo = folderMap.get(parentId);
      const missCount = parseScore(file.name);
      if (missCount === null) continue;

      records.push({
        id: file.id,
        parentId,
        title: songInfo.title,
        level: songInfo.level,
        difficultyKey: songInfo.difficultyKey,
        difficultyLabel: DIFFICULTY_META[songInfo.difficultyKey]?.label || songInfo.difficultyKey,
        difficultyRaw: songInfo.difficultyKey,
        difficultyColor: DIFFICULTY_META[songInfo.difficultyKey]?.color || '#999',
        missCount,
        isFC: missCount === 0,
        thumbnail: file.thumbnailLink || null,
        createdTime: file.createdTime || null,
        modifiedTime: file.modifiedTime || null,
      });
    }

    allRecords = records;
    onDataLoaded();
  } catch (error) {
    console.error(error);
    loader.style.display = 'none';
    showToast('Driveデータの取得に失敗しました', 'error');
  }
}

async function beginMutationSession() {
  mutationSnapshot = buildBestMap(allRecords);
  pendingBestTargets = [];
}

async function executeUploads() {
  let successCount = 0;
  const accessToken = gapi.client.getToken().access_token;
  const { fcFolder } = await ensureRootFolders();

  await beginMutationSession();

  for (const item of [...editorQueue]) {
    const statusEl = document.getElementById(`sb-status-${item.id}`);
    if (statusEl) {
      statusEl.innerText = '送信中';
      statusEl.className = 'upload-status processing';
    }

    try {
      if (!item.data.title || !item.data.level || !item.data.diff) throw new Error('必須項目不足');

      const folderName = `${item.data.level} ${item.data.diff} ${item.data.title}`;
      const songFolder = await findOrCreateFolder(folderName, fcFolder.id);
      const fileName = (Number(item.data.totalMiss) === 0) ? 'FC' : `FC-${Number(item.data.totalMiss)}`;

      const meta = { name: fileName, parents: [songFolder.id] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      form.append('file', item.file);

      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: new Headers({ Authorization: 'Bearer ' + accessToken }),
        body: form,
      });
      if (!res.ok) throw new Error(res.statusText);

      pendingBestTargets.push({
        title: item.data.title,
        level: item.data.level,
        diff: item.data.diff,
        missCount: Number(item.data.totalMiss),
      });

      editorQueue = editorQueue.filter((q) => q.id !== item.id);
      const node = document.getElementById(`sb-${item.id}`);
      if (node) node.remove();
      successCount++;
    } catch (error) {
      console.error(error);
      if (statusEl) {
        statusEl.innerText = '失敗';
        statusEl.className = 'upload-status error';
      }
    }
  }

  await finishExecution(successCount, 'アップロード');
}

async function executeEdits() {
  let successCount = 0;
  const { fcFolder } = await ensureRootFolders();

  await beginMutationSession();

  for (const item of [...editorQueue]) {
    const statusEl = document.getElementById(`sb-status-${item.id}`);
    if (statusEl) {
      statusEl.innerText = '保存中';
      statusEl.className = 'upload-status processing';
    }

    try {
      if (!item.data.title || !item.data.level || !item.data.diff) throw new Error('必須項目不足');

      const newFolderName = `${item.data.level} ${item.data.diff} ${item.data.title}`;
      const newFileName = (Number(item.data.totalMiss) === 0) ? 'FC' : `FC-${Number(item.data.totalMiss)}`;
      const targetFolder = await findOrCreateFolder(newFolderName, fcFolder.id);

      const params = { fileId: item.originalId, resource: { name: newFileName } };
      if (targetFolder.id !== item.originalParent) {
        params.addParents = targetFolder.id;
        params.removeParents = item.originalParent;
      }
      await gapi.client.drive.files.update(params);

      pendingBestTargets.push({
        title: item.data.title,
        level: item.data.level,
        diff: item.data.diff,
        missCount: Number(item.data.totalMiss),
      });

      editorQueue = editorQueue.filter((q) => q.id !== item.id);
      const node = document.getElementById(`sb-${item.id}`);
      if (node) node.remove();
      successCount++;
    } catch (error) {
      console.error(error);
      if (statusEl) {
        statusEl.innerText = '失敗';
        statusEl.className = 'upload-status error';
      }
    }
  }

  await finishExecution(successCount, '更新');
}

async function finishExecution(count, actionName) {
  if (editorQueue.length === 0) {
    alert(`${actionName}完了 (${count}件)`);
    closeBatchModal();
    selectedIds.clear();
    updateSelectionUI();
    await fetchDataFromDrive();
    if (pendingBestTargets.length > 0) {
      notifyBestUpdates(pendingBestTargets, mutationSnapshot);
    }
  } else {
    alert(`${count}件 ${actionName}成功。エラー分を確認してください。`);
    checkBatchButton();
    if (pendingBestTargets.length > 0) {
      notifyBestUpdates(pendingBestTargets, mutationSnapshot);
    }
  }
  pendingBestTargets = [];
  mutationSnapshot = null;
}

function handleBatchExecution() {
  const btn = document.getElementById('btn-exec-batch');
  btn.disabled = true;
  btn.innerText = '処理中...';

  Promise.resolve()
    .then(() => {
      if (currentMode === 'upload') return executeUploads();
      return executeEdits();
    })
    .catch((error) => {
      console.error(error);
      alert('処理中にエラーが発生しました: ' + error.message);
    })
    .finally(() => {
      checkBatchButton();
    });
}

async function individualDelete(id) {
  if (!confirm('このリザルトを削除しますか？')) return;
  const loader = document.getElementById('loader');
  loader.style.display = 'flex';
  document.getElementById('grid').innerHTML = '';
  try {
    await gapi.client.drive.files.delete({ fileId: id });
    alert('削除しました');
    await fetchDataFromDrive();
  } catch (error) {
    alert('エラー: ' + error.message);
    fetchDataFromDrive();
  }
}

async function batchDelete() {
  if (!confirm(`選択した ${selectedIds.size} 件を削除しますか？`)) return;
  const loader = document.getElementById('loader');
  loader.style.display = 'flex';
  document.getElementById('grid').innerHTML = '';
  try {
    for (const id of selectedIds) {
      await gapi.client.drive.files.delete({ fileId: id });
    }
    alert('削除しました');
    selectedIds.clear();
    updateSelectionUI();
    await fetchDataFromDrive();
  } catch (error) {
    alert('削除エラー: ' + error.message);
    fetchDataFromDrive();
  }
}
