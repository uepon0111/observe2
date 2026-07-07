
window.PrskApp = window.PrskApp || {};

(function (App) {
  const { ROOT_FOLDER_NAME, FC_FOLDER_NAME, CLIENT_ID, API_KEY, DISCOVERY_DOC, SCOPES } = App.CONFIG;
  const state = App.state;

  function resetDriveCaches() {
    state.folderCache.clear();
    state.rootFolderId = null;
    state.fcFolderId = null;
  }

  function getRecordGroupKey(record) {
    const title = (record?.title || '').trim().toLowerCase();
    const level = String(record?.level ?? '');
    const diff = (record?.difficultyCode || record?.difficultyRaw || record?.diff || '').toString().toUpperCase();
    return `${title}__${level}__${diff}`;
  }

  function findBestMiss(records, key, excludeId = null) {
    let best = null;
    for (const rec of records || []) {
      if (excludeId && rec.id === excludeId) continue;
      if (getRecordGroupKey(rec) !== key) continue;
      const miss = Number(rec.missCount ?? rec.totalMiss ?? 999999);
      if (best === null || miss < best) best = miss;
    }
    return best;
  }

  function isBestUpdateCandidate(baseRecords, candidate, excludeId = null) {
    const key = getRecordGroupKey(candidate);
    const currentBest = findBestMiss(baseRecords, key, excludeId);
    const candidateMiss = Number(candidate.missCount ?? candidate.totalMiss ?? 999999);
    return currentBest === null || candidateMiss < currentBest;
  }

  function snapshotBestMap(records) {
    const map = new Map();
    for (const rec of records || []) {
      const key = getRecordGroupKey(rec);
      const miss = Number(rec.missCount ?? rec.totalMiss ?? 999999);
      const current = map.get(key);
      if (!current || miss < current.miss || (miss === current.miss && new Date(rec.addedAt || 0).getTime() > new Date(current.addedAt || 0).getTime())) {
        map.set(key, { miss, record: rec });
      }
    }
    return map;
  }

  function maybeNotifyBestUpdate(candidate, source = '更新') {
    if (!candidate) return;
    const title = candidate.title || '楽曲';
    const miss = Number(candidate.missCount ?? candidate.totalMiss ?? 0);
    const message = `${title} (${candidate.difficultyCode || candidate.diff || ''}) の自己ベストを更新: ${miss}`;
    App.showToast(`自己ベスト更新: ${title} / ${miss}`, 'success');
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('自己ベスト更新', { body: message }); } catch (_) {}
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) {}
    }
  }

  function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
  }

  async function initializeGapiClient() {
    await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
    state.gapiInited = true;
    maybeEnableUploadButtons();
  }

  function gisLoaded() {
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: '',
    });
    state.gisInited = true;
    maybeEnableUploadButtons();
  }

  function maybeEnableUploadButtons() {
    if (state.isLoggedIn) {
      App.show('upload_button', 'inline-flex');
    } else {
      App.hide('upload_button');
    }
  }

  function setAuthUI(isLoggedIn) {
    state.isLoggedIn = !!isLoggedIn;
    App.setText('auth-status', isLoggedIn ? 'ログイン済み' : '未ログイン');
    if (isLoggedIn) {
      App.hide('authorize_button');
      App.show('signout_button', 'inline-flex');
      App.show('upload_button', 'inline-flex');
    } else {
      App.show('authorize_button', 'inline-flex');
      App.hide('signout_button');
      App.hide('upload_button');
    }
  }

  async function handleAuthClick() {
    if (!state.tokenClient) return;
    state.tokenClient.callback = async (resp) => {
      if (resp?.error !== undefined) throw resp;
      setAuthUI(true);
      await requestNotificationPermission();
      await fetchDataFromDrive();
    };
    if (gapi.client.getToken() === null) {
      state.tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      state.tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  async function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token) google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken(null);
    setAuthUI(false);
    state.allRecords = [];
    state.filteredRecords = [];
    App.renderGrid([]);
    App.setText('result-count', 'ログインしてください');
    App.hide('loader');
    resetDriveCaches();
  }

  async function fetchAllDriveItems(query, fields) {
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
  }

  async function getFolderByName(name, parentId = null) {
    const key = `${parentId || 'ROOT'}::${name}`;
    if (state.folderCache.has(key)) return state.folderCache.get(key);
    let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
    if (parentId) query += ` and '${parentId}' in parents`;
    const response = await gapi.client.drive.files.list({ q: query, fields: 'files(id, name, parents, createdTime)', pageSize: 1 });
    const folder = response.result.files && response.result.files.length > 0 ? response.result.files[0] : null;
    state.folderCache.set(key, folder);
    return folder;
  }

  async function findOrCreateFolder(name, parentId = null) {
    const existing = await getFolderByName(name, parentId);
    if (existing) return existing;
    const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) metadata.parents = [parentId];
    const response = await gapi.client.drive.files.create({ resource: metadata, fields: 'id, name, parents, createdTime' });
    const folder = response.result;
    const key = `${parentId || 'ROOT'}::${name}`;
    state.folderCache.set(key, folder);
    return folder;
  }

  function parseFolderTitle(folderName) {
    const match = folderName.match(/^(\d+)(EASY|NORMAL|HARD|EXPERT|MASTER|APPEND|[A-Z])\s+(.+)$/i);
    if (!match) return null;
    const token = match[2].toUpperCase();
    let difficulty;
    if (token.length === 1 && token === 'E') difficulty = 'EXPERT';
    else difficulty = App.parseDifficultyToken(token)?.label || token;
    return {
      level: parseInt(match[1], 10),
      difficultyCode: difficulty,
      difficulty: difficulty,
      title: match[3],
    };
  }

  function parseScore(fileName) {
    const match = fileName.match(/^FC(?:-(\d+))?/i);
    return match ? (match[1] === undefined ? 0 : parseInt(match[1], 10)) : null;
  }

  async function fetchDataFromDrive() {
    const loader = App.q('loader');
    loader.style.display = 'flex';
    App.setText('result-count', 'データ取得中...');

    try {
      resetDriveCaches();
      const rootFolder = await getFolderByName(ROOT_FOLDER_NAME);
      if (!rootFolder) {
        state.allRecords = [];
        state.filteredRecords = [];
        App.onDataLoaded();
        return;
      }
      state.rootFolderId = rootFolder.id;

      const fcFolder = await getFolderByName(FC_FOLDER_NAME, rootFolder.id);
      if (!fcFolder) {
        state.allRecords = [];
        state.filteredRecords = [];
        App.onDataLoaded();
        return;
      }
      state.fcFolderId = fcFolder.id;

      App.setText('loader-text', '楽曲情報を取得中...');
      const folderQuery = `'${fcFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const songFolders = await fetchAllDriveItems(folderQuery, 'id, name, parents, createdTime');

      const folderMap = new Map();
      for (const folder of songFolders) {
        const metadata = parseFolderTitle(folder.name);
        if (metadata) {
          folderMap.set(folder.id, { ...metadata, folderId: folder.id, createdTime: folder.createdTime || null });
        }
      }

      if (songFolders.length === 0) {
        state.allRecords = [];
        state.filteredRecords = [];
        App.onDataLoaded();
        return;
      }

      App.setText('loader-text', 'リザルト画像を処理中...');
      const fileQuery = `name contains 'FC' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
      const candidateFiles = await fetchAllDriveItems(fileQuery, 'id, name, parents, thumbnailLink, createdTime');

      const records = [];
      for (const file of candidateFiles) {
        if (!file.parents || file.parents.length === 0) continue;
        const parentId = file.parents.find((p) => folderMap.has(p));
        if (!parentId) continue;
        const songInfo = folderMap.get(parentId);
        const missCount = parseScore(file.name);
        if (missCount === null) continue;
        const difficultyCode = songInfo.difficulty;
        records.push({
          id: file.id,
          parentId,
          title: songInfo.title,
          level: Number(songInfo.level),
          difficultyCode,
          difficulty: App.difficultyLabel(difficultyCode),
          difficultyRaw: App.difficultyLabel(difficultyCode),
          missCount,
          isFC: missCount === 0,
          thumbnail: file.thumbnailLink || null,
          addedAt: file.createdTime || null,
        });
      }

      state.allRecords = records;
      state.previousBestSnapshot = snapshotBestMap(records);
      App.onDataLoaded();
    } catch (e) {
      console.error(e);
      state.allRecords = [];
      state.filteredRecords = [];
      App.onDataLoaded();
      App.showToast('データ取得に失敗しました', 'error');
    }
  }

  function ensureDriveReady() {
    if (!state.gapiInited || !state.gisInited) return false;
    return true;
  }

  function getSongFolderNameFromItem(itemData) {
    const diffToken = App.difficultyFolderToken(itemData.diff || itemData.difficultyCode || itemData.difficulty || 'EXPERT');
    return `${itemData.level}${diffToken} ${itemData.title}`;
  }

  function getFileNameFromMiss(miss) {
    return Number(miss) === 0 ? 'FC' : `FC-${Number(miss)}`;
  }

  async function ensureRootFolders() {
    const rootFolder = state.rootFolderId ? { id: state.rootFolderId } : await findOrCreateFolder(ROOT_FOLDER_NAME);
    state.rootFolderId = rootFolder.id;
    const fcFolder = state.fcFolderId ? { id: state.fcFolderId } : await findOrCreateFolder(FC_FOLDER_NAME, rootFolder.id);
    state.fcFolderId = fcFolder.id;
    return { rootFolder, fcFolder };
  }

  async function executeUploads() {
    let successCount = 0;
    const accessToken = gapi.client.getToken()?.access_token;
    if (!accessToken) throw new Error('ログインが必要です');
    const before = state.allRecords.slice();
    await ensureRootFolders();

    for (const item of [...state.editorQueue]) {
      const sbStatus = App.q(`sb-status-${item.id}`);
      if (sbStatus) { sbStatus.innerText = '送信中'; sbStatus.className = 'upload-status processing'; }

      try {
        if (!item.data.title || !item.data.level) throw new Error('必須項目不足');
        const songFolderName = getSongFolderNameFromItem(item.data);
        const songFolder = await findOrCreateFolder(songFolderName, state.fcFolderId);
        const fileName = getFileNameFromMiss(item.data.totalMiss ?? item.data.missCount);

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

        const candidate = {
          id: `new:${item.id}`,
          title: item.data.title,
          level: Number(item.data.level),
          difficultyCode: item.data.diff,
          missCount: Number(item.data.totalMiss ?? 0),
          addedAt: new Date().toISOString(),
        };
        if (App.isBestUpdateCandidate(before, candidate)) App.maybeNotifyBestUpdate(candidate, 'upload');

        state.editorQueue = state.editorQueue.filter((q) => q.id !== item.id);
        if (item.file instanceof File && item.imgUrl) {
          try { URL.revokeObjectURL(item.imgUrl); } catch (_) {}
        }
        const node = App.q(`sb-${item.id}`);
        if (node) node.remove();
        successCount++;
      } catch (e) {
        console.error(e);
        if (sbStatus) { sbStatus.innerText = '失敗'; sbStatus.className = 'upload-status error'; }
      }
    }
    finishExecution(successCount, 'アップロード');
  }

  async function executeEdits() {
    let successCount = 0;
    const before = state.allRecords.slice();
    await ensureRootFolders();

    for (const item of [...state.editorQueue]) {
      const sbStatus = App.q(`sb-status-${item.id}`);
      if (sbStatus) { sbStatus.innerText = '保存中'; sbStatus.className = 'upload-status processing'; }

      try {
        if (!item.data.title || !item.data.level) throw new Error('必須項目不足');

        const newFolderName = getSongFolderNameFromItem(item.data);
        const newFileName = getFileNameFromMiss(item.data.totalMiss ?? item.data.missCount);
        const targetFolder = await findOrCreateFolder(newFolderName, state.fcFolderId);

        const params = { fileId: item.originalId, resource: { name: newFileName } };
        if (targetFolder.id !== item.originalParent) {
          params.addParents = targetFolder.id;
          params.removeParents = item.originalParent;
        }
        await gapi.client.drive.files.update(params);

        const candidate = {
          id: item.originalId,
          title: item.data.title,
          level: Number(item.data.level),
          difficultyCode: item.data.diff,
          missCount: Number(item.data.totalMiss ?? 0),
          addedAt: item.originalAddedAt || new Date().toISOString(),
        };
        if (App.isBestUpdateCandidate(before, candidate, item.originalId)) App.maybeNotifyBestUpdate(candidate, 'edit');

        state.editorQueue = state.editorQueue.filter((q) => q.id !== item.id);
        if (item.file instanceof File && item.imgUrl) {
          try { URL.revokeObjectURL(item.imgUrl); } catch (_) {}
        }
        const node = App.q(`sb-${item.id}`);
        if (node) node.remove();
        successCount++;
      } catch (e) {
        console.error(e);
        if (sbStatus) { sbStatus.innerText = '失敗'; sbStatus.className = 'upload-status error'; }
      }
    }
    finishExecution(successCount, '更新');
  }

  function finishExecution(count, actionName) {
    if (state.editorQueue.length === 0) {
      alert(`${actionName}完了 (${count}件)`);
      App.closeBatchModal();
      state.selectedIds.clear();
      App.updateSelectionUI();
      fetchDataFromDrive();
    } else {
      alert(`${count}件 ${actionName}成功。エラー分を確認してください。`);
      App.checkBatchButton();
    }
  }

  App.resetDriveCaches = resetDriveCaches;
  App.getRecordGroupKey = getRecordGroupKey;
  App.findBestMiss = findBestMiss;
  App.isBestUpdateCandidate = isBestUpdateCandidate;
  App.snapshotBestMap = snapshotBestMap;
  App.maybeNotifyBestUpdate = maybeNotifyBestUpdate;
  App.requestNotificationPermission = requestNotificationPermission;
  App.gapiLoaded = gapiLoaded;
  App.initializeGapiClient = initializeGapiClient;
  App.gisLoaded = gisLoaded;
  App.setAuthUI = setAuthUI;
  App.handleAuthClick = handleAuthClick;
  App.handleSignoutClick = handleSignoutClick;
  App.fetchAllDriveItems = fetchAllDriveItems;
  App.getFolderByName = getFolderByName;
  App.findOrCreateFolder = findOrCreateFolder;
  App.fetchDataFromDrive = fetchDataFromDrive;
  App.parseFolderTitle = parseFolderTitle;
  App.parseScore = parseScore;
  App.executeUploads = executeUploads;
  App.executeEdits = executeEdits;
  App.finishExecution = finishExecution;
  App.getSongFolderNameFromItem = getSongFolderNameFromItem;
  App.getFileNameFromMiss = getFileNameFromMiss;

  Object.assign(window, {
    gapiLoaded,
    initializeGapiClient,
    gisLoaded,
    setAuthUI,
    handleAuthClick,
    handleSignoutClick,
    fetchDataFromDrive,
    fetchAllDriveItems,
    getFolderByName,
    findOrCreateFolder,
    parseFolderTitle,
    parseScore,
    executeUploads,
    executeEdits,
    finishExecution,
  });
})(window.PrskApp);
