import './styles.css';
import { icon } from './icons.js';
import { GitHubStore, LocalStore } from './storage.js';
import { Library, versionKeyFromName } from './library.js';
import { analyzeTimetable, compareVersions, testKey } from './claude.js';
import { openPdf, pdfToAnalysisImages, pdfThumbnail, renderPagesInto } from './pdf.js';
import { computeMarks } from './diff.js';
import { openNaver, openKakao, copyText } from './nav.js';
import { appRepo, codeProblem, decryptVault, encryptVault, fetchVault, publishVault } from './vault.js';

// ---------------------------------------------------------------- 설정
const SETTINGS_KEY = 'shoot-briefing.settings';
const DEFAULTS = { mode: 'github', ghOwner: appRepo()?.owner || '', ghRepo: 'shoot-briefing-data', ghToken: '', anthropicKey: '', kakaoKey: '' };
const VAULT_FIELDS = ['mode', 'ghOwner', 'ghRepo', 'ghToken', 'anthropicKey', 'kakaoKey'];
function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
let settings = loadSettings();
function saveSettings(next) {
  settings = { ...settings, ...next };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  library = null;
}

const storageReady = () => settings.mode === 'local' || (settings.ghToken && settings.ghOwner && settings.ghRepo);
const isConfigured = () => storageReady() && settings.anthropicKey;

let library = null;
async function getLibrary() {
  if (!library) {
    const store = settings.mode === 'local'
      ? new LocalStore()
      : new GitHubStore({ token: settings.ghToken, owner: settings.ghOwner, repo: settings.ghRepo });
    library = new Library(store);
    await library.load();
  }
  return library;
}

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

const isPlaceholderPhone = (p) => !p || /0000-?0000/.test(p);
const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
const smsHref = (p) => 'sms:' + String(p).replace(/[^\d+]/g, '');

const thumbUrls = new Map();
async function loadThumb(lib, pid, vid) {
  const key = `${pid}/${vid}`;
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
      <a class="brand" href="#/">${icon.truck}<span>촬영 브리핑</span></a>
      <nav class="nav-links">
        <a href="#/" class="${active === 'home' ? 'on' : ''}">브리핑</a>
        <button class="nav-upload" data-action="upload">${icon.upload}<span>타임테이블 올리기</span></button>
        <a href="#/settings" class="icon-link ${active === 'settings' ? 'on' : ''}" aria-label="설정">${icon.gear}</a>
      </nav>
    </div>
  </header>
  <main>${content}</main>
  <footer class="foot">촬영팀 장비차량 기사용 타임테이블 브리핑 · Claude가 분석한 내용은 반드시 원본과 함께 확인하세요.</footer>`;
}

// ---------------------------------------------------------------- 라우터
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'settings') return renderSettings();
    if (!isConfigured()) return renderWelcome();
    if (parts[0] === 'p' && parts[1]) return await renderProject(parts[1], parts[2]);
    return await renderHome();
  } catch (e) {
    console.error(e);
    app.innerHTML = shell(`<section class="section narrow"><div class="empty">
      <h2>불러오지 못했어요</h2><p>${h(e.message)}</p>
      <div class="row-gap"><a class="btn" href="#/settings">설정 확인</a><button class="btn ghost" onclick="location.reload()">다시 시도</button></div></div></section>`);
  }
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- 환영 화면
async function renderWelcome() {
  app.innerHTML = shell(`
  <section class="hero welcome">
    <p class="eyebrow">CALL SHEET BRIEFING</p>
    <h1>타임테이블,<br>이제 한눈에.</h1>
    <p class="lead">PDF를 올리면 Claude가 도착 시간, 촬영지 주소, 이동 동선, 담당자 연락처를 정리해 드려요. 새 버전이 나오면 무엇이 바뀌었는지도 바로 보여드립니다.</p>
    <form class="unlock" id="unlockForm" hidden>
      <label for="unlockCode">접속 코드</label>
      <div class="unlock-row">
        <input id="unlockCode" type="password" autocomplete="current-password" placeholder="접속 코드 입력" required>
        <button class="btn" type="submit">열기</button>
      </div>
      <p class="unlock-msg" id="unlockMsg"></p>
    </form>
    <a class="btn large" id="setupBtn" href="#/settings">시작하기</a>
    <div class="welcome-grid">
      <div class="feature">${icon.clock}<h3>도착 시간</h3><p>촬영팀 콜타임을 가장 크게.</p></div>
      <div class="feature">${icon.pin}<h3>바로 길안내</h3><p>네이버지도·카카오로 연결.</p></div>
      <div class="feature">${icon.swap}<h3>변경사항</h3><p>이전 버전과 자동 비교.</p></div>
      <div class="feature">${icon.history}<h3>히스토리</h3><p>모든 버전을 보관.</p></div>
    </div>
  </section>`);

  const vault = await fetchVault();
  if (!vault) return;
  const form = $('#unlockForm');
  form.hidden = false;
  $('#setupBtn').className = 'text-link';
  $('#setupBtn').textContent = '처음부터 직접 설정하기';
  $('#unlockCode').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', form);
    btn.disabled = true;
    $('#unlockMsg').textContent = '확인 중…';
    try {
      const data = await decryptVault(vault, $('#unlockCode').value);
      saveSettings(Object.fromEntries(VAULT_FIELDS.filter((k) => k in data).map((k) => [k, data[k]])));
      toast('이 기기에 설정을 불러왔어요');
      route();
    } catch (err) {
      $('#unlockMsg').textContent = err.message;
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- 홈
async function renderHome() {
  app.innerHTML = shell('<section class="section"><div class="skeleton tall"></div></section>', { active: 'home' });
  const lib = await getLibrary();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const projects = [...lib.index.projects].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const upcoming = projects.filter((p) => !p.date || new Date(p.date + 'T00:00:00') >= today);
  const past = projects.filter((p) => !upcoming.includes(p)).reverse();
  const next = upcoming[0];

  let heroHtml = '';
  if (next) {
    const latest = lib.latest(next);
    const rec = await lib.getVersion(next.id, latest.id);
    const a = rec?.analysis || {};
    heroHtml = `
    <section class="hero home-hero">
      <p class="eyebrow">${h(dday(next.date))} · 다음 촬영</p>
      <h1>${h(next.title)}</h1>
      <p class="lead">${h(prettyDate(next.date, next.weekday))}${next.production ? ` · ${h(next.production)}` : ''}</p>
      <a class="call-hero" href="#/p/${encodeURIComponent(next.id)}">
        <div>
          <span class="call-label">촬영팀 도착</span>
          <span class="call-time">${h(a.my_call?.time || '—')}</span>
          <span class="call-place">${icon.pin}${h(a.my_call?.location_name || '')}</span>
        </div>
        <span class="call-go">브리핑 보기 ${icon.chevron}</span>
      </a>
      ${latest.highChangeCount ? `<p class="hero-alert">${icon.alert} 최신 버전(${h(latest.label)})에서 중요한 변경 ${latest.highChangeCount}건</p>` : ''}
    </section>`;
  } else {
    heroHtml = `
    <section class="hero">
      <p class="eyebrow">CALL SHEET BRIEFING</p>
      <h1>예정된 촬영이 없어요.</h1>
      <p class="lead">타임테이블 PDF를 올리면 브리핑이 만들어집니다.</p>
    </section>`;
  }

  const card = (p) => {
    const latest = lib.latest(p);
    return `
    <a class="project-card" href="#/p/${encodeURIComponent(p.id)}">
      <div class="thumb"><img alt="" data-thumb="${h(p.id)}/${h(latest.id)}"></div>
      <div class="pc-body">
        <span class="pc-date">${h(prettyDate(p.date, p.weekday))} <b>${h(dday(p.date))}</b></span>
        <strong>${h(p.title)}</strong>
        <span class="pc-meta">${h(p.production || p.shootType || '')}</span>
        <span class="pc-ver">${icon.history}${p.versions.length}개 버전 · 최신 ${h(latest.label)}${latest.highChangeCount ? ` <em>변경 ${latest.highChangeCount}</em>` : ''}</span>
      </div>
    </a>`;
  };

  app.innerHTML = shell(`
    ${heroHtml}
    <section class="section">
      <div class="dropzone" data-action="upload" id="dropzone">
        ${icon.upload}
        <strong>타임테이블 PDF 올리기</strong>
        <span>여기로 끌어다 놓거나 눌러서 선택 · 여러 버전을 한 번에 올려도 돼요</span>
      </div>
    </section>
    ${upcoming.length ? `<section class="section"><h2 class="section-title">예정된 촬영</h2><div class="grid">${upcoming.map(card).join('')}</div></section>` : ''}
    ${past.length ? `<section class="section"><h2 class="section-title muted">지난 촬영</h2><div class="grid past">${past.map(card).join('')}</div></section>` : ''}
  `, { active: 'home' });
  hydrateThumbs(lib);
  bindDrop($('#dropzone'));
}

// ---------------------------------------------------------------- 프로젝트 브리핑
async function renderProject(pid, vid) {
  app.innerHTML = shell('<section class="section"><div class="skeleton tall"></div><div class="skeleton"></div></section>');
  const lib = await getLibrary();
  const project = lib.project(pid);
  if (!project) { location.hash = '#/'; return; }
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
      <p class="lead">${h(prettyDate(prod.shoot_date || project.date, prod.weekday))} <span class="dday">${h(dday(prod.shoot_date || project.date))}</span></p>
      <div class="ver-line">
        <span class="pill ${isLatest ? 'latest' : 'old'}">${isLatest ? '최신' : '이전 버전'} · ${h(meta.label)}</span>
        ${rec.changes ? `<span class="pill ${rec.changes.changes.length ? 'warn' : ''}">${h(rec.changes.againstLabel)} 대비 변경 ${rec.changes.changes.length}건</span>` : '<span class="pill">첫 버전</span>'}
      </div>
      ${!isLatest ? `<a class="old-banner" href="#/p/${encodeURIComponent(pid)}">${icon.alert} 지금 보고 있는 건 예전 버전이에요. 최신(${h(latest.label)}) 보기 ${icon.chevron}</a>` : ''}
      ${a.headline ? `<p class="headline">${h(a.headline)}</p>` : ''}
    </div>
    <div class="hero-visual"><img alt="타임테이블 미리보기" data-thumb="${h(pid)}/${h(meta.id)}"></div>
  </section>`;

  // --- 버전 스위처
  const switcher = `
  <div class="version-bar"><div class="version-scroll">
    ${[...versions].reverse().map((v) => `
      <a class="vchip ${v.id === meta.id ? 'on' : ''}" href="#/p/${encodeURIComponent(pid)}/${v.id}">
        ${h(v.label)}${v.id === latest.id ? '<i>최신</i>' : ''}${v.highChangeCount ? `<b>${v.highChangeCount}</b>` : ''}
      </a>`).join('')}
    <button class="vchip add" data-action="upload" data-project="${h(pid)}">${icon.upload} 새 버전</button>
  </div></div>`;

  // --- 변경사항
  const changes = rec.changes;
  const order = { high: 0, medium: 1, low: 2 };
  const changesHtml = changes ? `
  <section class="section">
    <div class="card changes ${changes.changes.length ? '' : 'none'}">
      <div class="card-head">${icon.swap}<h2>${h(changes.againstLabel)} → ${h(meta.label)} 변경사항</h2></div>
      <p class="changes-summary">${h(changes.summary)}</p>
      ${changes.changes.length ? `<ul class="change-list">
        ${[...changes.changes].sort((x, y) => order[x.importance] - order[y.importance]).map((c) => `
        <li class="imp-${c.importance}">
          <div class="chg-top"><span class="chg-cat">${h(c.category)}</span><strong>${h(c.title)}</strong></div>
          ${c.before || c.after ? `<div class="chg-vals">
            ${c.before ? `<span class="v-before">${h(c.before)}</span>` : '<span class="v-before empty">없음</span>'}
            <span class="arrow">→</span>
            ${c.after ? `<span class="v-after">${h(c.after)}</span>` : '<span class="v-after empty">삭제</span>'}
          </div>` : ''}
          ${c.driver_impact ? `<p class="impact">${icon.truck}${h(c.driver_impact)}</p>` : ''}
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
        <span class="call-label">${icon.camera} 촬영팀 도착</span>
        <div class="call-time-xl">${h(mc.time || '—')}${marks.myCall.time ? `<span class="badge chg">변경</span><span class="before">${h(marks.myCall.time)}</span>` : ''}</div>
        <div class="call-where">
          <strong>${h(mc.location_name || myLoc.name || '')}</strong>${marks.myCall.location ? badge({ type: 'changed', before: marks.myCall.location }) : ''}
          <span>${h(myAddr)}</span>${marks.myCall.address ? badge({ type: 'changed', before: marks.myCall.address }) : ''}
        </div>
        ${mc.note ? `<p class="call-note">${h(mc.note)}</p>` : ''}
      </div>
      ${navBtns({ name: mc.location_name, address: myAddr }, 0)}
    </div>
    <div class="stats">
      <div class="stat"><span>촬영지</span><strong>${locs.length}곳</strong></div>
      <div class="stat ${a.moves?.length ? 'accent' : ''}"><span>로케이션 이동</span><strong>${a.moves?.length ? `${a.moves.length}회` : '없음'}</strong></div>
      <div class="stat"><span>종료 예정</span><strong>${h(a.wrap_time || '—')}</strong>${marks.wrap ? `<span class="badge chg">변경</span><span class="before">${h(marks.wrap)}</span>` : ''}</div>
      <div class="stat"><span>담당자</span><strong>${(a.contacts || []).length}명</strong></div>
    </div>
    ${a.briefing ? `<div class="card briefing"><div class="card-head">${icon.sparkle}<h2>브리핑</h2></div><p>${h(a.briefing)}</p></div>` : ''}
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
        ${l.note ? `<p class="stop-note">${h(l.note)}</p>` : ''}
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
          <strong>${h(s.title)}</strong>
          ${s.location_name ? `<span class="tl-loc">${h(s.location_name)}</span>` : ''}
          ${s.details ? `<p>${h(s.details)}</p>` : ''}
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
      ${checks.map((c) => `<li class="lv-${c.level}">${lv[c.level]?.[0] || ''}<span class="lv">${lv[c.level]?.[1] || ''}</span><p>${h(c.text)}</p>${badge(marks.checks.get(c.i))}</li>`).join('')}
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
        <a href="#/p/${encodeURIComponent(pid)}/${v.id}">
          <div class="h-thumb"><img alt="" data-thumb="${h(pid)}/${h(v.id)}"></div>
          <div class="h-body">
            <strong>${h(v.label)} ${v.id === latest.id ? '<i class="tag">최신</i>' : ''}${v.id === meta.id ? '<i class="tag gray">보는 중</i>' : ''}</strong>
            <span>${h(relTime(v.uploadedAt))} · ${h(v.fileName)}</span>
            <span class="h-chg">${v === versions[0] ? '첫 버전' : v.changeCount ? `변경 ${v.changeCount}건${v.highChangeCount ? ` (중요 ${v.highChangeCount})` : ''}` : '변경 없음'}</span>
          </div>
        </a>
        <button class="del" data-del="${v.id}" aria-label="이 버전 삭제">${icon.trash}</button>
      </li>`).join('')}
    </ol>
  </section>`;

  app.innerHTML = shell(hero + switcher + changesHtml + myCall + routeHtml + callsHtml + schedHtml + checksHtml + contactsHtml + historyHtml);
  hydrateThumbs(lib);

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
      if (b.dataset.del === meta.id) location.hash = `#/p/${encodeURIComponent(pid)}`; else route();
    } else location.hash = '#/';
  }));
}

// ---------------------------------------------------------------- 설정
function renderSettings() {
  const s = settings;
  app.innerHTML = shell(`
  <section class="hero small"><p class="eyebrow">SETTINGS</p><h1>설정</h1><p class="lead">키와 토큰은 이 기기 브라우저에만 저장됩니다.</p></section>
  <section class="section narrow">
    <form id="settingsForm" class="form" autocomplete="off">
      <div class="card">
        <div class="card-head">${icon.sparkle}<h2>Claude API 키</h2></div>
        <p class="muted small">타임테이블 분석에 사용합니다. <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>에서 발급받으세요.</p>
        <label>API 키<input type="password" name="anthropicKey" value="${h(s.anthropicKey)}" placeholder="sk-ant-..."></label>
        <button type="button" class="btn ghost" id="testClaude">연결 테스트</button>
      </div>

      <div class="card">
        <div class="card-head">${icon.doc}<h2>저장 위치</h2></div>
        <div class="seg wide" id="modeSeg">
          <button type="button" data-mode="github" class="${s.mode === 'github' ? 'on' : ''}">GitHub 비공개 저장소</button>
          <button type="button" data-mode="local" class="${s.mode === 'local' ? 'on' : ''}">이 기기에만</button>
        </div>
        <div id="ghFields" ${s.mode === 'local' ? 'hidden' : ''}>
          <p class="muted small">폰·PC 어디서든 같은 히스토리를 보려면 GitHub 비공개 저장소에 저장하세요. 토큰은
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained token</a> →
            Repository access: <b>Only select repositories</b>에서 <b>shoot-briefing-data</b>${appRepo() ? ` 와 <b>${h(appRepo().repo)}</b>(접속 코드용)` : ''}를 선택 → Permissions: <b>Contents: Read and write</b>로 만드세요.</p>
          <label>GitHub 아이디<input name="ghOwner" value="${h(s.ghOwner)}" placeholder="예: differ37"></label>
          <label>데이터 저장소 이름<input name="ghRepo" value="${h(s.ghRepo)}" placeholder="shoot-briefing-data"></label>
          <label>토큰<input type="password" name="ghToken" value="${h(s.ghToken)}" placeholder="github_pat_..."></label>
          <button type="button" class="btn ghost" id="testGh">저장소 연결 테스트</button>
        </div>
        <p id="localNote" class="muted small" ${s.mode === 'local' ? '' : 'hidden'}>이 브라우저에만 저장돼요. 다른 기기에서는 보이지 않고, 브라우저 데이터를 지우면 사라집니다.</p>
      </div>

      <div class="card">
        <div class="card-head">${icon.kakao}<h2>카카오내비 바로 실행 <span class="opt">선택</span></h2></div>
        <p class="muted small">비워두면 카카오맵에서 주소를 검색해 길찾기를 누르면 됩니다. <a href="https://developers.kakao.com/console/app" target="_blank" rel="noopener">Kakao Developers</a>에서 앱을 만들고 <b>JavaScript 키</b>를 넣으면, 휴대폰에서 버튼 한 번으로 카카오내비 안내가 바로 시작돼요. (앱 설정 → 플랫폼 → Web 사이트 도메인에 <code>${h(location.origin)}</code> 등록 필요)</p>
        <label>JavaScript 키<input name="kakaoKey" value="${h(s.kakaoKey)}" placeholder="선택 사항"></label>
      </div>

      <button class="btn large block" type="submit">저장</button>
    </form>

    <div class="card vault-card form">
      <div class="card-head">${icon.users}<h2>접속 코드 <span class="opt">다른 기기용</span></h2></div>
      <p class="muted small">위 설정을 기사님만 아는 코드로 암호화해 올려둡니다. 다른 폰·PC에서는 사이트를 열고 <b>접속 코드만 입력</b>하면 돼요.
        암호화된 파일은 공개 위치에 놓이므로 <b>영문+숫자 10자 이상</b>을 권장해요. 코드는 어디에도 저장되지 않으니 꼭 기억해 두세요.</p>
      <p class="small" id="vaultStatus">확인 중…</p>
      ${appRepo() ? `
      <label>접속 코드<input type="password" id="vaultCode" autocomplete="new-password" placeholder="영문+숫자 8자 이상"></label>
      <label>한 번 더<input type="password" id="vaultCode2" autocomplete="new-password"></label>
      <button type="button" class="btn ghost" id="saveVault">접속 코드 저장</button>` : '<p class="muted small">GitHub Pages 주소에서 열었을 때만 쓸 수 있어요.</p>'}
    </div>

    <div class="card">
      <div class="card-head">${icon.trash}<h2>이 기기에서 로그아웃</h2></div>
      <p class="muted small">이 브라우저에 저장된 키와 토큰을 지웁니다. 저장된 타임테이블(GitHub)은 그대로 남아요.</p>
      <button type="button" class="btn ghost danger" id="logout">로그아웃</button>
    </div>
  </section>`, { active: 'settings' });

  fetchVault().then((v) => {
    const el = $('#vaultStatus');
    if (el) el.innerHTML = v ? `${icon.check} 접속 코드가 설정돼 있어요 (${h(new Date(v.updatedAt).toLocaleString('ko-KR'))}). 새로 저장하면 이전 코드는 더 이상 쓸 수 없어요.` : '아직 접속 코드가 없어요.';
  });
  $('#logout').addEventListener('click', (e) => {
    if (!e.target.classList.contains('confirm')) { e.target.classList.add('confirm'); e.target.textContent = '정말 로그아웃할까요? 한 번 더 누르세요'; return; }
    try { localStorage.removeItem(SETTINGS_KEY); } catch {}
    settings = loadSettings();
    library = null;
    toast('로그아웃했어요');
    location.hash = '#/';
  });

  const form = $('#settingsForm');
  let mode = s.mode;
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $$('#modeSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $('#ghFields').hidden = mode === 'local';
    $('#localNote').hidden = mode !== 'local';
  }));
  const values = () => ({ ...Object.fromEntries(new FormData(form)), mode });
  const trimAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));

  $('#testClaude').addEventListener('click', async (e) => {
    const key = values().anthropicKey.trim();
    if (!key) return toast('API 키를 입력하세요');
    e.target.textContent = '확인 중…';
    try { await testKey(key); toast('Claude 연결 성공'); } catch (err) { toast('실패: ' + (err.status ? `${err.status} ` : '') + (err.error?.error?.message || err.message)); }
    e.target.textContent = '연결 테스트';
  });
  $('#testGh').addEventListener('click', async (e) => {
    const v = trimAll(values());
    e.target.textContent = '확인 중…';
    try { await new GitHubStore({ token: v.ghToken, owner: v.ghOwner, repo: v.ghRepo }).check(); toast('저장소 연결 성공 (비공개 확인됨)'); } catch (err) { toast(err.message); }
    e.target.textContent = '저장소 연결 테스트';
  });
  $('#saveVault')?.addEventListener('click', async (e) => {
    const v = trimAll(values());
    const code = $('#vaultCode').value;
    const problem = codeProblem(code);
    if (problem) return toast(problem);
    if (code !== $('#vaultCode2').value) return toast('두 코드가 달라요');
    if (v.mode !== 'github' || !v.ghToken || !v.anthropicKey) return toast('Claude 키와 GitHub 저장소 설정을 먼저 채워 주세요');
    e.target.textContent = '암호화해서 올리는 중…';
    e.target.disabled = true;
    try {
      const vault = await encryptVault(Object.fromEntries(VAULT_FIELDS.map((k) => [k, v[k]])), code);
      const r = appRepo();
      await publishVault(new GitHubStore({ token: v.ghToken, owner: r.owner, repo: r.repo }), vault);
      saveSettings(v);
      $('#vaultCode').value = $('#vaultCode2').value = '';
      $('#vaultStatus').innerHTML = `${icon.check} 접속 코드를 저장했어요. 이제 다른 기기에서 코드만 입력하면 됩니다.`;
      toast('접속 코드를 저장했어요');
    } catch (err) {
      toast(err.status === 403 || err.status === 404
        ? `토큰에 ${appRepo().repo} 저장소 쓰기 권한이 없어요. 토큰 설정에서 저장소를 추가해 주세요.`
        : err.message);
    }
    e.target.textContent = '접속 코드 저장';
    e.target.disabled = false;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = trimAll(values());
    if (v.mode === 'github' && v.ghToken) {
      try { await new GitHubStore({ token: v.ghToken, owner: v.ghOwner, repo: v.ghRepo }).check(); } catch (err) { return toast(err.message); }
    }
    saveSettings(v);
    toast('저장했어요');
    location.hash = '#/';
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
  if (files.length) uploadFiles(files, pickerProject);
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action="upload"]');
  if (!t) return;
  if (!isConfigured()) { toast('먼저 설정을 완료해 주세요'); location.hash = '#/settings'; return; }
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
    if (files.length) uploadFiles(files, null);
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

async function uploadFiles(files, projectId) {
  const sheet = progressSheet();
  let lastProject = null;
  const lib = await getLibrary().catch((e) => { sheet.title('저장소 연결 실패'); sheet.detail(e.message); return null; });
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
      el.querySelector('[data-go]')?.addEventListener('click', () => { sheet.close(); location.hash = `#/p/${encodeURIComponent(lastProject.id)}`; });
      return;
    }
  }
  sheet.finish();
  sheet.title('완료');
  sheet.detail('');
  setTimeout(() => {
    sheet.close();
    const target = `#/p/${encodeURIComponent(lastProject.id)}`;
    if (location.hash === target) route(); else location.hash = target;
  }, 700);
}

route();
