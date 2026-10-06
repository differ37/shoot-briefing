import './styles.css';
import { icon } from './icons.js';
import { avatarHtml, displayName } from './profiles.js';
import { GitHubStore, LocalStore, PrefixedStore, originals } from './storage.js';
import { Library, versionKeyFromName } from './library.js';
import { analyzeTimetable, compareVersions, matchConti, testKey } from './claude.js';
import { makeReducedPdf, openPdf, pdfToAnalysisImages, pdfThumbnail, pickPages, renderPagesInto } from './pdf.js';
import { installTypeset } from './typeset.js';
import { annotatedImages, extractConti, mapFromAI, matchSchedule, renderRegion, thumbRenderer } from './conti.js';
import { computeMarks } from './diff.js';
import { openNaver, openKakao, copyText } from './nav.js';
import { buildQuote, cityOf, defaultContent, downloadBlob, finalMessage, hasSavedProfile, hasSavedSource, loadProfile, loadSource, prepareSourceImage, quoteFileName, saveProfile, saveSource, sourceDataUrl, sourceFile, DEFAULT_ITEM, MAX_DAYS } from './quote.js';
import { appRepo, fetchAccounts, login, normId, passwordProblem, publishAccounts, publishUser, removeUser } from './vault.js';

// ---------------------------------------------------------------- 설정
const SETTINGS_KEY = 'shoot-briefing.settings';
const DEFAULTS = { mode: 'github', ghOwner: appRepo()?.owner || '', ghRepo: 'shoot-briefing-data', ghToken: '', anthropicKey: '', kakaoKey: '', memberToken: '', role: 'admin', userId: '' };
// 카카오 JavaScript 키는 원래 웹페이지에 공개되는 키(등록 도메인에서만 동작)라 코드에 둔다.
// 계정별 설정에 키가 없어도(휴대폰 로그인 등) 모두 카카오내비를 쓸 수 있게 기본값으로 쓴다.
const SITE_KAKAO_KEY = 'ed6d44e1aede2abe26408146305d8ef2';
const kakaoKey = () => settings.kakaoKey || SITE_KAKAO_KEY;
const SESSION_FIELDS = ['mode', 'ghOwner', 'ghRepo', 'ghToken', 'anthropicKey', 'kakaoKey', 'memberToken', 'role'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (saved.viewerToken && !saved.memberToken) saved.memberToken = saved.viewerToken; // 예전 이름
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}
let settings = loadSettings();
function saveSettings(next) {
  settings = { ...settings, ...next };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  libraries.clear();
  accounts = null;
}

const storageReady = () => settings.mode === 'local' || (settings.ghToken && settings.ghOwner && settings.ghRepo);
const isAdmin = () => settings.role === 'admin';
// 예전 "보기 전용" 계정은 키 없이도 볼 수는 있게
const isConfigured = () => storageReady() && (settings.role === 'viewer' || !!settings.anthropicKey);

// ---- 사람별 공간: 관리자(jj)의 공간은 저장소 루트(기존 데이터), 나머지는 spaces/<아이디>/
const ADMIN_SPACE = '_admin';
// 예전 방식(아이디 없이 관리자 설정)으로 쓰던 기기는 계정 목록의 관리자 아이디로 본다
const mySpace = () => settings.userId || (settings.role === 'admin' && accounts?.find((x) => x.role === 'admin')?.id) || ADMIN_SPACE;
let accounts = null; // [{id, role}]
async function loadAccounts() {
  if (accounts) return accounts;
  let list = [];
  try {
    const text = await baseStore().getText('users.json');
    if (text) list = JSON.parse(text).users.map(({ id, role }) => ({ id, role: role === 'viewer' ? 'member' : role }));
  } catch {}
  accounts = list;
  if (!list.some((x) => x.id === mySpace())) list.unshift({ id: mySpace(), role: settings.role });
  return accounts;
}
const roleOf = (space) => (space === ADMIN_SPACE ? 'admin' : accounts?.find((a) => a.id === space)?.role);
const spacePrefix = (space) => (roleOf(space) === 'admin' ? '' : `spaces/${space}/`);
const spaceName = (space) => (space === ADMIN_SPACE ? '관리자' : displayName(space));
// 쓰기: 관리자는 모든 공간, 나머지는 자기 공간만 (예전 보기 전용 계정은 쓰기 불가)
const canEdit = (space) => settings.role !== 'viewer' && (isAdmin() || space === mySpace());
const canUpload = (space) => canEdit(space) && !!settings.anthropicKey;

function baseStore() {
  return settings.mode === 'local'
    ? new LocalStore()
    : new GitHubStore({ token: settings.ghToken, owner: settings.ghOwner, repo: settings.ghRepo });
}
const libraries = new Map();
async function getLibrary(space = mySpace()) {
  await loadAccounts();
  if (!libraries.has(space)) {
    const lib = new Library(new PrefixedStore(baseStore(), spacePrefix(space)));
    lib.space = space;
    libraries.set(space, lib.load().then(() => lib));
  }
  return libraries.get(space);
}
let currentSpace = null;
const L = (space, pid, vid) => `#/s/${encodeURIComponent(space)}${pid ? `/p/${encodeURIComponent(pid)}${vid ? `/${encodeURIComponent(vid)}` : ''}` : ''}`;

// ---------------------------------------------------------------- 유틸
const app = document.getElementById('app');
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2200);
}

function dday(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  return diff === 0 ? 'D-DAY' : diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

function prettyDate(dateStr, weekday) {
  if (!dateStr) return '날짜 미정';
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = weekday || '일월화수목금토'[new Date(dateStr + 'T00:00:00').getDay()];
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

const relTime = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 업로드`;
};

const badge = (mark) => {
  if (!mark) return '';
  if (mark.type === 'new') return '<span class="badge new">NEW</span>';
  return `<span class="badge chg">변경</span>${mark.before ? `<span class="before">${h(mark.before)}</span>` : ''}`;
};

// 긴 문장을 문장 단위로 끊어 줄바꿈해서 보여준다
const splitSentences = (t) => String(t ?? '')
  .split(/\n+/)
  .flatMap((part) => part.split(/(?<=[가-힣)\]"'’”][.!?])\s+/))
  .map((s) => s.trim())
  .filter(Boolean);
const para = (t, cls = '') => {
  const ls = splitSentences(t);
  return ls.length ? `<div class="lines ${cls}">${ls.map((l) => `<p>${h(l)}</p>`).join('')}</div>` : '';
};
// "A → B → C" 흐름은 단계별 세로 목록으로
const flow = (t, cls = '') => {
  let steps = String(t ?? '').split(/\s*(?:→|->|⇒|▶)\s*/).map((s) => s.trim()).filter(Boolean);
  if (steps.length < 2) steps = String(t ?? '').split(/,\s+/).map((s) => s.trim()).filter(Boolean);
  if (steps.length < 2) return para(t, cls);
  return `<ol class="flow ${cls}">${steps.map((s) => `<li>${h(s)}</li>`).join('')}</ol>`;
};
// "점심 / 세팅 / 크로마키" 같은 제목은 첫 항목만 굵게, 나머지는 아래 줄로
const titleLines = (t) => {
  const [first, ...rest] = String(t ?? '').split(/\s+\/\s+/);
  return `<strong>${h(first)}</strong>${rest.map((r) => `<span class="sub">${h(r)}</span>`).join('')}`;
};

// 내 시간 기록. 예전 방식(project.prep = 장비집 집합/출발)은 기록 두 줄로 바꿔 보여준다
const logOf = (project) => project.log || [
  ...(project.prep?.gather ? [{ id: 'g', label: '장비집 집합', time: project.prep.gather }] : []),
  ...(project.prep?.depart ? [{ id: 'd', label: '장비집 출발', time: project.prep.depart }] : []),
];
// 촬영팀 도착 전까지의 기록 → 촬영팀 도착 (홈·도착 카드용 요약)
const logChain = (entries, callTime, cls = '') => {
  const before = entries.filter((e) => e.time && (!callTime || !/^\d{1,2}:\d{2}$/.test(callTime) || e.time <= callTime)).slice(-3);
  if (!before.length) return '';
  const steps = [...before.map((e) => [e.label, e.time]), ['촬영팀 도착', callTime || '—']];
  return `<ol class="chain ${cls}">${steps.map(([label, t], i) => `<li class="${i === steps.length - 1 ? 'arrive' : ''}"><span>${h(label)}</span><b>${h(t)}</b></li>`).join('')}</ol>`;
};
const firstLog = (p) => logOf(p)[0];

const isPlaceholderPhone = (p) => !p || /0000-?0000/.test(p);
const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
const smsHref = (p) => 'sms:' + String(p).replace(/[^\d+]/g, '');

const thumbUrls = new Map();
async function loadThumb(lib, pid, vid) {
  const key = `${lib.space}/${pid}/${vid}`;
  if (!thumbUrls.has(key)) {
    thumbUrls.set(key, lib.getThumb(pid, vid).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
  }
  return thumbUrls.get(key);
}
function hydrateThumbs(lib, root = app) {
  $$('img[data-thumb]', root).forEach(async (img) => {
    const [pid, vid] = img.dataset.thumb.split('/');
    const url = await loadThumb(lib, pid, vid);
    if (url) { img.src = url; img.onload = () => img.classList.add('loaded'); }
  });
}

// ---------------------------------------------------------------- 레이아웃
function shell(content, { active = '' } = {}) {
  return `
  <header class="nav">
    <div class="nav-inner">
      ${isConfigured() ? `<button class="menu-btn" data-action="drawer" aria-label="계정 메뉴">${icon.menu}</button>` : ''}
      <a class="brand" href="#/">${icon.truck}<span>촬영 브리핑</span></a>
      <nav class="nav-links">
        ${isConfigured() && currentSpace && canUpload(currentSpace) ? `<button class="nav-upload" data-action="upload">${icon.upload}<span>타임테이블 올리기</span></button>` : ''}
        ${isConfigured() ? `<button class="user-chip" data-action="drawer" aria-label="계정 메뉴">${avatarHtml(mySpace(), 'sm')}<span class="uname">${h(spaceName(mySpace()))}</span></button>` : ''}
      </nav>
    </div>
  </header>
  ${isConfigured() && currentSpace && currentSpace !== mySpace() && active !== 'settings' ? `
  <div class="space-banner"><div>
    ${avatarHtml(currentSpace, 'sm')}
    <span><b>${h(spaceName(currentSpace))}</b>님의 스케줄 · ${canEdit(currentSpace) ? '편집 가능' : '보기 전용'}</span>
    <a href="${L(mySpace())}">내 브리핑으로 ${icon.chevron}</a>
  </div></div>` : ''}
  <main>${content}</main>
  <footer class="foot">촬영팀 장비차량 기사용 타임테이블 브리핑 · Claude가 분석한 내용은 반드시 원본과 함께 확인하세요.</footer>`;
}

// ---------------------------------------------------------------- 옆 메뉴 (계정 전환)
async function openDrawer() {
  await loadAccounts();
  const el = document.createElement('div');
  el.className = 'drawer-backdrop';
  const me = mySpace();
  const others = accounts.filter((a) => a.id !== me);
  const item = (a) => `
    <a class="d-item ${a.id === currentSpace ? 'on' : ''}" href="${L(a.id)}">
      ${avatarHtml(a.id)}
      <span class="d-name"><b>${h(spaceName(a.id))}</b><small>${a.id === me ? '내 브리핑' : canEdit(a.id) ? '편집 가능' : '보기 전용'}</small></span>
      ${a.id === currentSpace ? icon.check : ''}
    </a>`;
  el.innerHTML = `
  <aside class="drawer" role="dialog" aria-label="계정 메뉴">
    <div class="d-head">${avatarHtml(me, 'md')}<div><b>${h(spaceName(me))}</b><small>${isAdmin() ? '관리자' : '멤버'}로 로그인됨</small></div></div>
    <p class="d-label">내 브리핑</p>
    ${item(accounts.find((a) => a.id === me) || { id: me })}
    ${others.length ? `<p class="d-label">다른 사람 스케줄${isAdmin() ? '' : ' · 보기 전용'}</p>${others.map(item).join('')}` : ''}
    <div class="d-foot">
      ${canEdit(me) ? `<button class="d-link" data-action="quote">${icon.doc}견적서 만들기</button>` : ''}
      <a class="d-link" href="#/settings">${icon.gear}${isAdmin() ? '설정 · 사용자 관리' : '내 계정'}</a>
      <button class="d-link danger" data-logout>${icon.trash}로그아웃</button>
    </div>
  </aside>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('a, [data-action="quote"]')) close();
    if (e.target.closest('[data-logout]')) { logout(); close(); toast('로그아웃했어요'); location.hash = '#/'; route(); }
  });
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-action="drawer"]')) openDrawer(); });

// ---------------------------------------------------------------- 라우터
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'settings') { currentSpace = null; return renderSettings(); }
    if (!isConfigured()) { currentSpace = null; return renderLogin(); }
    await loadAccounts();
    if (parts[0] === 'p' && parts[1]) { location.replace(L(mySpace(), parts[1], parts[2])); return; } // 예전 주소
    if (parts[0] !== 's' || !parts[1]) { location.replace(L(mySpace())); return; }
    currentSpace = parts[1];
    if (parts[2] === 'p' && parts[3]) return await renderProject(currentSpace, parts[3], parts[4]);
    return await renderHome(currentSpace);
  } catch (e) {
    console.error(e);
    if (e.status === 401) {
      // 토큰이 만료·폐기됨 → 다시 로그인
      logout();
      return renderLogin('로그인 정보가 만료됐어요. 다시 로그인해 주세요.');
    }
    app.innerHTML = shell(`<section class="section narrow"><div class="empty">
      <h2>불러오지 못했어요</h2><p>${h(e.message)}</p>
      <div class="row-gap"><a class="btn" href="#/settings">설정 확인</a><button class="btn ghost" onclick="location.reload()">다시 시도</button></div></div></section>`);
  }
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- 로그인
function renderLogin(message = '') {
  app.innerHTML = shell(`
  <section class="hero welcome">
    <p class="eyebrow">CALL SHEET BRIEFING</p>
    <h1>타임테이블,<br>이제 한눈에.</h1>
    <p class="lead">도착 시간, 촬영지 주소, 이동 동선, 담당자 연락처를 한 화면에. 새 버전이 나오면 무엇이 바뀌었는지 바로 보여드립니다.</p>
    <div class="account-pick" id="accountPick" hidden></div>
    <form class="login card" id="loginForm">
      <div class="login-who" id="loginWho" hidden></div>
      <label id="idField">아이디<input name="id" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label>비밀번호<input name="pw" type="password" autocomplete="current-password" required></label>
      <button class="btn large block" type="submit">로그인</button>
      <p class="login-msg" id="loginMsg">${h(message)}</p>
    </form>
    <a class="text-link setup-link" href="#/settings">관리자 처음 설정</a>
  </section>`);

  const form = $('#loginForm');
  $('input[name=id]', form).focus();

  // 계정 선택 카드 (공개 목록이 있을 때)
  fetchAccounts().then((list) => {
    if (!list?.length) return;
    const pickEl = $('#accountPick');
    pickEl.hidden = false;
    pickEl.innerHTML = `<p class="pick-title">계정을 선택하세요</p><div class="pick-grid">${list.map((a) => `
      <button type="button" class="pick" data-id="${h(a.id)}">
        ${avatarHtml(a.id, 'lg')}
        <strong>${h(displayName(a.id))}</strong>
        <span>${a.role === 'admin' ? '관리자' : '멤버'}</span>
      </button>`).join('')}</div>`;
    form.hidden = true;
    pickEl.addEventListener('click', (e) => {
      const b = e.target.closest('.pick');
      if (!b) return;
      $$('.pick', pickEl).forEach((x) => x.classList.toggle('on', x === b));
      form.hidden = false;
      $('input[name=id]', form).value = b.dataset.id;
      $('#idField').hidden = true;
      $('#loginWho').hidden = false;
      $('#loginWho').innerHTML = `${avatarHtml(b.dataset.id, 'md')}<span><b>${h(displayName(b.dataset.id))}</b> 계정으로 로그인</span>`;
      $('#loginMsg').textContent = '';
      $('input[name=pw]', form).value = '';
      $('input[name=pw]', form).focus();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', form);
    const { id, pw } = Object.fromEntries(new FormData(form));
    btn.disabled = true;
    btn.textContent = '확인 중…';
    $('#loginMsg').textContent = '';
    try {
      const data = await login(id, pw);
      saveSettings({ ...DEFAULTS, ...pick(data, SESSION_FIELDS), userId: normId(id) });
      // 견적서용 내 정보(암호화 저장)를 비밀번호가 있을 때 미리 풀어 둔다
      getLibrary(mySpace()).then(async (lib) => {
        const [p, src] = await Promise.all([loadProfile(lib.store, normId(id), pw).catch(() => null), loadSource(lib.store, normId(id), pw).catch(() => null)]);
        if (p) saveSettings({ quoteProfile: p });
        if (src) storeLocalSource(src);
      }).catch(() => {});
      toast(`${displayName(normId(id))}님, 환영합니다`);
      // 로그인 화면이 이미 내 브리핑 주소(#/s/jj)에서 떴으면 주소가 안 바뀌어 화면 전환이 일어나지 않으므로 직접 그린다
      const target = L(mySpace());
      if (location.hash === target) route(); else location.hash = target;
    } catch (err) {
      $('#loginMsg').textContent = err.message;
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  });
}

// ---------------------------------------------------------------- 홈
async function renderHome(space) {
  app.innerHTML = shell('<section class="section"><div class="skeleton tall"></div></section>', { active: 'home' });
  const lib = await getLibrary(space);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const projects = [...lib.index.projects].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const upcoming = projects.filter((p) => !p.date || new Date(p.date + 'T00:00:00') >= today);
  const past = projects.filter((p) => !upcoming.includes(p)).reverse();
  const [next, ...later] = upcoming;
  const href = (p) => L(space, p.id);

  // --- 다가오는 촬영 (1건 크게)
  let featured = '';
  if (next) {
    const latest = lib.latest(next);
    const rec = await lib.getVersion(next.id, latest.id);
    const a = rec?.analysis || {};
    featured = `
    <section class="section home-top">
      <h2 class="section-title">${icon.flag} 다가오는 촬영</h2>
      <a class="featured" href="${href(next)}">
        <div class="f-main">
          <div class="f-meta"><span class="dday-pill">${h(dday(next.date))}</span><span>${h(prettyDate(next.date, next.weekday))}</span></div>
          <strong class="f-title">${h(next.title)}</strong>
          ${next.production ? `<span class="f-prod">${h(next.production)}</span>` : ''}
          <div class="f-call">
            <span class="call-label">${icon.camera} 촬영팀 도착</span>
            <span class="call-time">${h(a.my_call?.time || '—')}</span>
            <span class="call-place">${icon.pin}${h(a.my_call?.location_name || '')}</span>
          </div>
          ${logChain(logOf(next), a.my_call?.time, 'on-dark')}
          ${a.headline ? flow(a.headline, 'on-dark') : ''}
          ${latest.highChangeCount ? `<p class="hero-alert">${icon.alert} 최신 ${h(latest.label)} · 중요한 변경 ${latest.highChangeCount}건</p>` : ''}
          <span class="call-go">브리핑 보기 ${icon.chevron}</span>
        </div>
        <div class="f-thumb"><img alt="" data-thumb="${h(next.id)}/${h(latest.id)}"></div>
      </a>
    </section>`;
  } else {
    featured = `
    <section class="hero">
      <p class="eyebrow">CALL SHEET BRIEFING</p>
      <h1>예정된 촬영이 없어요.</h1>
      <p class="lead">${canUpload(space) ? '타임테이블 PDF를 올리면<br>브리핑이 만들어집니다.' : `${h(spaceName(space))}님이 타임테이블을 올리면<br>여기에 나타나요.`}</p>
    </section>`;
  }

  // --- 촬영 목록 (한 줄씩, 월별로 묶음)
  const row = (p) => {
    const latest = lib.latest(p);
    const [, m, d] = (p.date || '').split('-').map(Number);
    return `
    <a class="shoot-row" href="${href(p)}" data-pid="${h(p.id)}">
      <div class="sr-date">${p.date ? `<b>${m}.${d}</b><span>${h(p.weekday || '일월화수목금토'[new Date(p.date + 'T00:00:00').getDay()])}</span>` : '<b>미정</b>'}</div>
      <div class="sr-body">
        <strong>${h(p.title)}</strong>
        <span class="sr-sub">${h(p.production || p.shootType || '')}</span>
        <span class="sr-call" data-call>${p.callTime ? `${icon.clock}${firstLog(p) ? `${h(firstLog(p).time)} ${h(firstLog(p).label)} · ` : ''}${h(p.callTime)} 도착 · ${h(p.callPlace || '')}` : ''}</span>
      </div>
      <div class="sr-side">
        <span class="sr-dday">${h(dday(p.date))}</span>
        ${latest.highChangeCount ? `<span class="sr-chg">변경 ${latest.highChangeCount}</span>` : `<span class="sr-ver">${h(latest.label)}</span>`}
      </div>
      ${icon.chevron}
    </a>`;
  };
  const byMonth = (list) => {
    const groups = new Map();
    for (const p of list) {
      const key = p.date ? `${Number(p.date.slice(0, 4))}년 ${Number(p.date.slice(5, 7))}월` : '날짜 미정';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    return [...groups].map(([k, ps]) => `<h3 class="month">${h(k)}</h3><div class="shoot-list">${ps.map(row).join('')}</div>`).join('');
  };

  app.innerHTML = shell(`
    ${featured}
    ${later.length ? `<section class="section"><h2 class="section-title">${icon.clock} 예정된 촬영 <span class="count">${later.length}</span></h2>${byMonth(later)}</section>` : ''}
    ${space === mySpace() && canEdit(space) && projects.length ? `<section class="section">
      <button class="quote-cta" data-action="quote">${icon.doc}<span><b>견적서 다운로드</b><small>일정을 고르고 금액만 넣으면 돼요</small></span>${icon.chevron}</button>
    </section>` : ''}
    ${canUpload(space) ? `<section class="section">
      <div class="dropzone" data-action="upload" id="dropzone">
        ${icon.upload}
        <strong>타임테이블 PDF 올리기</strong>
        <span>여기로 끌어다 놓거나 눌러서 선택하세요.<br>여러 버전을 한 번에 올려도 돼요.</span>
      </div>
    </section>` : ''}
    ${past.length ? `<section class="section">
      <details class="past-box">
        <summary><span>${icon.history} 지난 촬영</span><span class="count">${past.length}</span>${icon.chevron}</summary>
        ${byMonth(past)}
      </details>
    </section>` : ''}
  `, { active: 'home' });
  hydrateThumbs(lib);
  bindDrop($('#dropzone'));

  // 예전에 올린 촬영은 목록에 도착 시간이 없으니 최신 분석에서 채운다
  for (const p of later.filter((x) => !x.callTime).slice(0, 20)) {
    lib.getVersion(p.id, lib.latest(p).id).then((rec) => {
      const mc = rec?.analysis?.my_call;
      const el = $(`.shoot-row[data-pid="${CSS.escape(p.id)}"] [data-call]`);
      if (mc?.time && el) el.innerHTML = `${icon.clock}${firstLog(p) ? `${h(firstLog(p).time)} ${h(firstLog(p).label)} · ` : ''}${h(mc.time)} 도착 · ${h(mc.location_name || '')}`;
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------- 콘티 크게 보기
const CONTI_KEY = 'shoot-briefing.conti';
function openContiViewer(pdf, row, start = 0) {
  const el = document.createElement('div');
  el.className = 'sheet-backdrop conti-viewer';
  el.innerHTML = `<div class="cv-box"><img alt=""><div class="cv-bar"><button type="button" class="cv-prev" aria-label="이전">${icon.back}</button><span class="cv-count"></span><button type="button" class="cv-next" aria-label="다음">${icon.chevron}</button><button type="button" class="cv-close">닫기</button></div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const img = $('img', el);
  const urls = new Map();
  let k = start;
  const show = async () => {
    $('.cv-count', el).textContent = `${k + 1} / ${row.images.length}`;
    $('.cv-prev', el).disabled = k === 0;
    $('.cv-next', el).disabled = k === row.images.length - 1;
    if (!urls.has(k)) {
      const w = Math.min(2000, Math.max(window.innerWidth, 600) * Math.min(2, window.devicePixelRatio || 1));
      urls.set(k, renderRegion(pdf, row.images[k].page, row.images[k], w).then((blob) => URL.createObjectURL(blob)));
    }
    const want = k;
    const url = await urls.get(k);
    if (want === k) img.src = url;
  };
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => { el.remove(); urls.forEach((p) => p.then((u) => URL.revokeObjectURL(u))); }, 300);
  };
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('.cv-close')) close();
    else if (e.target.closest('.cv-prev') && k > 0) { k--; show(); }
    else if (e.target.closest('.cv-next') && k < row.images.length - 1) { k++; show(); }
  });
  show();
}

// ---------------------------------------------------------------- 프로젝트 브리핑
async function renderProject(space, pid, vid) {
  app.innerHTML = shell('<section class="section"><div class="skeleton tall"></div><div class="skeleton"></div></section>');
  const lib = await getLibrary(space);
  const project = lib.project(pid);
  if (!project) { location.hash = L(space); return; }
  const versions = lib.sortedVersions(project);
  const latest = versions[versions.length - 1];
  const meta = versions.find((v) => v.id === vid) || latest;
  const isLatest = meta.id === latest.id;
  const rec = await lib.getVersion(pid, meta.id);
  if (!rec) throw new Error('버전 데이터를 찾을 수 없습니다.');
  const a = rec.analysis;
  const prevRec = rec.changes?.against ? await lib.getVersion(pid, rec.changes.against) : null;
  const marks = computeMarks(prevRec?.analysis, a);
  const prod = a.production || {};

  // --- 히어로
  const hero = `
  <section class="hero project-hero">
    <div class="hero-text">
      <p class="eyebrow">${h([prod.production_company, prod.shoot_type].filter(Boolean).join(' · ') || 'CALL SHEET')}</p>
      <h1>${h(prod.project_title || project.title)}</h1>
      <p class="lead">${h(prettyDate(prod.shoot_date || project.date, prod.weekday))} <span class="dday">${h(dday(prod.shoot_date || project.date))}</span>${canEdit(space) ? `<button type="button" class="mini-btn" data-log-add>${icon.clock}시간 기록</button>` : ''}</p>
      <div class="ver-line">
        <span class="pill ${isLatest ? 'latest' : 'old'}">${isLatest ? '최신' : '이전 버전'} · ${h(meta.label)}</span>
        ${rec.changes ? `<span class="pill ${rec.changes.changes.length ? 'warn' : ''}">${h(rec.changes.againstLabel)} 대비 변경 ${rec.changes.changes.length}건</span>` : '<span class="pill">첫 버전</span>'}
      </div>
      ${!isLatest ? `<a class="old-banner" href="${L(space, pid)}">${icon.alert} 지금 보고 있는 건 예전 버전이에요. 최신(${h(latest.label)}) 보기 ${icon.chevron}</a>` : ''}
      ${a.headline ? `<div class="headline">${flow(a.headline)}</div>` : ''}
    </div>
    <div class="hero-visual"><img alt="타임테이블 미리보기" data-thumb="${h(pid)}/${h(meta.id)}"></div>
  </section>`;

  // --- 버전 스위처
  const switcher = `
  <div class="version-bar"><div class="version-scroll">
    ${[...versions].reverse().map((v) => `
      <a class="vchip ${v.id === meta.id ? 'on' : ''}" href="${L(space, pid, v.id)}">
        ${h(v.label)}${v.id === latest.id ? '<i>최신</i>' : ''}${v.highChangeCount ? `<b>${v.highChangeCount}</b>` : ''}
      </a>`).join('')}
    ${canUpload(space) ? `<button class="vchip add" data-action="upload" data-project="${h(pid)}">${icon.upload} 새 버전</button>` : ''}
  </div></div>`;

  // --- 변경사항
  const changes = rec.changes;
  const order = { high: 0, medium: 1, low: 2 };
  const changesHtml = changes ? `
  <section class="section" id="sec-changes">
    <div class="card changes ${changes.changes.length ? '' : 'none'}">
      <div class="card-head">${icon.swap}<h2>${h(changes.againstLabel)} → ${h(meta.label)} 변경사항</h2></div>
      ${para(changes.summary, 'changes-summary')}
      ${changes.changes.length ? `<ul class="change-list">
        ${[...changes.changes].sort((x, y) => order[x.importance] - order[y.importance]).map((c) => `
        <li class="imp-${c.importance}">
          <div class="chg-top"><span class="chg-cat">${h(c.category)}</span><strong>${h(c.title)}</strong></div>
          ${c.before || c.after ? `<div class="chg-vals">
            ${c.before ? `<span class="v-before">${h(c.before)}</span>` : '<span class="v-before empty">없음</span>'}
            <span class="arrow">→</span>
            ${c.after ? `<span class="v-after">${h(c.after)}</span>` : '<span class="v-after empty">삭제</span>'}
          </div>` : ''}
          ${c.driver_impact ? `<div class="impact">${icon.truck}${para(c.driver_impact)}</div>` : ''}
        </li>`).join('')}
      </ul>` : ''}
    </div>
  </section>` : '';

  // --- 내 도착
  const mc = a.my_call || {};
  const locs = a.locations || [];
  const myLoc = locs.find((l) => l.name && mc.location_name && (l.name.includes(mc.location_name) || mc.location_name.includes(l.name))) || locs[0] || {};
  const myAddr = mc.address || myLoc.address || '';
  const navBtns = (loc, idx) => `
    <div class="nav-btns">
      <button class="btn nav naver" data-nav="naver" data-loc="${idx}">${icon.naver}네이버지도</button>
      <button class="btn nav kakao" data-nav="kakao" data-loc="${idx}">${icon.kakao}${kakaoKey() ? '카카오내비' : '카카오맵'}</button>
      <button class="btn nav copy" data-copy="${h(loc.address || loc.name || '')}" aria-label="주소 복사">${icon.copy}</button>
    </div>`;
  const navTargets = [{ name: mc.location_name || myLoc.name, address: myAddr }, ...locs];

  const myCall = `
  <section class="section" id="sec-call">
    <div class="call-card">
      <div class="call-main">
        ${logChain(logOf(project), mc.time, 'on-dark')}
        <span class="call-label">${icon.camera} 촬영팀 도착</span>
        <div class="call-time-xl">${h(mc.time || '—')}${marks.myCall.time ? `<span class="badge chg">변경</span><span class="before">${h(marks.myCall.time)}</span>` : ''}</div>
        <div class="call-where">
          <strong>${h(mc.location_name || myLoc.name || '')}</strong>${marks.myCall.location ? badge({ type: 'changed', before: marks.myCall.location }) : ''}
          <span>${h(myAddr)}</span>${marks.myCall.address ? badge({ type: 'changed', before: marks.myCall.address }) : ''}
        </div>
        ${mc.note ? para(mc.note, 'call-note') : ''}
      </div>
      ${navBtns({ name: mc.location_name, address: myAddr }, 0)}
    </div>
    <div class="stats">
      <div class="stat"><span>촬영지</span><strong>${locs.length}곳</strong></div>
      <div class="stat ${a.moves?.length ? 'accent' : ''}"><span>로케이션 이동</span><strong>${a.moves?.length ? `${a.moves.length}회` : '없음'}</strong></div>
      <div class="stat"><span>종료 예정</span><strong>${h(a.wrap_time || '—')}</strong>${marks.wrap ? `<span class="badge chg">변경</span><span class="before">${h(marks.wrap)}</span>` : ''}</div>
      <div class="stat"><span>담당자</span><strong>${(a.contacts || []).length}명</strong></div>
    </div>
    ${a.briefing ? `<div class="card briefing" id="sec-brief"><div class="card-head">${icon.sparkle}<h2>브리핑</h2></div>${para(a.briefing)}</div>` : ''}
  </section>`;

  // --- 동선 (촬영지 + 이동)
  const moves = a.moves || [];
  const used = new Set();
  const n = (s) => String(s || '').replace(/\s/g, '');
  const moveFrom = (loc) => {
    const i = moves.findIndex((m, k) => !used.has(k) && n(m.from) && n(loc.name) && (n(m.from).includes(n(loc.name)) || n(loc.name).includes(n(m.from))));
    return i;
  };
  // 이동: "출발 → 도착" / 누가 / 메모 를 줄로 나눠 보여준다
  const moveBody = (m, withNote = false) => `
    <span class="mv-route">${h(m.from)} <i>→</i> ${h(m.to)}</span>
    ${m.who ? `<span class="mv-who">${h(m.who)}</span>` : ''}
    ${withNote && m.note ? `<span class="mv-note">${h(m.note)}</span>` : ''}`;
  let routeItems = '';
  locs.forEach((l, i) => {
    routeItems += `
    <li class="stop">
      <span class="stop-dot">${i + 1}</span>
      <div class="stop-body">
        <div class="stop-head"><strong>${h(l.name)}</strong>${badge(marks.locations.get(i))}</div>
        ${l.time_range ? `<span class="stop-time">${icon.clock}${h(l.time_range)}</span>` : ''}
        ${l.role ? `<span class="stop-role">${h(l.role)}</span>` : ''}
        <p class="stop-addr">${icon.pin}${h(l.address || '주소 없음')}</p>
        ${l.note ? para(l.note, 'stop-note') : ''}
        ${navBtns(l, i + 1)}
      </div>
    </li>`;
    let mi = moveFrom(l);
    if (mi < 0 && i < locs.length - 1 && moves[i] && !used.has(i)) mi = i;
    if (mi >= 0) {
      used.add(mi);
      const m = moves[mi];
      routeItems += `<li class="move"><span class="move-line"></span><div>${icon.truck}<strong>${h(m.time)}</strong> 이동 ${badge(marks.moves.get(mi))}${moveBody(m, true)}</div></li>`;
    }
  });
  moves.forEach((m, mi) => {
    if (used.has(mi)) return;
    routeItems += `<li class="move"><span class="move-line"></span><div>${icon.truck}<strong>${h(m.time)}</strong> 이동 ${badge(marks.moves.get(mi))}${moveBody(m)}</div></li>`;
  });
  const routeHtml = `
  <section class="section" id="sec-route">
    <h2 class="section-title">${icon.pin} 촬영지 · 동선</h2>
    <ol class="route">${routeItems || '<li class="empty-line">촬영지 정보가 없어요.</li>'}</ol>
  </section>`;

  // --- 콜타임
  const calls = a.call_times || [];
  const callsHtml = calls.length ? `
  <section class="section" id="sec-calls">
    <h2 class="section-title">${icon.users} 팀별 도착 시간</h2>
    <div class="calls">
      ${calls.map((c, i) => `
        <div class="call-row ${c.is_camera_team ? 'mine' : ''}">
          <span class="ct">${h(c.time)}</span>
          <span class="cn">${h(c.team)}${c.is_camera_team ? ' <i>내 팀</i>' : ''}${c.note || c.location_name ? `<small>${h([c.location_name, c.note].filter(Boolean).join(' · '))}</small>` : ''}</span>
          ${badge(marks.callTimes.get(i))}
        </div>`).join('')}
    </div>
  </section>` : '';

  // --- 진행표
  const sched = (a.schedule || []).map((s, i) => ({ ...s, i }));
  const tracks = [...new Set(sched.map((s) => s.track).filter((t) => t && t !== '전체'))];
  const kindClass = { 촬영: 'k-shoot', 포토: 'k-shoot', 세팅: 'k-set', 이동: 'k-move', 식사: 'k-meal', 휴식: 'k-meal', 교육: 'k-info', 종료: 'k-end', 기타: 'k-etc' };
  const schedHtml = sched.length ? `
  <section class="section" id="sec-sched">
    <div class="section-head">
      <h2 class="section-title">${icon.clock} 진행 타임라인</h2>
      <button class="conti-toggle" id="contiToggle" aria-pressed="false">${icon.camera}<span>콘티</span></button>
      ${tracks.length > 1 ? `<div class="seg" id="trackSeg"><button class="on" data-track="">전체</button>${tracks.map((t) => `<button data-track="${h(t)}">${h(t)}</button>`).join('')}</div>` : ''}
    </div>
    <p class="conti-status" id="contiStatus" hidden></p>
    <ol class="timeline">
      ${sched.map((s) => `
      <li class="tl ${kindClass[s.kind] || 'k-etc'}" data-track="${h(s.track)}" data-i="${s.i}">
        <div class="tl-time"><strong>${s.next_day ? '<i>익일</i>' : ''}${h(s.start)}</strong><span>${h(s.end)}</span></div>
        <div class="tl-body">
          <div class="tl-head"><span class="tl-kind">${h(s.kind)}</span>${tracks.length > 1 && s.track ? `<span class="tl-track">${h(s.track)}</span>` : ''}${s.minutes ? `<span class="tl-min">${s.minutes}분</span>` : ''}${badge(marks.schedule.get(s.i))}</div>
          <div class="tl-title">${titleLines(s.title)}</div>
          ${s.location_name ? `<span class="tl-loc">${h(s.location_name)}</span>` : ''}
          ${s.details ? para(s.details, 'tl-details') : ''}
          <div class="tl-conti" hidden></div>
        </div>
      </li>`).join('')}
    </ol>
  </section>` : '';

  // --- 체크사항
  const lv = { critical: [icon.alert, '필수'], important: [icon.star, '중요'], info: [icon.info, '참고'] };
  const checks = [...(a.checks || [])].map((c, i) => ({ ...c, i })).sort((x, y) => ['critical', 'important', 'info'].indexOf(x.level) - ['critical', 'important', 'info'].indexOf(y.level));
  const checksHtml = checks.length ? `
  <section class="section" id="sec-checks">
    <h2 class="section-title">${icon.flag} 체크사항</h2>
    <ul class="checks">
      ${checks.map((c) => `<li class="lv-${c.level}">${lv[c.level]?.[0] || ''}<span class="lv">${lv[c.level]?.[1] || ''}</span>${para(c.text, 'check-text')}${badge(marks.checks.get(c.i))}</li>`).join('')}
    </ul>
  </section>` : '';

  // --- 연락처
  const contacts = a.contacts || [];
  const contactsHtml = `
  <section class="section" id="sec-contacts">
    <h2 class="section-title">${icon.phone} 담당자 연락처</h2>
    ${contacts.length ? `<div class="contacts">
      ${contacts.map((c, i) => `
      <div class="contact">
        <div class="avatar">${h((c.name || '?').slice(0, 1))}</div>
        <div class="c-info"><strong>${h(c.name)} <span>${h(c.role)}</span>${badge(marks.contacts.get(i))}</strong>
          <span class="c-phone">${isPlaceholderPhone(c.phone) ? '번호 미정' : h(c.phone)}</span></div>
        ${isPlaceholderPhone(c.phone) ? '' : `<a class="round" href="${h(smsHref(c.phone))}" aria-label="문자">${icon.message}</a><a class="round primary" href="${h(telHref(c.phone))}" aria-label="전화">${icon.phone}</a>`}
      </div>`).join('')}
    </div>` : '<p class="muted">문서에 연락처가 없어요.</p>'}
  </section>`;

  // --- 원본 + 히스토리
  const historyHtml = `
  <section class="section" id="sec-orig">
    <h2 class="section-title">${icon.doc} 원본 타임테이블</h2>
    <div class="card original">
      ${rec.reduced ? `
      <div class="orig-full" id="origFull">
        <p class="muted small">원본이 커서(${Math.round(rec.reduced.originalSize / 1048576)}MB, ${rec.reduced.totalPages}쪽) 저장소에는 분석한 ${h(rec.reduced.pages.join(', '))}쪽만 올라가 있어요.</p>
        <div class="row-gap" id="origActions"><span class="muted small">원본 확인 중…</span></div>
        <input type="file" accept="application/pdf,.pdf" id="origPick" hidden>
      </div>` : ''}
      <div class="row-gap"><button class="btn ${rec.reduced ? 'ghost' : ''}" id="showPdf">${icon.doc} ${rec.reduced ? '분석한 페이지 보기' : '원본 페이지 보기'}</button><button class="btn ghost" id="openPdf">새 탭에서 PDF 열기</button></div>
      <p class="muted small">${h(meta.fileName)}</p>
      <div id="pdfPages" class="pdf-pages"></div>
    </div>
  </section>
  <section class="section">
    <h2 class="section-title">${icon.history} 버전 히스토리</h2>
    <ol class="history">
      ${[...versions].reverse().map((v) => `
      <li class="${v.id === meta.id ? 'on' : ''}">
        <a href="${L(space, pid, v.id)}">
          <div class="h-thumb"><img alt="" data-thumb="${h(pid)}/${h(v.id)}"></div>
          <div class="h-body">
            <strong>${h(v.label)} ${v.id === latest.id ? '<i class="tag">최신</i>' : ''}${v.id === meta.id ? '<i class="tag gray">보는 중</i>' : ''}</strong>
            <span>${h(relTime(v.uploadedAt))} · ${h(v.fileName)}</span>
            <span class="h-chg">${v === versions[0] ? '첫 버전' : v.changeCount ? `변경 ${v.changeCount}건${v.highChangeCount ? ` (중요 ${v.highChangeCount})` : ''}` : '변경 없음'}</span>
          </div>
        </a>
        ${canEdit(space) ? `<button class="del" data-del="${v.id}" aria-label="이 버전 삭제">${icon.trash}</button>` : ''}
      </li>`).join('')}
    </ol>
  </section>`;

  // --- 내 시간 기록 + 업무 공유
  const entries = logOf(project);
  const logHtml = canEdit(space) || entries.length ? `
  <section class="section" id="sec-log">
    <div class="card log-card">
      <div class="card-head">${icon.clock}<h2>내 시간 기록</h2></div>
      ${entries.length ? `<ol class="log-list">${entries.map((e, k) => `
        <li><button type="button" ${canEdit(space) ? `data-log-edit="${k}"` : 'disabled'}><b>${h(e.time)}</b><span>${h(e.label)}</span>${canEdit(space) ? icon.chevron : ''}</button></li>`).join('')}</ol>`
        : '<p class="muted small">장소를 옮길 때마다 기록을 남겨 두세요. 예: 장비집 집합, 현장 도착, 현장 종료</p>'}
      <div class="log-actions">
        ${canEdit(space) ? `<button type="button" class="btn" data-log-add>+ 기록 추가</button>` : ''}
        <button type="button" class="btn ghost" data-share-work>${icon.copy} 업무 공유</button>
      </div>
    </div>
  </section>` : '';

  // --- 바로가기 (있는 칸만)
  const jumps = [
    ['sec-log', '기록', logHtml], ['sec-changes', '변경', changesHtml], ['sec-call', '도착', myCall], ['sec-brief', '브리핑', a.briefing],
    ['sec-route', '동선', routeHtml], ['sec-calls', '팀별', callsHtml], ['sec-sched', '진행표', schedHtml], ['sec-checks', '체크', checksHtml],
    ['sec-contacts', '연락처', contactsHtml], ['sec-orig', '원본', historyHtml],
  ].filter(([, , has]) => has);
  const jumpBar = `<nav class="jump-bar" aria-label="바로가기"><div class="jump-scroll">${jumps.map(([id, label]) => `<a href="#${id}" data-jump="${id}">${label}</a>`).join('')}</div></nav>`;

  app.innerHTML = shell(hero + switcher + jumpBar + logHtml + changesHtml + myCall + routeHtml + callsHtml + schedHtml + checksHtml + contactsHtml + historyHtml);
  bindJumpBar();
  hydrateThumbs(lib);
  $$('[data-log-add]').forEach((b) => b.addEventListener('click', () => openLogSheet(lib, project, null)));
  $$('[data-log-edit]').forEach((b) => b.addEventListener('click', () => openLogSheet(lib, project, Number(b.dataset.logEdit))));
  $('[data-share-work]')?.addEventListener('click', () => openShareSheet(lib, project, a, canEdit(space)));

  // 이벤트
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const loc = navTargets[Number(b.dataset.loc)] || {};
    if (!loc.address && !loc.name) return toast('주소 정보가 없어요');
    b.dataset.nav === 'naver' ? openNaver(loc) : openKakao(loc, kakaoKey(), toast);
  }));
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => toast((await copyText(b.dataset.copy)) ? '주소를 복사했어요' : '복사하지 못했어요')));
  $$('#trackSeg button').forEach((b) => b.addEventListener('click', () => {
    $$('#trackSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.timeline .tl').forEach((li) => { li.hidden = !!b.dataset.track && li.dataset.track !== b.dataset.track && li.dataset.track !== '전체'; });
  }));

  let pdfCache = null;
  const getPdfBlob = async () => (pdfCache ||= await lib.getPdf(pid, meta.id));
  // --- 진행표 콘티 그림 (원본 PDF에서 같은 시간 줄의 그림을 잘라 보여줌)
  let contiState = null; // null | 'loading' | 'done'
  const contiOn = () => { try { return localStorage.getItem(CONTI_KEY) !== 'off'; } catch { return true; } };
  const setContiVisible = (on) => {
    $('#contiToggle')?.setAttribute('aria-pressed', String(on));
    $$('.tl-conti').forEach((el) => { el.hidden = !on || !el.childElementCount; });
  };
  const contiStatus = (html) => { const el = $('#contiStatus'); if (el) { el.hidden = !html; el.innerHTML = html || ''; } };
  // 항목별 콘티: ① 저장된 Claude 결과 ② (편집 가능 + Claude 키) Claude로 새로 맞춰 저장 ③ 규칙(시간 줄) 방식
  const contiMatches = async (pdf, force = false) => {
    if (rec.contiAI && !force) return mapFromAI(rec.contiAI);
    // 큰 PDF를 줄여 저장한 경우엔 원본에서 미리 뽑아 둔 위치를 쓴다 (줄인 PDF엔 글자·그림 정보가 없음)
    const ext = rec.conti?.rows ? { rows: rec.conti.rows, boxes: rec.conti.boxes || rec.conti.rows.flatMap((r) => r.images) } : await extractConti(pdf);
    if (!(canEdit(space) && settings.anthropicKey && ext.boxes.length && a.schedule?.length)) return matchSchedule(a.schedule, ext.rows);
    try {
      contiStatus(`${icon.sparkle} Claude가 진행표에 맞는 콘티를 찾는 중… (1분 정도)`);
      const seen = new Set();
      const boxes = ext.boxes
        .filter((b) => { const k = `${b.page}:${Math.round(b.x)}:${Math.round(b.y)}:${Math.round(b.w)}`; return !seen.has(k) && seen.add(k); })
        .map((b, k) => ({ n: k + 1, page: b.page, x: b.x, y: b.y, w: b.w, h: b.h }));
      const images = await annotatedImages(pdf, boxes);
      const { data } = await matchConti(settings.anthropicKey, { images, schedule: a.schedule, boxCount: boxes.length });
      const assign = {};
      for (const x of data.assignments || []) if (x.item >= 0 && x.item < a.schedule.length && x.box >= 1 && x.box <= boxes.length) assign[x.box] = x.item;
      rec.contiAI = { boxes, assign, at: new Date().toISOString() };
      lib.saveVersion(pid, meta.id, rec, `콘티 맞추기: ${project.title} ${meta.label}`).catch((err) => console.warn('콘티 결과 저장 실패', err));
      return mapFromAI(rec.contiAI);
    } catch (err) {
      console.warn('Claude 콘티 맞추기 실패', err);
      toast('Claude로 콘티를 맞추지 못해 기본 방식으로 보여줘요');
      return matchSchedule(a.schedule, ext.rows);
    }
  };
  const loadConti = async (force = false) => {
    if (contiState && !force) return setContiVisible(true);
    if (contiState === 'loading') return;
    contiState = 'loading';
    const btn = $('#contiToggle');
    btn?.classList.add('busy');
    if (force) $$('.tl-conti').forEach((el) => { el.innerHTML = ''; el.hidden = true; });
    try {
      const pdf = await openPdf(await (await getPdfBlob()).arrayBuffer());
      const found = await contiMatches(pdf, force);
      contiStatus(rec.contiAI && canEdit(space) ? `${icon.sparkle} Claude가 진행표에 맞춘 콘티예요 · <button type="button" data-conti-redo>다시 맞추기</button>` : '');
      if (!found.size) { toast('이 타임테이블에서는 콘티 그림을 찾지 못했어요'); contiState = 'done'; return; }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const thumb = thumbRenderer(pdf);
      // 자리부터 모두 만들고 그림은 위에서부터 채운다
      for (const [i, row] of found) {
        const box = $(`.tl[data-i="${i}"] .tl-conti`);
        if (!box) continue;
        box.innerHTML = row.images.map((_, k) => `<button type="button" class="conti-thumb" data-k="${k}" aria-label="콘티 크게 보기"></button>`).join('');
        box.hidden = !contiOn();
        box.addEventListener('click', (e) => {
          const t = e.target.closest('.conti-thumb');
          if (t) openContiViewer(pdf, row, Number(t.dataset.k));
        });
      }
      for (const [i, row] of found) {
        const box = $(`.tl[data-i="${i}"] .tl-conti`);
        if (!box) continue;
        for (const [k, b] of row.images.entries()) {
          const img = new Image();
          img.alt = '';
          img.src = URL.createObjectURL(await thumb(b.page, b, 96 * dpr));
          box.querySelector(`[data-k="${k}"]`)?.appendChild(img);
        }
      }
      contiState = 'done';
    } catch (err) {
      console.error(err);
      contiStatus('');
      toast('콘티 그림을 불러오지 못했어요');
      contiState = null;
    } finally {
      btn?.classList.remove('busy');
    }
  };
  $('#contiStatus')?.addEventListener('click', (e) => { if (e.target.closest('[data-conti-redo]')) loadConti(true); });
  $('#contiToggle')?.addEventListener('click', () => {
    const on = $('#contiToggle').getAttribute('aria-pressed') !== 'true';
    try { localStorage.setItem(CONTI_KEY, on ? 'on' : 'off'); } catch {}
    if (on) loadConti(); else setContiVisible(false);
  });
  // 켜 둔 상태면 진행표가 화면 가까이 왔을 때 불러온다 (데이터 절약)
  if ($('.timeline') && contiOn()) {
    $('#contiToggle').setAttribute('aria-pressed', 'true');
    const io = new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting)) { io.disconnect(); loadConti(); }
    }, { rootMargin: '300px' });
    io.observe($('.timeline'));
  }

  $('#showPdf').addEventListener('click', async (e) => {
    const box = $('#pdfPages');
    if (box.childElementCount) { box.innerHTML = ''; e.currentTarget.innerHTML = `${icon.doc} 원본 페이지 보기`; return; }
    e.currentTarget.textContent = '불러오는 중…';
    try {
      const blob = await getPdfBlob();
      const pdf = await openPdf(await blob.arrayBuffer());
      await renderPagesInto(pdf, box, Math.min(2400, box.clientWidth * (window.devicePixelRatio || 1) * 1.5));
      e.currentTarget.innerHTML = `${icon.doc} 원본 접기`;
    } catch (err) {
      toast('PDF를 불러오지 못했어요');
      e.currentTarget.innerHTML = `${icon.doc} 원본 페이지 보기`;
    }
  });
  // 큰 원본: 이 기기에 보관돼 있으면 열기, 없으면 받은 파일을 골라 보관
  if (rec.reduced) {
    const key = `${space}/${pid}/${meta.id}`;
    const actions = $('#origActions');
    const showState = async () => {
      const has = await originals.get(key);
      actions.innerHTML = has
        ? `<button class="btn" id="origOpen">${icon.doc} 원본 PDF 열기 (${rec.reduced.totalPages}쪽 전체)</button>`
        : `<button class="btn" id="origChoose">${icon.upload} 원본 파일 선택</button><span class="muted small">이 기기엔 원본이 없어요. 받은 원본 파일을 한 번 고르면 이 기기에 보관돼요.</span>`;
      $('#origOpen')?.addEventListener('click', async () => {
        const w = window.open('', '_blank'); // 팝업 차단을 피하려고 누른 순간 먼저 연다
        const blob = await originals.get(key);
        if (!blob) { w?.close(); toast('원본을 찾지 못했어요'); return showState(); }
        const url = URL.createObjectURL(blob);
        if (w) w.location.href = url; else location.href = url;
      });
      $('#origChoose')?.addEventListener('click', () => $('#origPick').click());
    };
    $('#origPick').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (Math.abs(f.size - rec.reduced.originalSize) > 1024) toast('올렸던 원본과 크기가 달라요. 같은 파일인지 확인하세요');
      actions.innerHTML = '<span class="muted small">이 기기에 보관하는 중…</span>';
      try { await originals.put(key, f); toast('원본을 이 기기에 보관했어요'); } catch { toast('보관하지 못했어요 (기기 저장 공간을 확인하세요)'); }
      showState();
    });
    showState();
  }
  $('#openPdf').addEventListener('click', async () => {
    const w = window.open('', '_blank');
    const blob = await getPdfBlob();
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (w) w.location.href = url; else location.href = url;
  });
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!b.classList.contains('confirm')) {
      b.classList.add('confirm');
      b.innerHTML = '삭제?';
      setTimeout(() => { b.classList.remove('confirm'); b.innerHTML = icon.trash; }, 3000);
      return;
    }
    b.disabled = true;
    await lib.deleteVersion(pid, b.dataset.del);
    originals.remove(`${space}/${pid}/${b.dataset.del}`);
    toast('버전을 삭제했어요');
    if (lib.project(pid)) {
      if (b.dataset.del === meta.id) location.hash = L(space, pid); else route();
    } else location.hash = L(space);
  }));
}

// ---------------------------------------------------------------- 시간 작성 팝업
// 바로가기 바: 누르면 그 칸으로, 스크롤하면 지금 보는 칸 표시
function bindJumpBar() {
  const bar = $('.jump-bar');
  if (!bar) return;
  const links = $$('[data-jump]', bar);
  bar.addEventListener('click', (e) => {
    const a = e.target.closest('[data-jump]');
    if (!a) return;
    e.preventDefault(); // 주소(#/s/...)는 라우터가 쓰므로 해시를 바꾸지 않는다
    const target = document.getElementById(a.dataset.jump);
    if (!target) return;
    const y0 = window.scrollY;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 부드러운 스크롤이 안 먹는 환경(절전·접근성 설정 등)이면 바로 이동
    setTimeout(() => { if (Math.abs(window.scrollY - y0) < 2) target.scrollIntoView({ block: 'start' }); }, 350);
  });
  const setOn = (id) => {
    links.forEach((l) => l.classList.toggle('on', l.dataset.jump === id));
    const on = links.find((l) => l.dataset.jump === id);
    if (on) {
      const sc = $('.jump-scroll', bar);
      sc.scrollTo({ left: on.offsetLeft - sc.clientWidth / 2 + on.offsetWidth / 2, behavior: 'smooth' });
    }
  };
  const onScroll = () => {
    const top = bar.getBoundingClientRect().bottom + 24;
    let cur = links[0]?.dataset.jump;
    for (const l of links) {
      const el = document.getElementById(l.dataset.jump);
      if (el && el.getBoundingClientRect().top <= top) cur = l.dataset.jump;
    }
    if (bar.dataset.on !== cur) { bar.dataset.on = cur; setOn(cur); }
  };
  let raf = 0;
  const handler = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!bar.isConnected) return window.removeEventListener('scroll', handler); onScroll(); }); };
  window.addEventListener('scroll', handler, { passive: true });
  onScroll();
}

const LOG_PRESETS = ['사무실 집합', '장비집 집합', '장비집 출발', '현장 도착', '현장 출발', '현장 종료', '장비집 도착', '업무 종료'];
const nowHM = () => new Date().toTimeString().slice(0, 5);

// 시간 기록 추가/수정 (index가 null이면 새로 추가)
function openLogSheet(lib, project, index) {
  const entries = logOf(project).map((e) => ({ ...e }));
  const cur = index == null ? null : entries[index];
  // 같은 이름이 이미 있으면 번호를 붙여 제안 ("현장 도착" → "현장2 도착")
  const suggest = (base) => {
    const [place, act] = base.split(' ');
    const re = new RegExp(`^${place}\\d*\\s*${act}$`);
    const n = entries.filter((e) => re.test(e.label)).length;
    return n ? `${place}${n + 1} ${act}` : base;
  };
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `
  <form class="sheet log-sheet form" autocomplete="off">
    <p class="eyebrow">${h(project.title)}</p>
    <h2>${cur ? '기록 고치기' : '시간 기록'}</h2>
    <div class="log-presets">${LOG_PRESETS.map((t) => `<button type="button" data-preset="${h(t)}">${h(suggest(t))}</button>`).join('')}</div>
    <label>무엇을 했나요<input name="label" value="${h(cur?.label || '')}" placeholder="예: 장비집2 집합" maxlength="30"></label>
    <label>시간<input type="time" name="time" value="${h(cur?.time || nowHM())}" required></label>
    <div class="sheet-actions">
      ${cur ? '<button type="button" class="btn ghost danger" data-del>지우기</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-cancel>취소</button>
      <button type="submit" class="btn">저장</button>
    </div>
  </form>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  const form = $('form', el);
  const label = $('input[name=label]', form);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-cancel]')) return close();
    const b = e.target.closest('[data-preset]');
    if (b) { label.value = b.textContent; label.focus(); }
  });
  const save = async (next, msg) => {
    $$('button', form).forEach((b) => (b.disabled = true));
    try {
      await lib.setLog(project.id, next);
      close();
      toast(msg);
      route();
    } catch (err) {
      toast(err.status === 403 || err.status === 404 ? '저장 권한이 없어요' : err.message);
      $$('button', form).forEach((b) => (b.disabled = false));
    }
  };
  $('[data-del]', form)?.addEventListener('click', () => save(entries.filter((_, k) => k !== index), '기록을 지웠어요'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    if (!v.label.trim()) return toast('무엇을 했는지 적어 주세요');
    const item = { id: cur?.id || Date.now().toString(36), label: v.label.trim(), time: v.time };
    if (cur) entries[index] = item; else entries.push(item);
    save(entries, '기록했어요');
  });
}

// 업무 공유 (카톡용): 제목 / 빈 줄 / 날짜 요일 / 이동 경로 / 집합~종료 / 견적
const CITY_ALIAS_KEY = 'shoot-briefing.cityAlias';
const toMin = (t) => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function openShareSheet(lib, project, a, editable) {
  const prev = project.share || {};
  const entries = logOf(project);
  const findLog = (re, last = false) => { const list = entries.filter((e) => re.test(e.label)); return (last ? list[list.length - 1] : list[0])?.time || ''; };
  // 주소의 시·군 이름 → 내가 고쳐 쓴 이름 (예: 고양 → 일산)을 기억해 다음부터 자동 적용
  let alias = {};
  try { alias = JSON.parse(localStorage.getItem(CITY_ALIAS_KEY) || '{}'); } catch {}
  const cities = (a.locations || []).map((l) => cityOf(l.address) || '').filter(Boolean).filter((c, i, arr) => c !== arr[i - 1]);
  const routeAuto = cities.map((c) => alias[c] || c).join('>');
  const wrap = String(a.wrap_time || '').match(/\d{1,2}:\d{2}/)?.[0] || '';
  let lastPrice = '';
  try { lastPrice = localStorage.getItem(LAST_PRICE_KEY) || ''; } catch {}
  const [, mm, dd] = (project.date || '').split('-').map(Number);
  const v0 = {
    title: prev.title || a.production?.project_title || project.title,
    date: prev.date || (project.date ? `${mm}/${dd} ${project.weekday || '일월화수목금토'[new Date(project.date + 'T00:00:00').getDay()]}` : ''),
    route: prev.route || routeAuto,
    start: prev.start || findLog(/현장\d*\s*(집합|도착)/) || a.my_call?.time || '',
    end: prev.end || findLog(/(현장\d*|촬영)\s*종료/, true) || wrap,
    fee: prev.fee || lastPrice,
  };
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `
  <form class="sheet share-sheet form" autocomplete="off">
    <p class="eyebrow">업무 공유</p>
    <h2>업무 시간 보내기</h2>
    <div class="share-times">
      <label>현장 집합<input type="time" name="start" value="${h(v0.start)}"></label>
      <label>현장 종료<input type="time" name="end" value="${h(v0.end)}"></label>
    </div>
    <label class="q-price">견적<span class="won-input"><input name="fee" inputmode="numeric" value="${h(v0.fee ? won(v0.fee) : '')}" placeholder="예: 550,000"><em>원</em></span></label>
    <details class="q-more">
      <summary>제목 · 날짜 · 이동 경로 ${icon.chevron}</summary>
      <label>제목<input name="title" value="${h(v0.title)}"></label>
      <label>날짜<input name="date" value="${h(v0.date)}"></label>
      <label>이동 경로 <span class="opt">">"로 구분</span><input name="route" value="${h(v0.route)}" placeholder="예: 용인>일산"></label>
    </details>
    <label>보낼 내용<textarea name="msg" rows="6"></textarea></label>
    <div class="sheet-actions">
      <button type="button" class="btn ghost" data-cancel>닫기</button>
      <span class="spacer"></span>
      ${navigator.share ? `<button type="button" class="btn ghost" data-share>${icon.upload} 공유</button>` : ''}
      <button type="submit" class="btn">${icon.copy} 복사</button>
    </div>
  </form>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  const form = $('form', el);
  const msg = $('textarea[name=msg]', form);
  let edited = false;
  // 자정을 넘기면 25:20처럼 24를 더해 적는다
  const endText = (start, end) => {
    const s = toMin(start), e = toMin(end);
    if (s == null || e == null || e >= s) return end;
    return `${Math.floor(e / 60) + 24}:${String(e % 60).padStart(2, '0')}`;
  };
  const build = () => {
    const v = Object.fromEntries(new FormData(form));
    const fee = digits(v.fee);
    return [v.title.trim(), '', v.date.trim(), v.route.trim(), v.start || v.end ? `${v.start}~${endText(v.start, v.end)}` : '', fee ? `견적 ${won(fee)}` : '']
      .filter((line, i) => i < 2 || line).join('\n');
  };
  const refresh = () => { if (!edited) msg.value = build(); };
  form.addEventListener('input', (e) => {
    if (e.target === msg) { edited = true; return; }
    if (e.target.name === 'fee') { const d = digits(e.target.value); e.target.value = d ? won(d) : ''; }
    refresh();
  });
  refresh();
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-cancel]')) close(); });
  const remember = () => {
    const v = Object.fromEntries(new FormData(form));
    const share = { title: v.title.trim(), date: v.date.trim(), route: v.route.trim(), start: v.start, end: v.end, fee: digits(v.fee) };
    if (editable && JSON.stringify(share) !== JSON.stringify(project.share || {})) lib.setShare(project.id, share).then(() => { project.share = share; }).catch(() => {});
    const typed = share.route.split('>').map((x) => x.trim());
    if (typed.length === cities.length) {
      cities.forEach((c, i) => { if (typed[i] && typed[i] !== c) alias[c] = typed[i]; else if (typed[i] === c) delete alias[c]; });
      try { localStorage.setItem(CITY_ALIAS_KEY, JSON.stringify(alias)); } catch {}
    }
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    remember();
    toast((await copyText(msg.value)) ? '복사했어요 · 카톡에 붙여넣기 하세요' : '복사하지 못했어요');
  });
  $('[data-share]', form)?.addEventListener('click', async () => {
    remember();
    try { await navigator.share({ text: msg.value }); } catch (err) { if (err.name !== 'AbortError') toast('공유하지 못했어요'); }
  });
}

// ---------------------------------------------------------------- 견적서
const LAST_PRICE_KEY = 'shoot-briefing.lastPrice';
const won = (n) => (Number(n) || 0).toLocaleString('ko-KR');
const digits = (s) => String(s || '').replace(/[^\d]/g, '');

const SOURCE_KEY = 'shoot-briefing.source';
function loadLocalSource() { try { return JSON.parse(localStorage.getItem(SOURCE_KEY) || 'null'); } catch { return null; } }
function storeLocalSource(src) { try { localStorage.setItem(SOURCE_KEY, JSON.stringify(src)); } catch {} }

async function openQuoteSheet() {
  const space = mySpace();
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = '<div class="sheet quote-sheet"><div class="skeleton"></div></div>';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-cancel]')) close(); });
  const box = $('.sheet', el);

  let lib;
  try { lib = await getLibrary(space); } catch (err) { close(); return toast(err.message); }
  const projects = lib.index.projects.filter((p) => p.date).sort((a, b) => b.date.localeCompare(a.date));
  const selected = new Set();

  // 1단계: 일정 고르기
  const renderPick = () => {
    const today = new Date().toISOString().slice(0, 10);
    box.innerHTML = `
      <p class="eyebrow">견적서 만들기 · 1/2</p>
      <h2>어떤 일정인가요?</h2>
      <p class="muted small">여러 날 촬영은 함께 골라 주세요. 하루씩 DAY1, DAY2…로 들어가요.</p>
      ${projects.length ? `<div class="q-list">${projects.map((p) => {
        const [, m, d] = p.date.split('-').map(Number);
        return `<label class="q-item ${selected.has(p.id) ? 'on' : ''}">
          <input type="checkbox" value="${h(p.id)}" ${selected.has(p.id) ? 'checked' : ''}>
          <span class="q-date"><b>${m}.${d}</b><small>${h(p.weekday || '')}</small></span>
          <span class="q-body"><strong>${h(p.title)}</strong><small>${h(p.production || '')}${p.date > today ? ' · 예정' : ''}</small></span>
          ${icon.check}
        </label>`;
      }).join('')}</div>` : '<p class="empty small">아직 올린 촬영이 없어요.</p>'}
      <div class="sheet-actions">
        <button type="button" class="btn ghost" data-cancel>취소</button>
        <button type="button" class="btn" data-next disabled>다음</button>
      </div>`;
    const next = $('[data-next]', box);
    const sync = () => {
      next.disabled = !selected.size;
      next.textContent = selected.size ? `${selected.size}일 선택 · 다음` : '다음';
    };
    $$('.q-item input', box).forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked && selected.size >= MAX_DAYS) { cb.checked = false; return toast(`한 견적서에는 ${MAX_DAYS}일까지 넣을 수 있어요`); }
      cb.checked ? selected.add(cb.value) : selected.delete(cb.value);
      cb.closest('.q-item').classList.toggle('on', cb.checked);
      sync();
    }));
    sync();
    next.addEventListener('click', () => renderForm().catch((err) => toast(err.message)));
  };

  // 2단계: 금액·내용 입력 → 다운로드 / 최종 문구
  const renderForm = async () => {
    box.innerHTML = '<div class="skeleton"></div>';
    const chosen = projects.filter((p) => selected.has(p.id)).sort((a, b) => a.date.localeCompare(b.date));
    const analyses = await Promise.all(chosen.map((p) => lib.getVersion(p.id, lib.latest(p).id).then((r) => r?.analysis).catch(() => null)));
    let lastPrice = '';
    try { lastPrice = localStorage.getItem(LAST_PRICE_KEY) || ''; } catch {}
    const first = chosen[0];
    const prof = settings.quoteProfile || null;
    let source = loadLocalSource();
    let sourceChanged = false;
    const [remoteProfile, remoteSource] = await Promise.all([
      prof ? false : hasSavedProfile(lib.store).catch(() => false),
      source ? false : hasSavedSource(lib.store).catch(() => false),
    ]);
    const savedRemote = remoteProfile || remoteSource;
    const profileFields = (p = {}) => `
      <label>이름<input name="name" value="${h(p.name || displayName(settings.userId) || '')}" autocomplete="off"></label>
      <label>원천 (주민번호 + 주소)<input name="idAddr" value="${h(p.idAddr || '')}" autocomplete="off" placeholder="000000-0000000 서울시 …"></label>
      <label>전화번호<input name="phone" value="${h(p.phone || '')}" inputmode="tel" autocomplete="off" placeholder="010-0000-0000"></label>
      <label>입금 계좌<input name="bank" value="${h(p.bank || '')}" autocomplete="off" placeholder="은행 계좌번호"></label>`;
    const sourceHtml = () => source
      ? `<img class="q-src-img" src="${sourceDataUrl(source)}" alt="원천자료"><button type="button" class="btn ghost" data-src-pick>다른 이미지로 바꾸기</button>`
      : `<button type="button" class="btn ghost" data-src-pick>${icon.upload} 이미지 선택</button>`;

    box.innerHTML = `
      <form class="form" autocomplete="off">
        <p class="eyebrow">견적서 만들기 · 2/2</p>
        <h2>견적 금액</h2>
        <div class="q-days">${chosen.map((p, i) => `
          <div class="q-day">
            <div class="q-day-head"><b>DAY${i + 1}</b><span>${h(prettyDate(p.date, p.weekday))}</span></div>
            <label class="q-price">공급가액<span class="won-input"><input name="price" inputmode="numeric" placeholder="예: 500,000" value="${h(lastPrice ? won(lastPrice) : '')}"><em>원</em></span></label>
            <label>내용<input name="content" value="${h(defaultContent(p.date, analyses[i]))}"></label>
          </div>`).join('')}
        </div>
        <p class="q-total">합계 <b id="qTotal">0</b>원</p>

        <details class="q-more">
          <summary>수신 · 품목 · 품명 ${icon.chevron}</summary>
          <label>수신 (프로덕션)<input name="to" value="${h(first.production || '')}"></label>
          <label>품목 (촬영 이름)<input name="title" value="${h(first.title || '')}"></label>
          <label>품명<input name="item" value="${h(DEFAULT_ITEM)}"></label>
        </details>

        <details class="q-more" ${prof ? '' : 'open'}>
          <summary>내 정보 · 원천자료 ${prof ? `<span class="q-saved">${icon.check} 저장됨</span>` : ''} ${icon.chevron}</summary>
          ${savedRemote ? `<p class="muted small" id="qRemoteHint">저장된 내 정보가 있어요. 비밀번호를 넣고 불러오세요.</p>` : ''}
          <div id="qProfile">${profileFields(prof || {})}</div>
          <div class="q-src">
            <span class="q-src-label">원천자료 이미지 <span class="opt">신분증·통장 사본</span></span>
            <div id="qSource">${sourceHtml()}</div>
            <input type="file" accept="image/*" id="qSourceFile" hidden>
          </div>
          <label>내 비밀번호 <span class="opt">${savedRemote ? '불러오기 · ' : ''}정보를 저장할 때만</span>
            <span class="unlock-inline"><input type="password" name="pw" autocomplete="current-password">${savedRemote ? '<button type="button" class="btn ghost" data-unlock>불러오기</button>' : ''}</span></label>
          <p class="muted small">개인정보와 원천자료는 내 비밀번호로 암호화해 저장돼요. 다른 사람은 열어볼 수 없어요.</p>
        </details>

        <div class="sheet-actions q-actions">
          <button type="button" class="btn ghost" data-back>이전</button>
          <span class="spacer"></span>
          <button type="button" class="btn ghost" data-download>견적서 다운로드</button>
          <button type="submit" class="btn">최종 문구 생성</button>
        </div>
      </form>`;
    const form = $('form', box);
    const prices = $$('input[name=price]', form);
    const updateTotal = () => { $('#qTotal', form).textContent = won(prices.reduce((s, x) => s + Number(digits(x.value)), 0)); };
    prices.forEach((inp, i) => inp.addEventListener('input', () => {
      const v = digits(inp.value);
      inp.value = v ? won(v) : '';
      // 첫날 금액을 넣으면 아직 손대지 않은 다른 날에도 같은 금액을 채운다
      if (i === 0) prices.slice(1).forEach((x) => { if (!x.dataset.touched) x.value = inp.value; });
      else inp.dataset.touched = '1';
      updateTotal();
    }));
    updateTotal();
    prices[0].focus();
    $('[data-back]', form).addEventListener('click', renderPick);

    // 원천자료 이미지 고르기
    const fileInput = $('#qSourceFile', form);
    form.addEventListener('click', (e) => { if (e.target.closest('[data-src-pick]')) fileInput.click(); });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      try {
        source = await prepareSourceImage(f);
        sourceChanged = true;
        $('#qSource', form).innerHTML = sourceHtml();
        toast('비밀번호를 넣고 진행하면 원천자료가 저장돼요');
      } catch { toast('이미지를 읽지 못했어요'); }
    });

    const pwInput = $('input[name=pw]', form);
    $('[data-unlock]', form)?.addEventListener('click', async (e) => {
      const b = e.target;
      b.disabled = true;
      try {
        const [p, src] = await Promise.all([
          remoteProfile ? loadProfile(lib.store, settings.userId, pwInput.value) : null,
          remoteSource ? loadSource(lib.store, settings.userId, pwInput.value) : null,
        ]);
        if (p) { saveSettings({ quoteProfile: p }); $('#qProfile', form).innerHTML = profileFields(p); }
        if (src) { source = src; storeLocalSource(src); $('#qSource', form).innerHTML = sourceHtml(); }
        b.remove();
        $('#qRemoteHint', form)?.remove();
        toast('내 정보를 불러왔어요');
      } catch {
        toast('비밀번호가 올바르지 않아요');
        b.disabled = false;
      }
    });

    // 입력 확인 → (바뀐 정보 저장) → 엑셀 만들기
    const prepare = async () => {
      const v = Object.fromEntries(new FormData(form));
      const profile = { name: v.name.trim(), idAddr: v.idAddr.trim(), phone: v.phone.trim(), bank: v.bank.trim() };
      const priceList = prices.map((x) => Number(digits(x.value)));
      if (priceList.some((n) => !n)) throw new Error('모든 날의 금액을 입력하세요');
      if (!profile.name) throw new Error('이름을 입력하세요');
      const profileChanged = JSON.stringify(profile) !== JSON.stringify(settings.quoteProfile || null);
      let unsaved = (profileChanged || sourceChanged) && !v.pw;
      if ((profileChanged || sourceChanged) && v.pw) {
        try { await login(settings.userId, v.pw); } catch { throw new Error('비밀번호가 올바르지 않아요'); } // 틀린 비밀번호로 암호화하지 않도록
        if (profileChanged) { await saveProfile(lib.store, settings.userId, v.pw, profile); saveSettings({ quoteProfile: profile }); }
        if (sourceChanged && source) { await saveSource(lib.store, settings.userId, v.pw, source); storeLocalSource(source); sourceChanged = false; }
      }
      const contents = $$('input[name=content]', form).map((x) => x.value.trim());
      const dates = chosen.map((p) => p.date);
      const title = v.title.trim();
      const blob = await buildQuote({
        dates, to: v.to.trim(), title, profile,
        days: chosen.map((p, i) => ({ item: v.item.trim(), content: contents[i], price: priceList[i] })),
      });
      try { localStorage.setItem(LAST_PRICE_KEY, String(priceList[0])); } catch {}
      return { blob, fileName: quoteFileName(dates, title, profile.name), dates, title, profile, unsaved };
    };
    const run = async (btn, then) => {
      const label = btn.textContent;
      $$('.q-actions button', form).forEach((b) => (b.disabled = true));
      btn.textContent = '만드는 중…';
      try {
        await then(await prepare());
      } catch (err) {
        console.error(err);
        toast(err.message);
        $$('.q-actions button', form).forEach((b) => (b.disabled = false));
        btn.textContent = label;
      }
    };
    $('[data-download]', form).addEventListener('click', (e) => run(e.currentTarget, (r) => {
      downloadBlob(r.blob, r.fileName);
      close();
      toast(r.unsaved ? '견적서를 받았어요 · 비밀번호를 넣으면 내 정보가 저장돼요' : '견적서를 받았어요');
    }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      run($('button[type=submit]', form), (r) => renderFinal(r));
    });
  };

  // 3단계: PD에게 보낼 최종 문구 + 견적서·원천자료 공유
  const renderFinal = ({ blob, fileName, dates, title, profile, unsaved }) => {
    const source = loadLocalSource();
    const xlsx = new File([blob], fileName, { type: blob.type });
    const files = [xlsx, ...(source ? [sourceFile(source, profile.name)] : [])];
    const canShareFiles = !!navigator.canShare?.({ files });
    box.innerHTML = `
      <div class="form">
        <p class="eyebrow">최종 문구</p>
        <h2>PD님께 보낼 내용</h2>
        <div class="q-files">
          <div class="q-file">${icon.doc}<span>${h(fileName)}</span></div>
          ${source ? `<div class="q-file q-file-img"><img src="${sourceDataUrl(source)}" alt=""><span>원천자료 이미지</span></div>` : `<p class="muted small">원천자료 이미지가 없어요. 이전 화면의 "내 정보 · 원천자료"에서 넣을 수 있어요.</p>`}
        </div>
        <label>메시지<textarea name="msg" rows="4">${h(finalMessage({ dates, title, name: profile.name, withSource: !!source }))}</textarea></label>
        <div class="q-final-actions">
          ${canShareFiles ? `<button type="button" class="btn block" data-share>${icon.upload} 카톡 등으로 공유 (문구 자동 복사)</button>` : ''}
          <button type="button" class="btn ${canShareFiles ? 'ghost' : ''} block" data-copy-msg>${icon.copy} 문구 복사</button>
          <div class="row-gap">
            <button type="button" class="btn ghost" data-dl-xlsx>견적서 받기</button>
            ${source ? '<button type="button" class="btn ghost" data-dl-src>원천자료 받기</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn ghost" data-cancel>닫기</button>
          </div>
        </div>
        ${canShareFiles ? '<p class="muted small">카카오톡은 파일과 글을 함께 보내면 글이 빠질 수 있어요. 파일을 보낸 뒤 채팅창에 붙여넣기 하세요.</p>' : ''}
      </div>`;
    if (unsaved) toast('비밀번호를 넣지 않아 내 정보는 저장되지 않았어요');
    const msg = () => $('textarea[name=msg]', box).value;
    $('[data-copy-msg]', box).addEventListener('click', async () => toast((await copyText(msg())) ? '문구를 복사했어요' : '복사하지 못했어요'));
    $('[data-dl-xlsx]', box).addEventListener('click', () => downloadBlob(blob, fileName));
    $('[data-dl-src]', box)?.addEventListener('click', () => downloadBlob(files[1], files[1].name));
    $('[data-share]', box)?.addEventListener('click', async () => {
      await copyText(msg());
      try {
        await navigator.share({ files, text: msg() });
      } catch (err) {
        if (err.name !== 'AbortError') toast('공유하지 못했어요 · 문구는 복사돼 있어요');
      }
    });
  };

  renderPick();
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-action="quote"]')) openQuoteSheet(); });

// ---------------------------------------------------------------- 설정
function logout() {
  try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(SOURCE_KEY); } catch {}
  originals.clear(); // 이 기기에 보관한 큰 원본도 지운다
  settings = loadSettings();
  libraries.clear();
  accounts = null;
  currentSpace = null;
}

function renderAccount() {
  app.innerHTML = shell(`
  <section class="hero small"><p class="eyebrow">ACCOUNT</p><h1>내 계정</h1><p class="lead">${h(displayName(settings.userId))} · 멤버</p></section>
  <section class="section narrow">
    <div class="card">
      <div class="card-head">${avatarHtml(settings.userId, 'md')}<h2>${h(displayName(settings.userId))} <span class="opt">${h(settings.userId)}</span></h2></div>
      <p class="muted small">내 브리핑에는 타임테이블 올리기·시간 작성·삭제를 할 수 있고, 다른 사람의 스케줄은 왼쪽 메뉴에서 보기 전용으로 볼 수 있어요.</p>
      <button type="button" class="btn ghost danger" id="logout">로그아웃</button>
    </div>
  </section>`, { active: 'settings' });
  $('#logout').addEventListener('click', () => { logout(); toast('로그아웃했어요'); location.hash = '#/'; route(); });
}

const DEFAULT_USERS = [
  { id: 'jj', role: 'admin' },
  { id: 'hk', role: 'member' },
  { id: 'sh', role: 'member' },
];

function renderSettings() {
  if (isConfigured() && !isAdmin()) return renderAccount();
  const s = settings;
  const loggedIn = isConfigured();
  const repo = appRepo();
  app.innerHTML = shell(`
  <section class="hero small"><p class="eyebrow">SETTINGS</p><h1>설정</h1><p class="lead">${loggedIn ? `${h(s.userId || '관리자')} · 관리자` : '관리자 처음 설정'}</p></section>
  <section class="section narrow">
    <form id="settingsForm" class="form" autocomplete="off">
      <div class="card">
        <div class="card-head">${icon.sparkle}<h2>Claude API 키</h2></div>
        <p class="muted small">타임테이블 분석에 사용합니다. <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>에서 발급받으세요.</p>
        <label>API 키<input type="password" name="anthropicKey" value="${h(s.anthropicKey)}" placeholder="sk-ant-..."></label>
        <button type="button" class="btn ghost" id="testClaude">연결 테스트</button>
      </div>

      <div class="card">
        <div class="card-head">${icon.doc}<h2>GitHub 저장소</h2></div>
        <p class="muted small">
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained token</a> →
          Repository access: <b>Only select repositories</b>에서 <b>shoot-briefing-data</b>${repo ? `와 <b>${h(repo.repo)}</b>` : ''} 선택 →
          Permissions: <b>Contents: Read and write</b></p>
        <label>GitHub 아이디<input name="ghOwner" value="${h(s.ghOwner)}" placeholder="예: differ37"></label>
        <label>데이터 저장소 이름<input name="ghRepo" value="${h(s.ghRepo)}" placeholder="shoot-briefing-data"></label>
        <label>관리자 토큰 (읽기+쓰기)<input type="password" name="ghToken" value="${h(s.ghToken)}" placeholder="github_pat_..."></label>
        <button type="button" class="btn ghost" id="testGh">저장소 연결 테스트</button>
      </div>

      <div class="card">
        <div class="card-head">${icon.kakao}<h2>카카오내비 바로 실행 <span class="opt">선택</span></h2></div>
        <p class="muted small">비워두면 사이트 기본 키를 써요. <a href="https://developers.kakao.com/console/app" target="_blank" rel="noopener">Kakao Developers</a>에서 앱을 만들고 <b>JavaScript 키</b>를 넣으면, 휴대폰에서 버튼 한 번으로 카카오내비 안내가 바로 시작돼요. (앱 설정 → 플랫폼 → Web 사이트 도메인에 <code>${h(location.origin)}</code> 등록 필요)</p>
        <label>JavaScript 키<input name="kakaoKey" value="${h(s.kakaoKey)}" placeholder="비우면 사이트 기본 키"></label>
      </div>

      <div class="card">
        <div class="card-head">${icon.users}<h2>멤버 토큰</h2></div>
        <p class="muted small">멤버 계정(hk, sh)에 들어갈 토큰이에요. Fine-grained token을 하나 더 만들어
          <b>shoot-briefing-data</b>만 선택 → Permissions: <b>Contents: Read and write</b>로 설정하세요.
          (예전에 만든 읽기 전용 토큰이 있다면 GitHub에서 그 토큰의 권한을 Read and write로 바꿔도 돼요.)</p>
        <label>멤버 토큰 (데이터 저장소 읽기+쓰기)<input type="password" name="memberToken" value="${h(s.memberToken)}" placeholder="github_pat_..."></label>
      </div>

      <button class="btn large block" type="submit">저장</button>
    </form>

    <div class="card users-card form" id="usersCard">
      <div class="card-head">${icon.users}<h2>사용자 관리</h2></div>
      ${repo ? `<p class="muted small">아이디와 비밀번호로 로그인할 계정이에요. <b>관리자</b>는 모든 사람의 브리핑을 읽고 쓸 수 있고, <b>멤버</b>는 자기 브리핑만 쓰고 다른 사람 것은 볼 수만 있어요.
        멤버 계정에도 위 Claude 키가 들어가서, 멤버가 올린 분석 비용도 같은 키로 청구돼요.
        비밀번호는 어디에도 그대로 저장되지 않아요. 비밀번호를 바꾸거나 위 설정(키·토큰)을 바꿨다면 해당 계정을 다시 저장하세요.</p>
      <div id="userRows"><p class="muted small">불러오는 중…</p></div>
      <button type="button" class="btn ghost" id="addUser">+ 사용자 추가</button>` : '<p class="muted small">GitHub Pages 주소에서 열었을 때만 쓸 수 있어요.</p>'}
    </div>

    ${loggedIn ? `<div class="card">
      <div class="card-head">${icon.trash}<h2>이 기기에서 로그아웃</h2></div>
      <p class="muted small">이 브라우저에 저장된 키와 토큰을 지웁니다. 저장된 타임테이블은 그대로 남아요.</p>
      <button type="button" class="btn ghost danger" id="logout">로그아웃</button>
    </div>` : ''}
  </section>`, { active: 'settings' });

  const form = $('#settingsForm');
  const trimAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
  const values = () => ({ ...trimAll(Object.fromEntries(new FormData(form))), mode: 'github' });

  $('#testClaude').addEventListener('click', async (e) => {
    const key = values().anthropicKey;
    if (!key) return toast('API 키를 입력하세요');
    e.target.textContent = '확인 중…';
    try { await testKey(key); toast('Claude 연결 성공'); } catch (err) { toast('실패: ' + (err.status ? `${err.status} ` : '') + (err.error?.error?.message || err.message)); }
    e.target.textContent = '연결 테스트';
  });
  $('#testGh').addEventListener('click', async (e) => {
    const v = values();
    e.target.textContent = '확인 중…';
    try { await new GitHubStore({ token: v.ghToken, owner: v.ghOwner, repo: v.ghRepo }).check(); toast('저장소 연결 성공 (비공개 확인됨)'); } catch (err) { toast(err.message); }
    e.target.textContent = '저장소 연결 테스트';
  });
  $('#logout')?.addEventListener('click', (e) => {
    if (!e.target.classList.contains('confirm')) { e.target.classList.add('confirm'); e.target.textContent = '정말 로그아웃할까요? 한 번 더 누르세요'; return; }
    logout();
    toast('로그아웃했어요');
    location.hash = '#/';
  });

  async function validateAndSave() {
    const v = values();
    if (!v.anthropicKey || !v.ghToken || !v.ghOwner || !v.ghRepo) throw new Error('Claude 키와 GitHub 설정을 모두 채워 주세요');
    await new GitHubStore({ token: v.ghToken, owner: v.ghOwner, repo: v.ghRepo }).check();
    saveSettings({ ...v, role: 'admin' });
    return v;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await validateAndSave(); } catch (err) { return toast(err.message); }
    toast('저장했어요');
    location.hash = '#/';
  });

  // ----- 사용자 관리
  if (!repo) return;
  const rowsEl = $('#userRows');
  let users = [];
  const usersPath = 'users.json';
  const dataStore = () => new GitHubStore({ token: settings.ghToken, owner: settings.ghOwner, repo: settings.ghRepo });

  const renderRows = () => {
    rowsEl.innerHTML = users.map((u, i) => `
      <div class="user-row" data-i="${i}">
        <div class="user-top">
          ${avatarHtml(u.id, 'md')}<input class="u-id" value="${h(u.id)}" placeholder="아이디" ${u.saved ? 'readonly' : ''} autocapitalize="none" spellcheck="false">
          <select class="u-role">
            <option value="member" ${u.role !== 'admin' ? 'selected' : ''}>멤버</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>관리자</option>
          </select>
        </div>
        <input class="u-pw" type="password" autocomplete="new-password" placeholder="${u.saved ? '새 비밀번호 (바꿀 때만)' : '비밀번호'}">
        <div class="user-actions">
          <span class="u-state">${u.saved ? `${icon.check} 저장됨${u.updatedAt ? ` · ${h(new Date(u.updatedAt).toLocaleDateString('ko-KR'))}` : ''}` : '아직 저장 안 됨'}</span>
          <button type="button" class="btn ghost u-save">저장</button>
          ${u.saved ? `<button type="button" class="del u-del" aria-label="삭제">${icon.trash}</button>` : ''}
        </div>
      </div>`).join('');
  };

  const saveIndex = async () => {
    const list = users.filter((u) => u.saved).map(({ id, role, updatedAt }) => ({ id, role, updatedAt }));
    await dataStore().putText(usersPath, JSON.stringify({ users: list }, null, 2), '사용자 목록 갱신');
    // 로그인 화면의 계정 선택 카드용 공개 목록 (아이디·권한만)
    await publishAccounts(new GitHubStore({ token: settings.ghToken, owner: repo.owner, repo: repo.repo }), list.map(({ id, role }) => ({ id, role })));
    accounts = null;
  };

  (async () => {
    if (!storageReady()) { users = DEFAULT_USERS.map((u) => ({ ...u })); renderRows(); return; }
    try {
      const text = await dataStore().getText(usersPath);
      users = text ? JSON.parse(text).users.map((u) => ({ ...u, role: u.role === 'viewer' ? 'member' : u.role, saved: true })) : DEFAULT_USERS.map((u) => ({ ...u }));
    } catch { users = DEFAULT_USERS.map((u) => ({ ...u })); }
    renderRows();
  })();

  $('#addUser').addEventListener('click', () => { users.push({ id: '', role: 'member' }); renderRows(); });

  rowsEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.user-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    const u = users[i];
    const appStore = () => new GitHubStore({ token: settings.ghToken, owner: repo.owner, repo: repo.repo });
    const permErr = (err) => (err.status === 403 || err.status === 404
      ? `관리자 토큰에 ${repo.repo} 저장소 쓰기 권한이 없어요. GitHub 토큰 설정에서 ${repo.repo} 저장소를 추가하고 Update를 눌러 주세요.`
      : err.status === 401 ? '토큰이 올바르지 않거나 만료됐어요.'
      : err.message);

    if (e.target.closest('.u-del')) {
      const b = e.target.closest('.u-del');
      if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = '삭제?'; return; }
      try {
        await removeUser(appStore(), u.id);
        users.splice(i, 1);
        await saveIndex();
        renderRows();
        toast(`${u.id} 계정을 삭제했어요`);
      } catch (err) { toast(permErr(err)); }
      return;
    }

    if (!e.target.closest('.u-save')) return;
    const btn = e.target.closest('.u-save');
    const id = normId($('.u-id', row).value);
    const role = $('.u-role', row).value;
    const pw = $('.u-pw', row).value;
    if (!/^[a-z0-9._-]{2,20}$/.test(id)) return toast('아이디는 영문 소문자·숫자 2~20자로 해주세요');
    if (users.some((x, k) => k !== i && x.id === id)) return toast('이미 있는 아이디예요');
    if (!pw) return toast('비밀번호를 입력하세요');
    const problem = passwordProblem(pw);
    if (problem) return toast(problem);

    btn.disabled = true;
    btn.textContent = '저장 중…';
    try {
      const v = await validateAndSave();
      if (role === 'member' && !v.memberToken) throw new Error('멤버 토큰을 먼저 입력하세요');
      if (role === 'member') {
        const test = new GitHubStore({ token: v.memberToken, owner: v.ghOwner, repo: v.ghRepo });
        await test.check().catch((err) => { throw new Error(`멤버 토큰 확인 실패: ${err.message}`); });
      }
      const base = { mode: 'github', ghOwner: v.ghOwner, ghRepo: v.ghRepo, kakaoKey: v.kakaoKey };
      const data = role === 'admin'
        ? { ...base, role, ghToken: v.ghToken, anthropicKey: v.anthropicKey, memberToken: v.memberToken }
        : { ...base, role, ghToken: v.memberToken, anthropicKey: v.anthropicKey };
      await publishUser(appStore(), id, pw, data);
      Object.assign(u, { id, role, saved: true, updatedAt: new Date().toISOString() });
      await saveIndex();
      if (!settings.userId && role === 'admin') saveSettings({ userId: id });
      renderRows();
      toast(`${id} 계정을 저장했어요`);
    } catch (err) {
      console.error(err);
      const msg = permErr(err);
      toast(msg);
      // 토스트는 금방 사라지니 실패 이유를 줄에 계속 남긴다
      $('.u-state', row).innerHTML = `<span class="u-err">${icon.alert} 저장 실패: ${h(msg)}</span>`;
      btn.disabled = false;
      btn.textContent = '다시 저장';
    }
  });
}

// ---------------------------------------------------------------- 업로드
const picker = document.createElement('input');
picker.type = 'file';
picker.accept = 'application/pdf,.pdf';
picker.multiple = true;
let pickerProject = null;
picker.addEventListener('change', () => {
  const files = [...picker.files];
  picker.value = '';
  if (files.length) uploadFiles(files, pickerProject, currentSpace);
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action="upload"]');
  if (!t) return;
  if (!isConfigured() || !currentSpace || !canUpload(currentSpace)) return;
  pickerProject = t.dataset.project || null;
  picker.click();
});

function bindDrop(el) {
  if (!el) return;
  ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, () => el.classList.remove('over')));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (files.length) uploadFiles(files, null, currentSpace);
  });
}

const STEPS = [
  ['read', 'PDF 읽기'],
  ['render', '페이지를 고해상도 이미지로 변환'],
  ['analyze', 'Claude가 타임테이블 분석'],
  ['diff', '이전 버전과 비교'],
  ['save', '저장'],
];

function progressSheet() {
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `<div class="sheet"><p class="eyebrow" id="upFile"></p><h2 id="upTitle">분석 중</h2>
    <ol class="steps">${STEPS.map(([k, t]) => `<li data-step="${k}"><span class="dot"></span><span>${t}</span><em></em></li>`).join('')}</ol>
    <p class="muted small" id="upDetail"></p><div class="sheet-actions" id="upActions"></div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  return {
    file(name, i, total) {
      $('#upFile', el).textContent = total > 1 ? `${i + 1} / ${total} · ${name}` : name;
      $$('.steps li', el).forEach((li) => { li.className = ''; $('em', li).textContent = ''; });
    },
    step(key, detail = '') {
      let reached = false;
      for (const li of $$('.steps li', el)) {
        if (li.dataset.step === key) { li.className = 'active'; reached = true; $('em', li).textContent = detail; }
        else if (!reached) li.className = li.className === 'skip' ? 'skip' : 'done';
      }
    },
    fail() { $$('.steps li.active', el).forEach((li) => (li.className = 'fail')); },
    skip(key) { $(`[data-step="${key}"]`, el).className = 'skip'; },
    detail(t) { $('#upDetail', el).textContent = t; },
    title(t) { $('#upTitle', el).textContent = t; },
    finish() { $$('.steps li', el).forEach((li) => li.className !== 'skip' && (li.className = 'done')); },
    actions(html) { $('#upActions', el).innerHTML = html; return el; },
    close() { el.classList.remove('show'); setTimeout(() => el.remove(), 300); },
  };
}

// GitHub는 100MB 넘는 파일을 거부하고, 휴대폰에서 큰 파일을 base64로 올리면 메모리가 모자라다
const BIG_PDF = 40 * 1024 * 1024;

// 분석하는 동안 화면이 꺼지면 휴대폰 브라우저가 연결을 끊으므로 화면을 켜 둔다
let wakeLock = null;
let wantAwake = false;
async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (wantAwake && document.visibilityState === 'visible') keepAwake(true); });

async function uploadFiles(files, projectId, space) {
  keepAwake(true);
  try {
    await uploadFilesInner(files, projectId, space);
  } finally {
    keepAwake(false);
  }
}

async function uploadFilesInner(files, projectId, space) {
  const sheet = progressSheet();
  let lastProject = null;
  const lib = await getLibrary(space).catch((e) => { sheet.title('저장소 연결 실패'); sheet.detail(e.message); return null; });
  if (!lib) { sheet.actions('<button class="btn" data-close>닫기</button>').querySelector('[data-close]').onclick = sheet.close; return; }

  // 버전 순서대로 처리해야 변경사항 비교가 자연스럽다
  files.sort((x, y) => versionKeyFromName(x.name).localeCompare(versionKeyFromName(y.name)) || x.lastModified - y.lastModified);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    sheet.file(file.name, i, files.length);
    sheet.title('분석 중');
    try {
      sheet.step('read');
      // Uint8Array로 넘겨 복사 없이 연다 (165MB짜리 PPM 자료도 메모리를 두 배로 쓰지 않게)
      const pdf = await openPdf(new Uint8Array(await file.arrayBuffer()));
      const { pages, picked, found } = await pickPages(pdf);
      sheet.step('render', picked ? `${pdf.numPages}쪽 중 ${pages.length}쪽` : '');
      if (picked) sheet.detail(found ? `촬영 일정이 있는 ${pages.join(', ')}쪽만 분석해요` : `시간표를 찾지 못해 앞 ${pages.length}쪽만 분석해요`);
      const images = await pdfToAnalysisImages(pdf, (t) => sheet.detail(t), pages);
      const thumb = await pdfThumbnail(pdf, 720, pages[0]);
      // 저장소에 올리기엔 너무 큰 PDF → 고른 페이지만 이미지 PDF로 줄이고, 콘티 위치는 원본에서 미리 뽑아 둔다
      let pdfBlob = file;
      let extra = {};
      if (file.size > BIG_PDF) {
        sheet.detail('원본이 커서 분석한 페이지만 가볍게 저장할 준비 중…');
        const { rows, boxes } = await extractConti(pdf, pages);
        const at = new Map(pages.map((p, k) => [p, k + 1]));
        const contiRows = rows.filter((r) => at.has(r.page)).map((r) => ({ ...r, page: at.get(r.page), images: r.images.map((b) => ({ ...b, page: at.get(b.page) })) }));
        const contiBoxes = boxes.filter((b) => at.has(b.page)).map((b) => ({ ...b, page: at.get(b.page) }));
        pdfBlob = await makeReducedPdf(pdf, pages, (t) => sheet.detail(t));
        extra = { conti: { rows: contiRows, boxes: contiBoxes }, reduced: { pages, totalPages: pdf.numPages, originalSize: file.size } };
      }
      pdf.loadingTask?.destroy?.(); // 워커가 들고 있는 원본(최대 수백 MB)을 분석 요청 전에 놓아 준다
      sheet.step('analyze', `이미지 ${images.length}장`);
      sheet.detail('글씨가 작은 표를 꼼꼼히 읽고 있어요. 보통 1~3분 걸려요. 끝날 때까지 이 화면을 켜 두세요.');
      let chars = 0;
      const t0 = Date.now();
      const timer = setInterval(() => sheet.detail(`분석 중… ${Math.round((Date.now() - t0) / 1000)}초${chars ? ` · 결과 ${chars.toLocaleString()}자 작성 중` : ''}`), 1000);
      let analysis;
      try {
        ({ data: analysis } = await analyzeTimetable(settings.anthropicKey, { images, fileName: file.name, onText: (d) => { chars += d.length; } }));
      } finally { clearInterval(timer); }
      sheet.skip('diff');
      const { project, meta: savedMeta } = await lib.addVersion({
        fileName: file.name,
        pdfBlob,
        thumbBlob: thumb,
        analysis,
        projectId,
        extra,
        compare: async (prev, next, pl, nl) => (await compareVersions(settings.anthropicKey, { prev, next, prevLabel: pl, nextLabel: nl })).data,
        onStep: (k) => { if (k === 'diff') { $('[data-step="diff"]').className = ''; sheet.detail('이전 버전과 무엇이 달라졌는지 비교 중…'); } sheet.step(k); if (k === 'save') sheet.detail(lib.store.kind === 'github' ? 'GitHub 비공개 저장소에 저장 중…' : '이 기기에 저장 중…'); },
      });
      // 줄여서 저장한 경우 원본은 이 기기에 보관해 '원본 PDF 열기'로 볼 수 있게
      if (extra.reduced) await originals.put(`${space}/${project.id}/${savedMeta.id}`, file).catch((err) => console.warn('원본 보관 실패', err));
      lastProject = project;
    } catch (e) {
      console.error(e);
      sheet.fail();
      sheet.title('분석하지 못했어요');
      const msg = e.status === 401 ? 'Claude API 키가 올바르지 않아요. 설정을 확인하세요.'
        : e.status === 429 ? '요청이 너무 많아요. 잠시 후 다시 시도하세요.'
        : e.status === 529 || e.status >= 500 ? 'Claude 서버가 혼잡해요. 잠시 후 다시 시도하세요.'
        : e.message;
      sheet.detail(`${file.name}: ${msg}`);
      const el = sheet.actions(`<button class="btn ghost" data-close>닫기</button>${lastProject ? '<button class="btn" data-go>지금까지 결과 보기</button>' : ''}`);
      el.querySelector('[data-close]').onclick = () => { sheet.close(); route(); };
      el.querySelector('[data-go]')?.addEventListener('click', () => { sheet.close(); location.hash = L(space, lastProject.id); });
      return;
    }
  }
  sheet.finish();
  sheet.title('완료');
  sheet.detail('');
  setTimeout(() => {
    sheet.close();
    const target = L(space, lastProject.id);
    if (location.hash === target) route(); else location.hash = target;
  }, 700);
}

installTypeset();
route();
