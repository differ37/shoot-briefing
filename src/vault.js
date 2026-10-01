// 아이디/비밀번호 로그인 (서버 없음)
//
// 사용자마다 "그 사람이 쓸 설정(토큰·키·권한)"을 그 사람 비밀번호로 암호화해 공개 앱 저장소
// public/users/<아이디 해시>.json 에 둔다. 로그인 = 파일을 받아 비밀번호로 복호화.
// - 관리자: 쓰기 토큰 + Claude 키
// - 보기 전용: 데이터 저장소 "읽기 전용" 토큰만 → GitHub이 쓰기를 거부하므로 권한이 실제로 강제된다.
// 암호문이 공개되므로 느린 키 유도(PBKDF2 60만 회)를 쓰고, 비밀번호는 강하게 요구한다.

const ITER = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const normId = (id) => String(id || '').trim().toLowerCase();

export function passwordProblem(pw) {
  if (pw.length < 8) return '비밀번호는 8자 이상이어야 해요.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에 영문과 숫자를 섞어 주세요.';
  return '';
}

async function userFile(id) {
  const hash = await crypto.subtle.digest('SHA-256', enc.encode('shoot-briefing:' + normId(id)));
  return `public/users/${[...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')}.json`;
}

async function deriveKey(id, pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normId(id) + '\n' + pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptUser(id, pw, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(id, pw, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return { v: 2, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) };
}

export async function decryptUser(id, pw, file) {
  const key = await deriveKey(id, pw, unb64(file.salt), file.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data));
  return JSON.parse(dec.decode(pt));
}

/** GitHub Pages 주소(아이디.github.io/저장소)에서 앱 저장소를 알아낸다 */
export function appRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo } : null;
}

async function fetchUserFile(id) {
  const path = await userFile(id);
  const r = appRepo();
  const urls = [
    ...(r ? [`https://raw.githubusercontent.com/${r.owner}/${r.repo}/main/${path}?t=${Date.now()}`] : []),
    `./${path.replace(/^public\//, '')}?t=${Date.now()}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {}
  }
  return null;
}

export async function login(id, pw) {
  const file = await fetchUserFile(id);
  // 아이디가 없는 경우와 비밀번호가 틀린 경우를 구분하지 않는다
  const fail = new Error('비밀번호가 올바르지 않아요.');
  if (!file) throw new Error('아직 설정되지 않은 계정이에요. jj 계정의 설정 → 사용자 관리에서 이 계정을 저장해 주세요.');
  try {
    return await decryptUser(id, pw, file);
  } catch {
    throw fail;
  }
}

/** appStore: 앱 저장소(GitHubStore), 쓰기 권한 필요 */
export async function publishUser(appStore, id, pw, data) {
  const file = await encryptUser(id, pw, data);
  await appStore.putText(await userFile(id), JSON.stringify(file) + '\n', `사용자 ${normId(id)} 설정 갱신`);
}

export async function removeUser(appStore, id) {
  await appStore.remove(await userFile(id), `사용자 ${normId(id)} 삭제`);
}

// 로그인 화면의 계정 선택용 공개 목록 (아이디·권한만, 비밀 정보 없음)
const ACCOUNTS_PATH = 'public/accounts.json';
export async function fetchAccounts() {
  const r = appRepo();
  const urls = [
    ...(r ? [`https://raw.githubusercontent.com/${r.owner}/${r.repo}/main/${ACCOUNTS_PATH}?t=${Date.now()}`] : []),
    `./accounts.json?t=${Date.now()}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return (await res.json()).accounts || [];
    } catch {}
  }
  return null;
}
export async function publishAccounts(appStore, list) {
  await appStore.putText(ACCOUNTS_PATH, JSON.stringify({ accounts: list }, null, 2) + '\n', '계정 목록 갱신');
}
