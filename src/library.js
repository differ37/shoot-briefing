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
      this.cache.set(key, this.store.getText(`projects/${pid}/${vid}.json`).then((t) => (t ? JSON.parse(t) : null)));
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
        date: prod.shoot_date || project.date,
        weekday: prod.weekday || project.weekday,
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

  /** 내 시간 기록 [{id, label, time}] (버전과 무관하게 촬영 단위로 저장). 예전 prep(장비집 집합/출발)은 여기로 옮긴다 */
  async setLog(pid, entries) {
    await this.load();
    const project = this.project(pid);
    if (!project) throw new Error('촬영을 찾을 수 없어요.');
    if (entries.length) project.log = entries;
    else delete project.log;
    delete project.prep;
    await this.saveIndex(`시간 기록: ${project.title}`);
  }

  /** 업무 공유 문구에 쓴 값(제목·경로·시간·견적)을 다음에 다시 쓰도록 저장 */
  async setShare(pid, share) {
    await this.load();
    const project = this.project(pid);
    if (!project) return;
    project.share = share;
    await this.saveIndex(`업무 공유 기록: ${project.title}`);
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
