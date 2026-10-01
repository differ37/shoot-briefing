// 계정별 표시 이름·이니셜·얼굴 아이콘 (로그인 아이디는 그대로 jj / hk / sh)

const ironman = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs><radialGradient id="im-bg" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="#e2323a"/><stop offset="1" stop-color="#8c0f16"/></radialGradient></defs>
  <rect width="64" height="64" fill="url(#im-bg)"/>
  <path d="M14 30 Q14 10 32 9 Q50 10 50 30 L50 44 Q48 56 32 60 Q16 56 14 44 Z" fill="#b5141c"/>
  <path d="M19 21 Q32 14 45 21 L46 38 Q45 50 32 55 Q19 50 18 38 Z" fill="#f2c14e"/>
  <path d="M24 21 L32 25 L40 21" fill="none" stroke="#c99630" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M21 30 L29 32.5 L28.5 35.5 L22 33.5 Z" fill="#eafcff"/>
  <path d="M43 30 L35 32.5 L35.5 35.5 L42 33.5 Z" fill="#eafcff"/>
  <path d="M21 30 L29 32.5 L28.5 35.5 L22 33.5 Z M43 30 L35 32.5 L35.5 35.5 L42 33.5 Z" fill="none" stroke="#7fe7ff" stroke-width="0.8" opacity=".9"/>
  <path d="M22 41 L26 44 M42 41 L38 44" stroke="#c99630" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M26.5 47 L37.5 47" stroke="#a87a22" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const superman = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="sm-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a8dff"/><stop offset="1" stop-color="#1546b8"/></linearGradient></defs>
  <rect width="64" height="64" fill="url(#sm-bg)"/>
  <path d="M8 64 Q10 50 24 48 L40 48 Q54 50 56 64 Z" fill="#d6222f"/>
  <path d="M18 64 Q20 53 32 52 Q44 53 46 64 Z" fill="#1d4fd1"/>
  <rect x="27" y="44" width="10" height="8" rx="3" fill="#efbf98"/>
  <ellipse cx="32" cy="33" rx="12.5" ry="15" fill="#f6cfa8"/>
  <path d="M19 31 Q17 15 32 14 Q47 15 45 31 Q43 22 33 21 Q23 21 19 31 Z" fill="#141414"/>
  <path d="M31 20.5 Q26.5 23.5 30 26.5 Q32.5 28.5 30.5 31" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
  <path d="M24.5 30 L29.5 29.5 M34.5 29.5 L39.5 30" stroke="#2a1d14" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="27.3" cy="33.5" r="1.6" fill="#1b2d55"/>
  <circle cx="36.7" cy="33.5" r="1.6" fill="#1b2d55"/>
  <path d="M28 41 Q32 44 36 41" fill="none" stroke="#b5654a" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

const batman = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs><linearGradient id="bm-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a5a6e"/><stop offset="1" stop-color="#1e2733"/></linearGradient></defs>
  <rect width="64" height="64" fill="url(#bm-bg)"/>
  <path d="M6 64 Q10 52 22 50 L42 50 Q54 52 58 64 Z" fill="#101114"/>
  <path d="M21 40 Q21 57 32 58 Q43 57 43 40 Z" fill="#e7b88e"/>
  <path d="M15 42 L15 22 L19 7 L24.5 19 L39.5 19 L45 7 L49 22 L49 42 L42 43 L36 44.5 L32 48 L28 44.5 L22 43 Z" fill="#141518"/>
  <path d="M20.5 31 L29 33.5 L28 36 L22 34.8 Z" fill="#f4f6f8"/>
  <path d="M43.5 31 L35 33.5 L36 36 L42 34.8 Z" fill="#f4f6f8"/>
  <path d="M28 53 L36 53" stroke="#7a4a2c" stroke-width="1.7" stroke-linecap="round"/>
</svg>`;

export const PROFILES = {
  jj: { name: '준연', initial: '정', face: ironman, color: '#c8161e' },
  hk: { name: '효권', initial: '서', face: superman, color: '#1f5fe0' },
  sh: { name: '신훈', initial: '강', face: batman, color: '#2b3644' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const displayName = (id) => PROFILES[id]?.name || id;

/** 얼굴 아이콘 + 이니셜 배지. 프로필이 없으면 첫 글자 동그라미 */
export function avatarHtml(id, size = '') {
  const p = PROFILES[id];
  if (!p) return `<span class="avatar ${size}">${esc(String(id || '?').slice(0, 1).toUpperCase())}</span>`;
  return `<span class="avatar face ${size}" title="${esc(p.name)}">${p.face}<i style="--c:${p.color}">${esc(p.initial)}</i></span>`;
}
