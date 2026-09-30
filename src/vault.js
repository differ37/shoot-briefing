// 접속 코드로 설정(키·토큰)을 암호화해 공개 저장소에 두고, 다른 기기에서는 코드만 입력해 불러온다.
// 암호문이 공개되므로 코드가 짧으면 오프라인 대입 공격에 뚫린다 → 강한 코드 강제 + 느린 키 유도(PBKDF2 60만 회).

const ITER = 600000;
const VAULT_PATH = 'public/vault.json';
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function codeProblem(code) {
  if (code.length < 8) return '8자 이상이어야 해요.';
  if (!/[A-Za-z]/.test(code) || !/\d/.test(code)) return '영문과 숫자를 섞어 주세요.';
  if (/^(.)\1+$/.test(code) || /^(?:0123|1234|abcd|qwer|pass)/i.test(code)) return '너무 쉬운 코드예요.';
  return '';
}

async function deriveKey(code, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptVault(data, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct), updatedAt: new Date().toISOString() };
}

export async function decryptVault(vault, code) {
  const key = await deriveKey(code, unb64(vault.salt), vault.iter);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, key, unb64(vault.data));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error('접속 코드가 맞지 않아요.');
  }
}

/** GitHub Pages 주소(아이디.github.io/저장소)에서 앱 저장소를 알아낸다 */
export function appRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo } : null;
}

export async function fetchVault() {
  const r = appRepo();
  const urls = [
    ...(r ? [`https://raw.githubusercontent.com/${r.owner}/${r.repo}/main/${VAULT_PATH}?t=${Date.now()}`] : []),
    `./vault.json?t=${Date.now()}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if (j?.v === 1 && j.data) return j;
      }
    } catch {}
  }
  return null;
}

export async function publishVault(store, vault) {
  await store.putText(VAULT_PATH, JSON.stringify(vault, null, 2) + '\n', '접속 코드 설정 갱신');
}
