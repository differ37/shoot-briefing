// 네이버지도 / 카카오 길안내 연결
// iPadOS 13+ 사파리는 UA가 Macintosh라 터치 지원 여부로 구분
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const APP_NAME = location.hostname || 'shoot-briefing';

function openWithFallback(scheme, web) {
  if (!isMobile) {
    window.open(web, '_blank', 'noopener');
    return;
  }
  const started = Date.now();
  const timer = setTimeout(() => {
    if (!document.hidden && Date.now() - started < 2500) location.href = web;
  }, 1400);
  document.addEventListener('visibilitychange', () => document.hidden && clearTimeout(timer), { once: true });
  location.href = scheme;
}

export function searchQuery(loc) {
  return (loc.address || loc.name || '').replace(/\s+/g, ' ').trim();
}

export function openNaver(loc) {
  const q = encodeURIComponent(searchQuery(loc));
  openWithFallback(`nmap://search?query=${q}&appname=${APP_NAME}`, `https://map.naver.com/p/search/${q}`);
}

function openKakaoMap(loc) {
  const q = encodeURIComponent(searchQuery(loc));
  openWithFallback(`kakaomap://search?q=${q}`, `https://map.kakao.com/link/search/${q}`);
}

// ---- 카카오내비 (선택: Kakao JavaScript 키가 있으면 주소→좌표 변환 후 내비 바로 실행) ----
const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('카카오 SDK를 불러오지 못했습니다.'));
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

async function geocode(key, address) {
  await loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`);
  await new Promise((r) => window.kakao.maps.load(r));
  const geocoder = new window.kakao.maps.services.Geocoder();
  const places = new window.kakao.maps.services.Places();
  const tryAddr = (q) => new Promise((r) => geocoder.addressSearch(q, (res, st) => r(st === 'OK' ? res[0] : null)));
  const tryPlace = (q) => new Promise((r) => places.keywordSearch(q, (res, st) => r(st === 'OK' ? res[0] : null)));
  // "... 132-17 A동" 처럼 뒤에 붙은 동/층 정보 때문에 실패하면 한 단어씩 떼어가며 재시도
  let parts = address.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  while (parts.length >= 3) {
    const hit = await tryAddr(parts.join(' '));
    if (hit) return { x: hit.x, y: hit.y };
    parts = parts.slice(0, -1);
  }
  const hit = await tryPlace(address);
  return hit ? { x: hit.x, y: hit.y } : null;
}

// 내비를 못 띄우고 카카오맵으로 대신 열 때는 onFallback(이유)로 알려준다
export async function openKakao(loc, kakaoKey, onFallback = () => {}) {
  const fallback = (reason) => {
    onFallback(reason);
    setTimeout(() => openKakaoMap(loc), 1200);
  };
  if (!kakaoKey) return openKakaoMap(loc);
  if (!isMobile) return fallback('카카오내비는 휴대폰에서만 실행돼요. 카카오맵으로 열게요');
  try {
    await loadScript('https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js');
    if (!window.Kakao.isInitialized()) window.Kakao.init(kakaoKey);
    // SDK가 응답 없이 멈추는 경우(도메인 미등록 등) 대비
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('응답 없음')), 8000));
    const pt = await Promise.race([geocode(kakaoKey, loc.address || loc.name), timeout]);
    if (!pt) return fallback('주소를 좌표로 바꾸지 못했어요. 카카오맵으로 열게요');
    window.Kakao.Navi.start({ name: loc.name || loc.address, x: Number(pt.x), y: Number(pt.y), coordType: 'wgs84' });
  } catch (e) {
    console.warn(e);
    fallback(`카카오 연결 실패(${e.message || e}). 키·도메인 등록·카카오맵 사용 설정을 확인하세요`);
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
