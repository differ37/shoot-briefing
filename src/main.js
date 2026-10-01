import './styles.css';
import { icon } from './icons.js';
import { GitHubStore, LocalStore, PrefixedStore } from './storage.js';
import { Library, versionKeyFromName } from './library.js';
import { analyzeTimetable, compareVersions, testKey } from './claude.js';
import { openPdf, pdfToAnalysisImages, pdfThumbnail, renderPagesInto } from './pdf.js';
import { computeMarks } from './diff.js';
import { openNaver, openKakao, copyText } from './nav.js';
import { appRepo, fetchAccounts, login, normId, passwordProblem, publishAccounts, publishUser, removeUser } from './vault.js';

// ---------------------------------------------------------------- 설정
const SETTINGS_KEY = 'shoot-briefing.settings';
const DEFAULTS = { mode: 'github', ghOwner: appRepo()?.owner || '', ghRepo: 'shoot-briefing-data', ghToken: '', anthropicKey: '', kakaoKey: '', memberToken: '', role: 'admin', userId: '' };
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
const spaceName = (space) => (space === ADMIN_SPACE ? '관리자' : space);
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

// 장비집 집합 → 장비집 출발 → 촬영팀 도착
const prepChain = (prep, callTime, cls = '') => {
  if (!prep?.gather && !prep?.depart) return '';
  const steps = [
    ['장비집 집합', prep.gather],
    ['장비집 출발', prep.depart],
    ['촬영팀 도착', callTime || '—'],
  ].filter(([, t]) => t);
  return `<ol class="chain ${cls}">${steps.map(([label, t], i) => `<li class="${i === steps.length - 1 ? 'arrive' : ''}"><span>${label}</span><b>${h(t)}</b></li>`).join('')}</ol>`;
};

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
        ${isConfigured() ? `<button class="user-chip" data-action="drawer" aria-label="계정 메뉴"><span class="avatar sm">${h(spaceName(mySpace()).slice(0, 1).toUpperCase())}</span><span class="uname">${h(spaceName(mySpace()))}</span></button>` : ''}
      </nav>
    </div>
  </header>
  ${isConfigured() && currentSpace && currentSpace !== mySpace() && active !== 'settings' ? `
  <div class="space-banner"><div>
    <span class="avatar sm">${h(spaceName(currentSpace).slice(0, 1).toUpperCase())}</span>
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
      <span class="avatar">${h(spaceName(a.id).slice(0, 1).toUpperCase())}</span>
      <span class="d-name"><b>${h(spaceName(a.id))}</b><small>${a.id === me ? '내 브리핑' : canEdit(a.id) ? '편집 가능' : '보기 전용'}</small></span>
      ${a.id === currentSpace ? icon.check : ''}
    </a>`;
  el.innerHTML = `
  <aside class="drawer" role="dialog" aria-label="계정 메뉴">
    <div class="d-head"><span class="avatar">${h(spaceName(me).slice(0, 1).toUpperCase())}</span><div><b>${h(spaceName(me))}</b><small>${isAdmin() ? '관리자' : '멤버'}로 로그인됨</small></div></div>
    <p class="d-label">내 브리핑</p>
    ${item(accounts.find((a) => a.id === me) || { id: me })}
    ${others.length ? `<p class="d-label">다른 사람 스케줄${isAdmin() ? '' : ' · 보기 전용'}</p>${others.map(item).join('')}` : ''}
    <div class="d-foot">
      <a class="d-link" href="#/settings">${icon.gear}${isAdmin() ? '설정 · 사용자 관리' : '내 계정'}</a>
      <button class="d-link danger" data-logout>${icon.trash}로그아웃</button>
    </div>
  </aside>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('a')) close();
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
        <span class="avatar lg">${h(a.id.slice(0, 1).toUpperCase())}</span>
        <strong>${h(a.id)}</strong>
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
      $('#loginWho').innerHTML = `<span class="avatar sm">${h(b.dataset.id.slice(0, 1).toUpperCase())}</span><b>${h(b.dataset.id)}</b> 계정으로 로그인`;
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
      toast(`${normId(id)}님, 환영합니다`);
      location.hash = L(mySpace());
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
          ${prepChain(next.prep, a.my_call?.time, 'on-dark')}
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
        <span class="sr-call" data-call>${p.callTime ? `${icon.clock}${p.prep?.gather ? `${h(p.prep.gather)} 집합 · ` : ''}${h(p.callTime)} 도착 · ${h(p.callPlace || '')}` : ''}</span>
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
      if (mc?.time && el) el.innerHTML = `${icon.clock}${p.prep?.gather ? `${h(p.prep.gather)} 집합 · ` : ''}${h(mc.time)} 도착 · ${h(mc.location_name || '')}`;
    }).catch(() => {});
  }
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
      <p class="lead">${h(prettyDate(prod.shoot_date || project.date, prod.weekday))} <span class="dday">${h(dday(prod.shoot_date || project.date))}</span>${canEdit(space) ? `<button type="button" class="mini-btn" id="prepBtn">${icon.clock}시간 작성</button>` : ''}</p>
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
  <section class="section">
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
      <button class="btn nav kakao" data-nav="kakao" data-loc="${idx}">${icon.kakao}${settings.kakaoKey ? '카카오내비' : '카카오맵'}</button>
      <button class="btn nav copy" data-copy="${h(loc.address || loc.name || '')}" aria-label="주소 복사">${icon.copy}</button>
    </div>`;
  const navTargets = [{ name: mc.location_name || myLoc.name, address: myAddr }, ...locs];

  const myCall = `
  <section class="section">
    <div class="call-card">
      <div class="call-main">
        ${prepChain(project.prep, mc.time, 'on-dark')}
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
    ${a.briefing ? `<div class="card briefing"><div class="card-head">${icon.sparkle}<h2>브리핑</h2></div>${para(a.briefing)}</div>` : ''}
  </section>`;

  // --- 동선 (촬영지 + 이동)
  const moves = a.moves || [];
  const used = new Set();
  const n = (s) => String(s || '').replace(/\s/g, '');
  const moveFrom = (loc) => {
    const i = moves.findIndex((m, k) => !used.has(k) && n(m.from) && n(loc.name) && (n(m.from).includes(n(loc.name)) || n(loc.name).includes(n(m.from))));
    return i;
  };
  let routeItems = '';
  locs.forEach((l, i) => {
    routeItems += `
    <li class="stop">
      <span class="stop-dot">${i + 1}</span>
      <div class="stop-body">
        <div class="stop-head"><strong>${h(l.name)}</strong>${badge(marks.locations.get(i))}</div>
        <span class="stop-role">${h([l.role, l.time_range].filter(Boolean).join(' · '))}</span>
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
      routeItems += `<li class="move"><span class="move-line"></span><div>${icon.truck}<strong>${h(m.time)}</strong> 이동 ${badge(marks.moves.get(mi))}<span>${h(m.from)} → ${h(m.to)}${m.who ? ` · ${h(m.who)}` : ''}${m.note ? ` · ${h(m.note)}` : ''}</span></div></li>`;
    }
  });
  moves.forEach((m, mi) => {
    if (used.has(mi)) return;
    routeItems += `<li class="move"><span class="move-line"></span><div>${icon.truck}<strong>${h(m.time)}</strong> 이동 ${badge(marks.moves.get(mi))}<span>${h(m.from)} → ${h(m.to)}${m.who ? ` · ${h(m.who)}` : ''}</span></div></li>`;
  });
  const routeHtml = `
  <section class="section">
    <h2 class="section-title">${icon.pin} 촬영지 · 동선</h2>
    <ol class="route">${routeItems || '<li class="empty-line">촬영지 정보가 없어요.</li>'}</ol>
  </section>`;

  // --- 콜타임
  const calls = a.call_times || [];
  const callsHtml = calls.length ? `
  <section class="section">
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
  <section class="section">
    <div class="section-head">
      <h2 class="section-title">${icon.clock} 진행 타임라인</h2>
      ${tracks.length > 1 ? `<div class="seg" id="trackSeg"><button class="on" data-track="">전체</button>${tracks.map((t) => `<button data-track="${h(t)}">${h(t)}</button>`).join('')}</div>` : ''}
    </div>
    <ol class="timeline">
      ${sched.map((s) => `
      <li class="tl ${kindClass[s.kind] || 'k-etc'}" data-track="${h(s.track)}">
        <div class="tl-time"><strong>${s.next_day ? '<i>익일</i>' : ''}${h(s.start)}</strong><span>${h(s.end)}</span></div>
        <div class="tl-body">
          <div class="tl-head"><span class="tl-kind">${h(s.kind)}</span>${tracks.length > 1 && s.track ? `<span class="tl-track">${h(s.track)}</span>` : ''}${s.minutes ? `<span class="tl-min">${s.minutes}분</span>` : ''}${badge(marks.schedule.get(s.i))}</div>
          <div class="tl-title">${titleLines(s.title)}</div>
          ${s.location_name ? `<span class="tl-loc">${h(s.location_name)}</span>` : ''}
          ${s.details ? para(s.details, 'tl-details') : ''}
        </div>
      </li>`).join('')}
    </ol>
  </section>` : '';

  // --- 체크사항
  const lv = { critical: [icon.alert, '필수'], important: [icon.star, '중요'], info: [icon.info, '참고'] };
  const checks = [...(a.checks || [])].map((c, i) => ({ ...c, i })).sort((x, y) => ['critical', 'important', 'info'].indexOf(x.level) - ['critical', 'important', 'info'].indexOf(y.level));
  const checksHtml = checks.length ? `
  <section class="section">
    <h2 class="section-title">${icon.flag} 체크사항</h2>
    <ul class="checks">
      ${checks.map((c) => `<li class="lv-${c.level}">${lv[c.level]?.[0] || ''}<span class="lv">${lv[c.level]?.[1] || ''}</span>${para(c.text, 'check-text')}${badge(marks.checks.get(c.i))}</li>`).join('')}
    </ul>
  </section>` : '';

  // --- 연락처
  const contacts = a.contacts || [];
  const contactsHtml = `
  <section class="section">
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
  <section class="section">
    <h2 class="section-title">${icon.doc} 원본 타임테이블</h2>
    <div class="card original">
      <div class="row-gap"><button class="btn" id="showPdf">${icon.doc} 원본 페이지 보기</button><button class="btn ghost" id="openPdf">새 탭에서 PDF 열기</button></div>
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

  app.innerHTML = shell(hero + switcher + changesHtml + myCall + routeHtml + callsHtml + schedHtml + checksHtml + contactsHtml + historyHtml);
  hydrateThumbs(lib);
  $('#prepBtn')?.addEventListener('click', () => openPrepModal(lib, project, mc.time));

  // 이벤트
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const loc = navTargets[Number(b.dataset.loc)] || {};
    if (!loc.address && !loc.name) return toast('주소 정보가 없어요');
    b.dataset.nav === 'naver' ? openNaver(loc) : openKakao(loc, settings.kakaoKey);
  }));
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => toast((await copyText(b.dataset.copy)) ? '주소를 복사했어요' : '복사하지 못했어요')));
  $$('#trackSeg button').forEach((b) => b.addEventListener('click', () => {
    $$('#trackSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.timeline .tl').forEach((li) => { li.hidden = !!b.dataset.track && li.dataset.track !== b.dataset.track && li.dataset.track !== '전체'; });
  }));

  let pdfCache = null;
  const getPdfBlob = async () => (pdfCache ||= await lib.getPdf(pid, meta.id));
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
    toast('버전을 삭제했어요');
    if (lib.project(pid)) {
      if (b.dataset.del === meta.id) location.hash = L(space, pid); else route();
    } else location.hash = L(space);
  }));
}

// ---------------------------------------------------------------- 시간 작성 팝업
function openPrepModal(lib, project, callTime) {
  const prep = project.prep || {};
  const el = document.createElement('div');
  el.className = 'sheet-backdrop';
  el.innerHTML = `
  <form class="sheet prep-sheet" autocomplete="off">
    <p class="eyebrow">${h(project.title)}</p>
    <h2>시간 작성</h2>
    <label>${icon.users}<span>장비집 집합</span><input type="time" name="gather" value="${h(prep.gather || '')}"></label>
    <label>${icon.truck}<span>장비집 출발</span><input type="time" name="depart" value="${h(prep.depart || '')}"></label>
    <div class="prep-arrive">${icon.camera}<span>촬영팀 도착</span><b>${h(callTime || '—')}</b></div>
    <p class="muted small prep-hint">타임테이블 기준 도착 시간이에요. 새 버전이 올라와도 기록한 시간은 그대로 유지돼요.</p>
    <div class="sheet-actions">
      ${prep.gather || prep.depart ? '<button type="button" class="btn ghost danger" data-clear>지우기</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-cancel>취소</button>
      <button type="submit" class="btn">저장</button>
    </div>
  </form>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  const form = $('form', el);
  $('input[name=gather]', form).focus();
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  $('[data-cancel]', form).addEventListener('click', close);

  const save = async (values) => {
    $$('button', form).forEach((b) => (b.disabled = true));
    try {
      await lib.setPrep(project.id, values);
      close();
      toast(values.gather || values.depart ? '시간을 저장했어요' : '시간을 지웠어요');
      route();
    } catch (err) {
      toast(err.status === 403 || err.status === 404 ? '저장 권한이 없어요' : err.message);
      $$('button', form).forEach((b) => (b.disabled = false));
    }
  };
  $('[data-clear]', form)?.addEventListener('click', () => save({ gather: '', depart: '' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { gather, depart } = Object.fromEntries(new FormData(form));
    if (!gather && !depart) return toast('시간을 하나 이상 입력하세요');
    save({ gather, depart });
  });
}

// ---------------------------------------------------------------- 설정
function logout() {
  try { localStorage.removeItem(SETTINGS_KEY); } catch {}
  settings = loadSettings();
  libraries.clear();
  accounts = null;
  currentSpace = null;
}

function renderAccount() {
  app.innerHTML = shell(`
  <section class="hero small"><p class="eyebrow">ACCOUNT</p><h1>내 계정</h1><p class="lead">${h(settings.userId)} · 멤버</p></section>
  <section class="section narrow">
    <div class="card">
      <div class="card-head">${icon.users}<h2>${h(settings.userId)}</h2></div>
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
        <p class="muted small">비워두면 카카오맵에서 주소를 검색해 길찾기를 누르면 됩니다. <a href="https://developers.kakao.com/console/app" target="_blank" rel="noopener">Kakao Developers</a>에서 앱을 만들고 <b>JavaScript 키</b>를 넣으면, 휴대폰에서 버튼 한 번으로 카카오내비 안내가 바로 시작돼요. (앱 설정 → 플랫폼 → Web 사이트 도메인에 <code>${h(location.origin)}</code> 등록 필요)</p>
        <label>JavaScript 키<input name="kakaoKey" value="${h(s.kakaoKey)}" placeholder="선택 사항"></label>
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
          <input class="u-id" value="${h(u.id)}" placeholder="아이디" ${u.saved ? 'readonly' : ''} autocapitalize="none" spellcheck="false">
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

async function uploadFiles(files, projectId, space) {
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
      const buf = await file.arrayBuffer();
      const pdf = await openPdf(buf);
      sheet.step('render');
      const images = await pdfToAnalysisImages(pdf, (t) => sheet.detail(t));
      const thumb = await pdfThumbnail(pdf);
      sheet.step('analyze', `이미지 ${images.length}장`);
      sheet.detail('글씨가 작은 표를 꼼꼼히 읽고 있어요. 보통 1~3분 걸립니다.');
      let chars = 0;
      const t0 = Date.now();
      const timer = setInterval(() => sheet.detail(`분석 중… ${Math.round((Date.now() - t0) / 1000)}초${chars ? ` · 결과 ${chars.toLocaleString()}자 작성 중` : ''}`), 1000);
      let analysis;
      try {
        ({ data: analysis } = await analyzeTimetable(settings.anthropicKey, { images, fileName: file.name, onText: (d) => { chars += d.length; } }));
      } finally { clearInterval(timer); }
      sheet.skip('diff');
      const { project } = await lib.addVersion({
        fileName: file.name,
        pdfBlob: file,
        thumbBlob: thumb,
        analysis,
        projectId,
        compare: async (prev, next, pl, nl) => (await compareVersions(settings.anthropicKey, { prev, next, prevLabel: pl, nextLabel: nl })).data,
        onStep: (k) => { if (k === 'diff') { $('[data-step="diff"]').className = ''; sheet.detail('이전 버전과 무엇이 달라졌는지 비교 중…'); } sheet.step(k); if (k === 'save') sheet.detail(lib.store.kind === 'github' ? 'GitHub 비공개 저장소에 저장 중…' : '이 기기에 저장 중…'); },
      });
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

route();
