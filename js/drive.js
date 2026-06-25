import { sanitizeFilename } from './utils.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((s) => s.src === src);
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export class DriveClient {
  constructor() {
    this.token = null;
    this.clientId = '';
    this.apiKey = '';
    this.folderId = '';
    this.tokenClient = null;
  }

  configure({ clientId, apiKey, folderId }) {
    this.clientId = clientId?.trim() || '';
    this.apiKey = apiKey?.trim() || '';
    this.folderId = folderId?.trim() || '';
  }

  async init() {
    await loadScript(GIS_SRC);
    if (!window.google?.accounts?.oauth2) throw new Error('Google Identity Services を初期化できませんでした');
    if (!this.clientId) throw new Error('クライアントIDが未設定です');
    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (resp) => {
        if (resp.error) {
          this._reject?.(new Error(resp.error));
          this._reject = null;
          return;
        }
        this.token = resp.access_token;
        this._resolve?.(resp.access_token);
        this._resolve = null;
        this._reject = null;
      },
    });
  }

  isConnected() {
    return Boolean(this.token);
  }

  async connect() {
    if (!this.tokenClient) await this.init();
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this.tokenClient.requestAccessToken({ prompt: this.token ? '' : 'consent' });
    });
  }

  disconnect() {
    this.token = null;
  }

  async request(path, options = {}) {
    if (!this.token) throw new Error('Drive に接続されていません');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.token}`);
    const res = await fetch(`https://www.googleapis.com${path}`, { ...options, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Drive API error: ${res.status}`);
    }
    return res;
  }

  async uploadImage({ blob, title, folderId, mimeType = blob.type || 'image/png' }) {
    if (!this.token) throw new Error('Drive に接続されていません');
    const metadata = {
      name: sanitizeFilename(title || 'result-image'),
      mimeType,
    };
    const parents = (folderId || this.folderId) ? [folderId || this.folderId] : undefined;
    if (parents?.length) metadata.parents = parents;

    const boundary = `-------oai${Math.random().toString(16).slice(2)}`;
    const metaPart = JSON.stringify(metadata);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ], { type: `multipart/related; boundary=${boundary}` });

    const res = await this.request('/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
    });
    return await res.json();
  }

  async deleteFile(fileId) {
    if (!this.token) throw new Error('Drive に接続されていません');
    await this.request(`/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    return true;
  }
}
