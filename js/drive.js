
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function base64ToBlob(base64, mimeType = 'application/octet-stream') {
  const binary = atob(base64.split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function driveFetch(path, token, options = {}) {
  const url = `https://www.googleapis.com/drive/v3/${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Drive API エラー: ${response.status} ${text}`);
  }
  return response;
}

export async function ensureDriveFolder(token, folderName) {
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`);
  const listRes = await driveFetch(`files?q=${q}&fields=files(id,name)`, token);
  const list = await listRes.json();
  if (Array.isArray(list.files) && list.files.length > 0) {
    return list.files[0].id;
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    throw new Error(`フォルダ作成に失敗しました: ${createRes.status} ${text}`);
  }
  const folder = await createRes.json();
  return folder.id;
}

export async function uploadFileToDrive(token, file, folderId, extraMetadata = {}) {
  const boundary = `sekai-boundary-${crypto.randomUUID()}`;
  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    parents: folderId ? [folderId] : undefined,
    appProperties: {
      ...extraMetadata,
    },
  };

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${file.type || 'application/octet-stream'}`,
    '',
    file,
    `--${boundary}--`,
  ];

  const blob = new Blob(body, { type: `multipart/related; boundary=${boundary}` });

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: blob,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Driveへのアップロードに失敗しました: ${res.status} ${text}`);
  }

  return res.json();
}

export async function trashDriveFile(token, fileId) {
  await driveFetch(`files/${encodeURIComponent(fileId)}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

export async function deleteDriveFile(token, fileId) {
  await driveFetch(`files/${encodeURIComponent(fileId)}`, token, {
    method: 'DELETE',
  });
}

export function createDriveTokenClient(clientId, callback) {
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services が読み込まれていません。');
  }
  return window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback,
  });
}

export function parseDataUrlToBlob(dataUrl) {
  const [header] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  return base64ToBlob(dataUrl, mime);
}
