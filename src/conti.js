// 원본 타임테이블에서 진행표 줄마다 콘티 그림 찾기
//
// 타임테이블 PDF는 한글 텍스트 레이어가 깨져 있어도 "10:00" 같은 시간 글자와 그림(이미지) 위치는 정확하다.
// 1) 페이지마다 시작 시간 열(시간 글자가 가장 많이 세로로 늘어선 왼쪽 열)을 찾아 진행표 줄 목록을 만들고
// 2) 각 그림을 세로 위치가 가장 가까운 줄에 붙인 다음
// 3) Claude가 정리한 진행표(schedule)의 시작 시간을 PDF 줄에 순서대로 맞춘다.
// 그림은 페이지 전체를 렌더링하지 않고 그 영역만 잘라 렌더링한다(휴대폰 메모리 절약).
import * as pdfjsLib from 'pdfjs-dist';

const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const toMin = (s) => {
  const m = String(s || '').trim().match(TIME_RE);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

// 그림 영역과 선·면(표 칸 테두리/배경) 영역을 화면 좌표(왼쪽 위 원점)로 모은다
async function pageShapes(page, vp) {
  const OPS = pdfjsLib.OPS;
  const ops = await page.getOperatorList();
  const images = [];
  const boxes = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const toBox = (pts) => {
    const v = pts.map(([x, y]) => vp.convertToViewportPoint(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
    const xs = v.map((q) => q[0]), ys = v.map((q) => q[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  ops.fnArray.forEach((fn, i) => {
    const a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) images.push(toBox([[0, 0], [1, 0], [0, 1], [1, 1]]));
    else if (fn === OPS.constructPath) {
      const mm = a?.[2]; // [minX, minY, maxX, maxY]
      if (mm && mm.length === 4 && Number.isFinite(mm[0])) boxes.push(toBox([[mm[0], mm[1]], [mm[2], mm[1]], [mm[0], mm[3]], [mm[2], mm[3]]]));
    }
  });
  return {
    // 아이콘·배경·로고 제외
    images: images.filter((b) => b.w >= 36 && b.h >= 28 && b.w < vp.width * 0.5 && b.h < vp.height * 0.5),
    boxes: boxes.filter((b) => b.h < vp.height * 0.5),
  };
}

function timeRows(items, vp) {
  const times = items
    .map((t) => {
      const [x, y] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
      return { min: toMin(t.str), x, y };
    })
    .filter((t) => t.min != null);
  if (!times.length) return [];
  // x 좌표로 열을 묶고, 가장 많이 나오는 열들 중 가장 왼쪽 = 시작 시간 열
  const cols = new Map();
  for (const t of times) {
    const k = Math.round(t.x / 12);
    cols.set(k, (cols.get(k) || 0) + 1);
  }
  const max = Math.max(...cols.values());
  if (max < 3) return [];
  const startCol = Math.min(...[...cols].filter(([, n]) => n >= max * 0.6).map(([k]) => k));
  return times.filter((t) => Math.abs(Math.round(t.x / 12) - startCol) <= 1).sort((a, b) => a.y - b.y);
}

/** → { rows: [{page, min, y, images:[{x,y,w,h}]}] } (모든 페이지, 순서대로) */
export async function extractConti(pdf, pages = null) {
  const rows = [];
  for (const p of pages || Array.from({ length: pdf.numPages }, (_, i) => i + 1)) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const [tc, { images, boxes }] = await Promise.all([page.getTextContent(), pageShapes(page, vp)]);
    const times = timeRows(tc.items, vp);
    if (!times.length) continue;
    const pr = times.map((t) => ({ page: p, min: t.min, y: t.y, images: [] }));
    // 시간 열을 가로지르는 선·면의 위/아래 = 표의 가로 경계선
    const cx = times[0].x + 8;
    const edges = [...new Set(boxes.filter((b) => b.x <= cx && b.x + b.w >= cx).flatMap((b) => [b.y, b.y + b.h]).map((y) => Math.round(y)))].sort((a, b) => a - b);
    for (const r of pr) {
      const mid = r.y - 4; // 글자 기준선보다 조금 위 = 글자 가운데
      r.top = edges.filter((e) => e < mid - 2).pop() ?? -Infinity;
      r.bottom = edges.find((e) => e > mid + 2) ?? Infinity;
    }
    // 표 머리의 "A CAM …" / "B CAM …" 글자로 A·B 캠 열을 나눈다 (두 열 사이 그림이 없는 가장 넓은 틈 = 경계)
    const heads = {};
    for (const t of tc.items) {
      const m = t.str.match(/^\s*([AB])\s*CAM\b/i);
      if (!m) continue;
      const [x, y] = vp.convertToViewportPoint(t.transform[4], t.transform[5]);
      if (y < times[0].y && !heads[m[1].toUpperCase()]) heads[m[1].toUpperCase()] = x + (t.width || 0) / 2;
    }
    let split = null;
    if (heads.A != null && heads.B != null && heads.A < heads.B) {
      const spans = images.map((b) => [b.x, b.x + b.w]).filter(([l, r]) => r > heads.A && l < heads.B).sort((a, b) => a[0] - b[0]);
      let best = { gap: 0, at: (heads.A + heads.B) / 2 };
      let reach = heads.A;
      for (const [l, r] of spans) {
        if (l - reach > best.gap) best = { gap: l - reach, at: (reach + l) / 2 };
        reach = Math.max(reach, r);
      }
      if (heads.B - reach > best.gap) best = { gap: heads.B - reach, at: (reach + heads.B) / 2 };
      split = best.at;
    }
    for (const b of images) {
      b.page = p;
      if (split != null) b.side = b.x + b.w / 2 < split ? 'A' : 'B';
    }
    const top = pr[0].y - 40;
    for (const b of images) {
      const cy = b.y + b.h / 2;
      if (cy < top) continue; // 표 위쪽(제목·로고 등)
      // 그림 가운데가 들어가는 칸 → 없으면 세로로 가장 가까운 줄
      let best = pr.find((r) => cy > r.top && cy < r.bottom && Number.isFinite(r.top) && Number.isFinite(r.bottom));
      if (!best) {
        best = pr[0];
        for (const r of pr) if (Math.abs(r.y - cy) < Math.abs(best.y - cy)) best = r;
      }
      best.images.push(b);
    }
    for (const r of pr) r.images.sort((a, b) => a.y - b.y || a.x - b.x);
    rows.push(...pr);
  }
  return { rows };
}

/**
 * 진행표 항목 → 그 항목의 콘티 그림 목록.
 * PDF 순서를 따라가며 시작 시간이 같은 줄을 찾고, 항목의 끝 시간 전까지 이어지는 줄의 그림을 모은 뒤
 * 항목이 A CAM / B CAM이면 그 캠 열의 그림만 남긴다.
 */
export function matchSchedule(schedule, rows) {
  const result = new Map();
  let cursor = 0;
  const lastByMin = new Map();
  (schedule || []).forEach((s, i) => {
    const min = toMin(s.start);
    if (min == null) return;
    let idx = -1;
    for (let k = cursor; k < rows.length; k++) if (rows[k].min === min) { idx = k; break; }
    if (idx >= 0) {
      lastByMin.set(min, idx);
      cursor = idx + 1;
    } else if (lastByMin.has(min)) {
      idx = lastByMin.get(min); // A캠 다음에 나오는 같은 시간의 B캠 항목 등
    }
    if (idx < 0) return;
    const end = toMin(s.end);
    const dur = end == null ? 0 : (end - min + 1440) % 1440;
    const picked = [rows[idx]];
    for (let k = idx + 1; k < rows.length && dur > 0; k++) {
      const delta = (rows[k].min - min + 1440) % 1440;
      if (delta === 0 || delta >= dur) break;
      picked.push(rows[k]);
    }
    const track = String(s.track || '').trim().toUpperCase();
    const side = /^A\b|^A\s*CAM/.test(track) ? 'A' : /^B\b|^B\s*CAM/.test(track) ? 'B' : null;
    const images = picked.flatMap((r) => r.images).filter((b) => !side || !b.side || b.side === side);
    if (images.length) result.set(i, { images });
  });
  return result;
}

/** PDF의 한 영역만 렌더링해 Blob(JPEG)으로 */
export async function renderRegion(pdf, pageNo, box, targetWidth = 640) {
  const page = await pdf.getPage(pageNo);
  const scale = Math.min(6, targetWidth / box.w);
  const viewport = page.getViewport({ scale, offsetX: -box.x * scale, offsetY: -box.y * scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * scale));
  canvas.height = Math.max(1, Math.round(box.h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport, intent: 'print' }).promise;
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
}

/**
 * 썸네일용: 페이지를 한 번만 렌더링해 두고(휴대폰 캔버스 한도 안에서) 그림 영역을 잘라낸다.
 * renderRegion을 그림마다 부르면 복잡한 페이지에서 그림 하나에 1초 가까이 걸린다.
 */
export function thumbRenderer(pdf, maxPixels = 12e6) {
  const pages = new Map();
  const pageCanvas = (pageNo) => {
    if (!pages.has(pageNo)) {
      pages.set(pageNo, (async () => {
        const page = await pdf.getPage(pageNo);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, Math.sqrt(maxPixels / (base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, canvas, viewport, intent: 'print' }).promise;
        return { canvas, scale };
      })());
    }
    return pages.get(pageNo);
  };
  return async (pageNo, box, height) => {
    const { canvas, scale } = await pageCanvas(pageNo);
    const sw = box.w * scale, sh = box.h * scale;
    const s = Math.min(1, height / sh);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * s));
    c.height = Math.max(1, Math.round(sh * s));
    c.getContext('2d').drawImage(canvas, box.x * scale, box.y * scale, sw, sh, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  };
}
