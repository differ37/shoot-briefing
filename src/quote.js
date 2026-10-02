// 견적서(엑셀) 만들기
//
// public/quote-template.xlsx = 실제로 제출하던 견적서에서 개인정보·촬영 내용을 비운 틀.
// 틀의 셀 서식은 그대로 두고 값만 채워 넣는다(시트 XML 직접 수정).
// 개인정보(이름·원천·전화·계좌)는 그 사람 비밀번호로 암호화해 데이터 저장소 공간의 quote-profile.json에 둔다.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { encryptUser, decryptUser } from './vault.js';

const PROFILE_PATH = 'quote-profile.json';
const SHEET = 'xl/worksheets/sheet1.xml';
// DAY 줄: 7일까지는 샘플처럼 한 줄씩 띄우고, 더 많으면 15~27행을 모두 쓴다
const FIRST_ROW = 15;
const LAST_ROW = 27;
export const MAX_DAYS = LAST_ROW - FIRST_ROW + 1;
export const DEFAULT_ITEM = '카메라팀 장비 차량';
const WEEK = '일월화수목금토';

// ---------------------------------------------------------------- 개인정보
export async function loadProfile(store, userId, pw) {
  const text = await store.getText(PROFILE_PATH);
  if (!text) return null;
  return decryptUser(userId, pw, JSON.parse(text));
}

export async function hasSavedProfile(store) {
  return !!(await store.getText(PROFILE_PATH));
}

export async function saveProfile(store, userId, pw, profile) {
  const file = await encryptUser(userId, pw, profile);
  await store.putText(PROFILE_PATH, JSON.stringify(file) + '\n', '견적서 개인정보 갱신(암호화)');
}

// 원천자료(신분증·통장 사본 이미지)도 같은 방식으로 암호화해 둔다: { type, data(base64) }
const SOURCE_PATH = 'quote-source.json';
export async function loadSource(store, userId, pw) {
  const text = await store.getText(SOURCE_PATH);
  return text ? decryptUser(userId, pw, JSON.parse(text)) : null;
}
export async function hasSavedSource(store) {
  return !!(await store.getText(SOURCE_PATH));
}
export async function saveSource(store, userId, pw, source) {
  const file = await encryptUser(userId, pw, source);
  await store.putText(SOURCE_PATH, JSON.stringify(file) + '\n', '견적서 원천자료 갱신(암호화)');
}

/** 고른 이미지 파일 → 긴 변 2000px JPEG (신분증 글씨가 읽히는 정도) */
export async function prepareSourceImage(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return { type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.9).split(',')[1] };
}

export const sourceDataUrl = (src) => (src ? `data:${src.type};base64,${src.data}` : '');
export function sourceFile(src, name) {
  const bin = Uint8Array.from(atob(src.data), (c) => c.charCodeAt(0));
  return new File([bin], `${name || ''} 원천자료.jpg`.trim(), { type: src.type });
}

// ---------------------------------------------------------------- 기본값
/** "경기도 용인시 처인구 …" → "용인", "서울특별시 성동구 …" → "서울" */
export function cityOf(address) {
  const tokens = String(address || '').trim().split(/\s+/);
  const metro = tokens[0]?.match(/^(서울|부산|대구|인천|광주|대전|울산|세종)/);
  if (metro) return metro[1];
  const t = tokens.slice(0, 3).find((x, i) => /[시군]$/.test(x) && !(i === 0 && /도$/.test(x)));
  return t ? t.replace(/(특별자치시|시|군)$/, '') : '';
}

const md = (date) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
};
const weekdayOf = (date) => WEEK[new Date(date + 'T00:00:00').getDay()];

/** 샘플 형식: "9/22 화성 로얄앤컴퍼니 로케이션 촬영" */
export function defaultContent(date, analysis) {
  const call = analysis?.my_call || {};
  const loc = analysis?.locations?.[0] || {};
  const place = call.location_name || loc.name || '';
  const city = cityOf(call.address || loc.address);
  const name = city && place.startsWith(city) ? place : [city, place].filter(Boolean).join(' ');
  return [date ? md(date) : '', name, '촬영'].filter(Boolean).join(' ');
}

/** "2026/9/14(월)", "2026/9/22,23,24(화,수,목)", "2026/9/30,10/1(수,목)" */
export function dateLine(dates) {
  const ds = [...dates].sort();
  if (!ds.length) return '';
  let prevMonth = null;
  const parts = ds.map((d, i) => {
    const [y, m, day] = d.split('-').map(Number);
    const s = i === 0 ? `${y}/${m}/${day}` : m === prevMonth ? `${day}` : `${m}/${day}`;
    prevMonth = m;
    return s;
  });
  return `${parts.join(',')}(${ds.map(weekdayOf).join(',')})`;
}

/** "9월22일~9월24일 TWS-내 이름을 불러줘 촬영 건 카메라팀 장비차량기사 정준연 견적서.xlsx" */
export function quoteFileName(dates, title, name) {
  const ds = [...dates].sort();
  const k = (d) => {
    const [, m, day] = d.split('-').map(Number);
    return `${m}월${day}일`;
  };
  const when = ds.length ? (ds.length > 1 ? `${k(ds[0])}~${k(ds[ds.length - 1])}` : k(ds[0])) : '';
  const raw = [when, title, '촬영 건 카메라팀 장비차량기사', name, '견적서'].filter(Boolean).join(' ');
  return raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.xlsx';
}

/** "9/14", "9/22~24", "9/30~10/1" */
export function shortRange(dates) {
  const ds = [...dates].sort();
  if (!ds.length) return '';
  const [, m1, d1] = ds[0].split('-').map(Number);
  if (ds.length === 1) return `${m1}/${d1}`;
  const [, m2, d2] = ds[ds.length - 1].split('-').map(Number);
  return `${m1}/${d1}~${m1 === m2 ? d2 : `${m2}/${d2}`}`;
}

/** PD에게 보내는 마지막 메시지 (샘플 문구 형식) */
export function finalMessage({ dates, title, name, withSource }) {
  const what = withSource ? '견적서 및 원천자료' : '견적서';
  const thanks = dates.length > 1 ? '며칠 간 고생 많으셨습니다!' : '고생 많으셨습니다!';
  return `안녕하세요. ${shortRange(dates)} ${title} 촬영 건 카메라팀 장비차량기사 ${name} ${what} 보내드립니다. ${thanks}`;
}

// ---------------------------------------------------------------- 엑셀 생성
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setCell(xml, ref, value) {
  const re = new RegExp(`<c r="${ref}"( s="\\d+")?[^>]*?(?:/>|>.*?</c>)`);
  if (!re.test(xml)) throw new Error(`견적서 틀에 ${ref} 칸이 없어요`);
  return xml.replace(re, (_, s = '') => {
    if (value === '' || value == null) return `<c r="${ref}"${s}/>`;
    if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  });
}

const setCached = (xml, formula, value) => xml.replace(`<f>${formula}</f><v>0</v>`, `<f>${formula}</f><v>${value}</v>`);

/**
 * q = { dates: ['2026-09-22', …], to, title, profile: {name, idAddr, phone, bank},
 *       days: [{ label: 'DAY1', item, content, price }] }
 */
export async function buildQuote(q) {
  if (q.days.length > MAX_DAYS) throw new Error(`한 견적서에는 ${MAX_DAYS}일까지 넣을 수 있어요`);
  const res = await fetch(`${import.meta.env.BASE_URL}quote-template.xlsx`);
  if (!res.ok) throw new Error('견적서 틀을 불러오지 못했어요');
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  let xml = strFromU8(files[SHEET]);
  const p = q.profile || {};
  const cells = {
    C6: dateLine(q.dates),
    C7: q.to,
    G7: q.title,
    G8: p.name,
    G9: p.idAddr,
    G10: p.phone,
    B30: p.bank ? `*${p.bank.replace(/^\*/, '')}` : '',
  };
  const step = q.days.length * 2 - 1 <= MAX_DAYS ? 2 : 1;
  q.days.forEach((d, i) => {
    const r = FIRST_ROW + i * step;
    Object.assign(cells, { [`B${r}`]: d.label || `DAY${i + 1}`, [`C${r}`]: d.item, [`D${r}`]: d.content, [`G${r}`]: Number(d.price) || 0 });
  });
  for (const [ref, v] of Object.entries(cells)) xml = setCell(xml, ref, v);
  // 엑셀은 열 때 다시 계산하지만(fullCalcOnLoad), 미리보기 앱은 저장된 값을 보여주므로 합계도 채운다
  const total = q.days.reduce((s, d) => s + (Number(d.price) || 0), 0);
  xml = setCached(setCached(setCached(xml, 'SUM(G15:G27)', total), 'G28', total), 'H12', total);
  files[SHEET] = strToU8(xml);
  const out = zipSync(files, { level: 6 });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
