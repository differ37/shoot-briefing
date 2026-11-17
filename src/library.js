// 프로젝트(촬영 1건) ⊃ 버전(타임테이블 PDF 1개) 데이터 관리
//
// index.json                       프로젝트/버전 목록
// projects/<pid>/<vid>.json        분석 결과 + 이전 버전 대비 변경사항
// projects/<pid>/<vid>.pdf         원본 PDF
// projects/<pid>/<vid>.jpg         1페이지 썸네일

const INDEX = 'index.json';

export function versionKeyFromName(fileName) {
  const m = fileName.match(/[vV](\d{3,4})(?:[_\-\s.]?(\d{1,2}))?(?!\d)/);
  if (!m) return '';
  return m[1].padStart(4, '0') + (m[2] || '0').padStart(2, '0');
}

export function versionLabelFromName(fileName) {
  const m = fileName.match(/[vV]\d{3,4}(?:[_\-\s.]?\d{1,2})?(?!\d)/);
  return m ? m[0].replace(/^V/, 'v') : '';
}

function fileBase(fileName) {
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[vV]\d{3,4}(?:[_\-\s.]?\d{1,2})?(?!\d)/, '')
    .replace(/[\s_\-.()[\]]+/g, '')
    .toLowerCase();
}

const normTitle = (s) => String(s || '').replace(/[\s\W_]+/g, '').toLowerCase();

function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * 타임테이블에 연도가 없으면 Claude가 엉뚱한 해(예: 요일이 맞는 2020년)를 고르는 일이 있다.
 * 오늘에서 200일 넘게 떨어진 날짜는 같은 월·일로 작년·올해·내년 중 요일이 맞고 오늘에 가장 가까운 해로 바꾼다.
 */
export function fixShootDate(date, weekday) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const at = (y) => new Date(`${y}-${m[2]}-${m[3]}T00:00:00`);
  const dist = (d) => Math.abs(d - today) / 86400000;
  if (dist(at(m[1])) <= 200) return date;
  const y0 = today.getFullYear();
  let cands = [y0 - 1, y0, y0 + 1].filter((y) => at(y).getMonth() + 1 === Number(m[2])); // 2/29 같은 없는 날짜 제외
  const wd = (y) => '일월화수목금토'[at(y).getDay()];
  if (weekday && cands.some((y) => wd(y) === weekday)) cands = cands.filter((y) => wd(y) === weekday);
  if (!cands.length) return date;
  const best = cands.sort((a, b) => dist(at(a)) - dist(at(b)))[0];
  return `${best}-${m[2]}-${m[3]}`;
}

function fixProduction(prod) {
  if (prod?.shoot_date) prod.shoot_date = fixShootDate(prod.shoot_date, prod.weekday);
  return prod;
}

export function compareVersions(a, b) {
  if (a.sortKey && b.sortKey && a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return a.uploadedAt < b.uploadedAt ? -1 : a.uploadedAt > b.uploadedAt ? 1 : 0;
}

export class Library {
  constructor(store) {
    this.store = store;
    this.index = null;
    this.cache = new Map();
  }

  async load() {
    const text = await this.store.getText(INDEX);
    this.index = text ? JSON.parse(text) : { version: 1, projects: [] };
    for (const p of this.index.projects) if (!p.dateFixed && p.date) p.date = fixShootDate(p.date, p.weekday);
    return this.index;
  }

  async saveIndex(message) {
    await this.store.putText(INDEX, JSON.stringify(this.index, null, 2), message);
  }

  project(pid) {
    return this.index.projects.find((p) => p.id === pid);
  }

  sortedVersions(project) {
    return [...project.versions].sort(compareVersions);
  }

  latest(project) {
    const v = this.sortedVersions(project);
    return v[v.length - 1];
  }

  /** 파일명(버전 표기 제거)이 같거나, 촬영일+제목이 같은 기존 프로젝트를 찾는다 */
  guessProject(fileName, analysis) {
    const base = fileBase(fileName);
    const byFile = this.index.projects.find((p) => p.fileBase && p.fileBase === base);
    if (byFile) return byFile;
    if (!analysis) return null;
    const date = analysis.production?.shoot_date;
    const t = normTitle(analysis.production?.project_title);
    return this.index.projects.find((p) => {
      if (!date || p.date !== date) return false;
      const pt = normTitle(p.title);
      return pt && t && (pt.includes(t) || t.includes(pt));
    }) || null;
  }

  async getVersion(pid, vid) {
    const key = `${pid}/${vid}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.store.getText(`projects/${pid}/${vid}.json`).then((t) => {
        const rec = t ? JSON.parse(t) : null;
        fixProduction(rec?.analysis?.production);
        return rec;
      }));
    }
    return this.cache.get(key);
  }

  /** 버전 기록(분석 결과 JSON)을 고쳐 저장 (예: Claude가 맞춘 콘티 결과) */
  async saveVersion(pid, vid, record, message = '버전 기록 갱신') {
    await this.store.putText(`projects/${pid}/${vid}.json`, JSON.stringify(record, null, 2), message);
    this.cache.set(`${pid}/${vid}`, Promise.resolve(record));
  }

  getPdf(pid, vid) {
    return this.store.getBlob(`projects/${pid}/${vid}.pdf`);
  }

  getThumb(pid, vid) {
    return this.store.getBlob(`projects/${pid}/${vid}.jpg`);
  }

  /**
   * 새 버전 저장.
   * compare(prevAnalysis, nextAnalysis, prevLabel, nextLabel) → {summary, changes}
   */
  async addVersion({ fileName, pdfBlob, thumbBlob, analysis, projectId, compare, onStep, extra = {} }) {
    await this.load(); // 다른 기기에서 올린 내용과 충돌하지 않도록 최신 목록부터
    fixProduction(analysis.production);
    let project = projectId ? this.project(projectId) : this.guessProject(fileName, analysis);
    const prod = analysis.production || {};
    if (!project) {
      project = {
        id: `${prod.shoot_date || 'undated'}-${hash(prod.project_title || fileName)}`,
        title: prod.project_title || fileName.replace(/\.pdf$/i, ''),
        date: prod.shoot_date || '',
        weekday: prod.weekday || '',
        production: prod.production_company || '',
        shootType: prod.shoot_type || '',
        fileBase: fileBase(fileName),
        versions: [],
      };
      while (this.project(project.id)) project.id += 'x';
      this.index.projects.push(project);
    } else {
      Object.assign(project, {
        title: prod.project_title || project.title,
        // 사용자가 직접 고친 촬영일(dateFixed)은 새 버전이 와도 그대로 둔다
        date: project.dateFixed ? project.date : prod.shoot_date || project.date,
        weekday: project.dateFixed ? project.weekday : prod.weekday || project.weekday,
        production: prod.production_company || project.production,
        shootType: prod.shoot_type || project.shootType,
      });
    }

    const now = new Date().toISOString();
    const meta = {
      id: Date.now().toString(36),
      fileName,
      label: versionLabelFromName(fileName) || analysis.version_label || now.slice(5, 16).replace('T', ' '),
      sortKey: versionKeyFromName(fileName),
      uploadedAt: now,
      headline: analysis.headline || '',
      changeCount: 0,
      highChangeCount: 0,
    };

    const ordered = [...project.versions, meta].sort(compareVersions);
    const pos = ordered.indexOf(meta);
    const prevMeta = ordered[pos - 1];
    const nextMeta = ordered[pos + 1];

    const record = { ...meta, analysis, changes: null, ...extra };
    if (prevMeta) {
      onStep?.('diff');
      const prev = await this.getVersion(project.id, prevMeta.id);
      if (prev) {
        const c = await compare(prev.analysis, analysis, prevMeta.label, meta.label);
        record.changes = { against: prevMeta.id, againstLabel: prevMeta.label, ...c };
        meta.changeCount = c.changes.length;
        meta.highChangeCount = c.changes.filter((x) => x.importance === 'high').length;
      }
    }

    onStep?.('save');
    const dir = `projects/${project.id}`;
    const msg = `${project.title} ${meta.label}`;
    await this.store.putBlob(`${dir}/${meta.id}.pdf`, pdfBlob, `PDF: ${msg}`);
    if (thumbBlob) await this.store.putBlob(`${dir}/${meta.id}.jpg`, thumbBlob, `썸네일: ${msg}`);
    await this.store.putText(`${dir}/${meta.id}.json`, JSON.stringify(record, null, 2), `분석: ${msg}`);
    this.cache.set(`${project.id}/${meta.id}`, Promise.resolve(record));

    // 예전 버전을 나중에 올린 경우: 바로 다음 버전의 비교 기준을 새로 올린 버전으로 갱신
    if (nextMeta) {
      const next = await this.getVersion(project.id, nextMeta.id);
      if (next) {
        const c = await compare(analysis, next.analysis, meta.label, nextMeta.label);
        next.changes = { against: meta.id, againstLabel: meta.label, ...c };
        nextMeta.changeCount = c.changes.length;
        nextMeta.highChangeCount = c.changes.filter((x) => x.importance === 'high').length;
        await this.store.putText(`${dir}/${nextMeta.id}.json`, JSON.stringify(next, null, 2), `변경사항 재계산: ${project.title} ${nextMeta.label}`);
      }
    }

    project.versions.push(meta);
    project.updatedAt = now;
    if (!nextMeta) {
      // 홈 목록에서 바로 보여줄 최신 도착 정보
      project.callTime = analysis.my_call?.time || '';
      project.callPlace = analysis.my_call?.location_name || '';
    }
    await this.saveIndex(`목록 갱신: ${msg}`);
    return { project, meta };
  }

  /**
   * 내 시간 기록 [{id, label, time}] (버전과 무관하게 촬영 단위로 저장).
   * kind 'log' = 실제로 한 시간(project.log), 'plan' = 미리 계획한 시간(project.plan). 예전 prep(장비집 집합/출발)은 log로 옮긴다
   */
  async setLog(pid, entries, kind = 'log', day = '') {
    await this.load();
    const project = this.project(pid);
    if (!project) throw new Error('촬영을 찾을 수 없어요.');
    const key = kind === 'plan' ? 'plan' : 'log';
    const t = this.dayObj(project, day);
    if (entries.length) t[key] = entries;
    else delete t[key];
    if (key === 'log' && t === project) delete project.prep;
    await this.saveIndex(`${key === 'plan' ? '계획 시간' : '시간 기록'}: ${project.title}`);
  }

  /**
   * 촬영일 직접 고치기 (타임테이블에 날짜가 잘못 적혀 있을 때). date가 없으면 최신 버전의 타임테이블 날짜로 되돌린다.
   * 촬영 id(폴더 이름)는 바꾸지 않는다.
   */
  async setDate(pid, date) {
    await this.load();
    const project = this.project(pid);
    if (!project) throw new Error('촬영을 찾을 수 없어요.');
    if (date) {
      project.date = date;
      project.weekday = '일월화수목금토'[new Date(date + 'T00:00:00').getDay()];
      project.dateFixed = true;
    } else {
      const prod = (await this.getVersion(pid, this.latest(project).id))?.analysis?.production || {};
      project.date = prod.shoot_date || project.date;
      project.weekday = prod.weekday || '';
      delete project.dateFixed;
    }
    await this.saveIndex(`촬영일 ${date ? '수정' : '되돌리기'}: ${project.title}`);
  }

  /** 업무 공유 문구에 쓴 값(제목·경로·시간·견적)을 다음에 다시 쓰도록 저장 (여러 날 촬영이면 그날 것) */
  async setShare(pid, share, day = '') {
    await this.load();
    const project = this.project(pid);
    if (!project) return;
    this.dayObj(project, day).share = share;
    await this.saveIndex(`업무 공유 기록: ${project.title}`);
  }

  /**
   * 여러 날 촬영: 첫날(촬영일) = project 자체, 다른 날 = project.days['YYYY-MM-DD'].
   * 둘 다 같은 모양 {plan, log, myCall, stay, share}
   */
  dayObj(project, day) {
    if (!day || day === project.date) return project;
    project.days ||= {};
    return (project.days[day] ||= {});
  }

  /** 촬영에 날짜 더하기 (타임테이블에 적힌 다른 날 / 직접 추가) */
  async addDays(pid, days) {
    await this.load();
    const project = this.project(pid);
    if (!project) return;
    const add = days.filter((d) => d && d !== project.date && !project.days?.[d]);
    if (!add.length) return;
    add.forEach((d) => this.dayObj(project, d));
    await this.saveIndex(`촬영 날짜 추가: ${project.title}`);
  }

  async removeDay(pid, day) {
    await this.load();
    const project = this.project(pid);
    if (!project?.days?.[day]) return;
    delete project.days[day];
    if (!Object.keys(project.days).length) delete project.days;
    await this.saveIndex(`촬영 날짜 빼기: ${project.title}`);
  }

  /** 그날 내 집합(B팀 등 타임테이블과 다를 때)·숙소. null이면 지움 */
  async setDayInfo(pid, day, { myCall, stay }) {
    await this.load();
    const project = this.project(pid);
    if (!project) throw new Error('촬영을 찾을 수 없어요.');
    const t = this.dayObj(project, day);
    if (myCall) t.myCall = myCall; else delete t.myCall;
    if (stay) t.stay = stay; else delete t.stay;
    await this.saveIndex(`내 일정: ${project.title} ${day}`);
  }

  /** 장비집 집합/출발 시간 (버전과 무관하게 촬영 단위로 저장) */
  async setPrep(pid, { gather = '', depart = '' }) {
    await this.load();
    const project = this.project(pid);
    if (!project) throw new Error('촬영을 찾을 수 없어요.');
    if (gather || depart) project.prep = { gather, depart, updatedAt: new Date().toISOString() };
    else delete project.prep;
    await this.saveIndex(`시간 기록: ${project.title}`);
  }

  async deleteVersion(pid, vid) {
    await this.load();
    const project = this.project(pid);
    if (!project) return;
    const dir = `projects/${pid}`;
    for (const ext of ['pdf', 'jpg', 'json']) {
      await this.store.remove(`${dir}/${vid}.${ext}`, `삭제: ${project.title}`).catch(() => {});
    }
    project.versions = project.versions.filter((v) => v.id !== vid);
    if (!project.versions.length) this.index.projects = this.index.projects.filter((p) => p.id !== pid);
    this.cache.delete(`${pid}/${vid}`);
    await this.saveIndex(`삭제: ${project.title}`);
  }
}
