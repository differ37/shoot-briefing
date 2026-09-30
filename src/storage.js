// 두 가지 저장소: GitHub 비공개 저장소(기기 간 동기화) / 이 브라우저(IndexedDB)
// 둘 다 같은 경로 기반 인터페이스를 제공한다.

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class GitHubStore {
  constructor({ token, owner, repo, branch = 'main' }) {
    Object.assign(this, { token, owner, repo, branch });
    this.shas = new Map();
    this.kind = 'github';
  }

  url(path) {
    const p = path.split('/').map(encodeURIComponent).join('/');
    return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${p}`;
  }

  async req(path, { method = 'GET', accept = 'application/vnd.github+json', body, query = '' } = {}) {
    const res = await fetch(this.url(path) + query, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const err = new Error(`GitHub ${res.status}: ${t.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async check() {
    const res = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(res.status === 404 ? '저장소를 찾을 수 없거나 토큰 권한이 없습니다.' : `GitHub 오류 ${res.status}`);
    const info = await res.json();
    if (!info.private) throw new Error('데이터 저장소가 공개(public) 상태입니다. 반드시 비공개(private)로 설정하세요.');
    if (info.permissions && !info.permissions.push) throw new Error('토큰에 쓰기(Contents: Read and write) 권한이 없습니다.');
    this.branch = info.default_branch || this.branch;
    return info;
  }

  async getText(path) {
    const res = await this.req(path, { query: `?ref=${this.branch}` });
    if (!res) return null;
    const j = await res.json();
    this.shas.set(path, j.sha);
    if (j.content) return dec.decode(b64ToBytes(j.content));
    // 1MB가 넘으면 content가 비어서 온다 → raw로 다시
    const raw = await this.req(path, { accept: 'application/vnd.github.raw+json', query: `?ref=${this.branch}` });
    return raw.text();
  }

  async getBlob(path) {
    const res = await this.req(path, { accept: 'application/vnd.github.raw+json', query: `?ref=${this.branch}` });
    return res ? res.blob() : null;
  }

  async putBytes(path, bytes, message) {
    const body = { message, content: bytesToB64(bytes), branch: this.branch };
    const sha = this.shas.get(path);
    if (sha) body.sha = sha;
    let res;
    try {
      res = await this.req(path, { method: 'PUT', body });
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      // sha 불일치 → 최신 sha로 재시도
      const cur = await this.req(path, { query: `?ref=${this.branch}` });
      if (cur) body.sha = (await cur.json()).sha;
      else delete body.sha;
      res = await this.req(path, { method: 'PUT', body });
    }
    const j = await res.json();
    this.shas.set(path, j.content.sha);
  }

  putText(path, text, message) {
    return this.putBytes(path, enc.encode(text), message);
  }

  async putBlob(path, blob, message) {
    return this.putBytes(path, new Uint8Array(await blob.arrayBuffer()), message);
  }

  async remove(path, message) {
    let sha = this.shas.get(path);
    if (!sha) {
      const cur = await this.req(path, { query: `?ref=${this.branch}` });
      if (!cur) return;
      sha = (await cur.json()).sha;
    }
    await this.req(path, { method: 'DELETE', body: { message, sha, branch: this.branch } });
    this.shas.delete(path);
  }
}

export class LocalStore {
  constructor() {
    this.kind = 'local';
    this.db = new Promise((resolve, reject) => {
      const r = indexedDB.open('shoot-briefing', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async tx(mode, fn) {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const t = db.transaction('files', mode);
      const req = fn(t.objectStore('files'));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  }
  async check() {}
  async getText(path) { return (await this.tx('readonly', (s) => s.get(path))) ?? null; }
  async getBlob(path) { return (await this.tx('readonly', (s) => s.get(path))) ?? null; }
  putText(path, text) { return this.tx('readwrite', (s) => s.put(text, path)); }
  putBlob(path, blob) { return this.tx('readwrite', (s) => s.put(blob, path)); }
  remove(path) { return this.tx('readwrite', (s) => s.delete(path)); }
}
