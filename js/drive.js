import { CLIENT_ID, API_KEY, DISCOVERY_DOC, DRIVE_SCOPES, ROOT_FOLDER_NAME } from './config.js';
import { nowISO } from './utils.js';

let tokenClient = null;
let ready = false;

function waitForGlobal(name, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (window[name]) {
        clearInterval(timer);
        resolve(window[name]);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`${name} の読み込みに失敗しました`));
      }
    }, 50);
  });
}

export async function initDriveClient() {
  if (ready) return true;
  const gapi = await waitForGlobal('gapi');
  const google = await waitForGlobal('google');
  await new Promise((resolve) => gapi.load('client', resolve));
  await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: DRIVE_SCOPES,
    callback: () => {},
  });
  ready = true;
  return true;
}

export function isDriveSignedIn() {
  try {
    return Boolean(window.gapi?.client?.getToken?.());
  } catch {
    return false;
  }
}

export async function signInDrive() {
  await initDriveClient();
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp?.error) {
        reject(resp);
        return;
      }
      resolve(resp);
    };
    const prompt = isDriveSignedIn() ? '' : 'consent';
    tokenClient.requestAccessToken({ prompt });
  });
}

export async function signOutDrive() {
  const token = window.gapi?.client?.getToken?.();
  if (!token?.access_token) return;
  await window.google.accounts.oauth2.revoke(token.access_token);
  window.gapi.client.setToken('');
}

async function ensureFolder(name, parentId = null) {
  const gapi = window.gapi;
  let q = `mimeType = 'application/vnd.google-apps.folder' and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const res = await gapi.client.drive.files.list({ q, fields: 'files(id, name)', pageSize: 1 });
  if (res.result.files?.length) return res.result.files[0];
  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const createRes = await gapi.client.drive.files.create({ resource: meta, fields: 'id, name' });
  return createRes.result;
}

export async function ensureRootFolder() {
  await initDriveClient();
  return ensureFolder(ROOT_FOLDER_NAME);
}

async function listAllFiles(query, fields) {
  const gapi = window.gapi;
  let items = [];
  let pageToken = null;
  do {
    const res = await gapi.client.drive.files.list({
      q: query,
      fields: `nextPageToken, files(${fields})`,
      pageSize: 1000,
      pageToken,
    });
    items = items.concat(res.result.files || []);
    pageToken = res.result.nextPageToken || null;
  } while (pageToken);
  return items;
}

export async function listDriveRecords() {
  const root = await ensureRootFolder();
  const files = await listAllFiles(`'${root.id}' in parents and mimeType != 'application/vnd.google-apps.folder'`, 'id, name, appProperties, createdTime, modifiedTime, trashed, webViewLink, thumbnailLink, parents');
  return files.map((file) => ({
    id: file.appProperties?.recordId || file.id,
    driveFileId: file.id,
    driveFolderId: root.id,
    driveName: file.name,
    driveTrashed: Boolean(file.trashed),
    driveCreatedTime: file.createdTime,
    driveModifiedTime: file.modifiedTime,
    driveViewLink: file.webViewLink || '',
    driveThumbLink: file.thumbnailLink || '',
    driveAppProperties: file.appProperties || {},
  }));
}

export function buildDriveMetadata(record) {
  return {
    name: record.driveName || `${record.title || 'record'}.png`,
    mimeType: record.imageType || 'image/png',
    appProperties: {
      recordId: String(record.id),
      title: String(record.title ?? ''),
      pronunciation: String(record.pronunciation ?? ''),
      level: String(record.level ?? ''),
      difficulty: String(record.difficulty ?? ''),
      musicId: String(record.musicId ?? ''),
      createdAt: String(record.createdAt ?? ''),
      updatedAt: String(record.updatedAt ?? ''),
    },
  };
}

export async function uploadRecordToDrive(record) {
  const gapi = window.gapi;
  const root = await ensureRootFolder();
  const metadata = buildDriveMetadata(record);
  metadata.parents = [root.id];
  const blob = record.imageBlob instanceof Blob ? record.imageBlob : null;
  if (!blob) throw new Error('画像データがありません');
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob, metadata.name);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id, name, appProperties, webViewLink, thumbnailLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
  const data = await res.json();
  return data;
}

export async function updateDriveRecord(fileId, record, options = {}) {
  const gapi = window.gapi;
  const metadata = buildDriveMetadata(record);
  const fields = 'id, name, appProperties, webViewLink, thumbnailLink';
  if (options.replaceBlob && record.imageBlob instanceof Blob) {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', record.imageBlob, metadata.name);
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=${fields}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
    return res.json();
  }
  const params = { fileId, resource: { name: metadata.name, appProperties: metadata.appProperties } };
  const res = await gapi.client.drive.files.update(params);
  return res.result;
}

export async function trashDriveRecord(fileId) {
  const gapi = window.gapi;
  const res = await gapi.client.drive.files.update({ fileId, resource: { trashed: true } });
  return res.result;
}

export async function restoreDriveRecord(fileId) {
  const gapi = window.gapi;
  const res = await gapi.client.drive.files.update({ fileId, resource: { trashed: false } });
  return res.result;
}

export async function deleteDriveRecord(fileId) {
  const gapi = window.gapi;
  await gapi.client.drive.files.delete({ fileId });
}

export async function getDriveFileBlob(fileId) {
  const token = window.gapi?.client?.getToken?.()?.access_token;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive file download failed: ${res.status}`);
  return await res.blob();
}

export async function purgeOldTrashedRemoteFiles(files, olderThanMs) {
  const now = Date.now();
  const expired = files.filter((file) => file.deletedAt && now - new Date(file.deletedAt).getTime() >= olderThanMs);
  for (const file of expired) {
    if (file.driveFileId) {
      await deleteDriveRecord(file.driveFileId);
    }
  }
  return expired;
}

export async function getRootFolderId() {
  const folder = await ensureRootFolder();
  return folder.id;
}

export function driveConnectedLabel() {
  return isDriveSignedIn() ? 'Drive 接続済み' : 'Drive 未接続';
}
