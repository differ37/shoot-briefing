import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSET_BASE = new URL('./pdfjs/', document.baseURI).href;

/** data가 ArrayBuffer면 복사해서 넘긴다(호출한 쪽 버퍼 보존). 큰 파일은 Uint8Array로 넘기면 복사 없이 워커로 옮겨진다. */
export async function openPdf(data) {
  return pdfjsLib.getDocument({
    data: data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : data,
    cMapUrl: ASSET_BASE + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: ASSET_BASE + 'standard_fonts/',
    wasmUrl: ASSET_BASE + 'wasm/',
    iccUrl: ASSET_BASE + 'iccs/',
  }).promise;
}

async function renderPage(pdf, pageNo, targetWidth) {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // intent 'print' → requestAnimationFrame을 쓰지 않아 앱을 전환해도(백그라운드) 렌더링이 멈추지 않는다
  await page.render({ canvasContext: ctx, canvas, viewport, intent: 'print' }).promise;
  return canvas;
}

function crop(src, x, y, w, h, maxEdge) {
  const s = Math.min(1, maxEdge / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

const toB64 = (canvas, q = 0.88) => canvas.toDataURL('image/jpeg', q).split(',')[1];

/**
 * 타임테이블 PDF는 글자가 매우 작고, 텍스트 레이어의 한글 인코딩이 깨진 경우가 많다.
 * 그래서 각 페이지를 고해상도로 렌더링한 뒤 전체 개요 1장 + 겹치는 타일 여러 장으로 잘라 Claude에게 이미지로 보낸다.
 */
export async function pdfToAnalysisImages(pdf, onProgress, pages = null) {
  const images = [];
  const TILE = 1500;
  const OVERLAP = 120;
  const list = pages || Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  for (const [n, p] of list.entries()) {
    onProgress?.(`페이지 ${p} 렌더링 중 (${n + 1}/${list.length})`);
    const page = await renderPage(pdf, p, 2800);
    const W = page.width, H = page.height;
    images.push({ label: `${p}페이지 전체 개요`, data: toB64(crop(page, 0, 0, W, H, 1568)) });
    const cols = Math.max(1, Math.ceil((W - OVERLAP) / (TILE - OVERLAP)));
    const rows = Math.max(1, Math.ceil((H - OVERLAP) / (TILE - OVERLAP)));
    const tw = Math.ceil((W + OVERLAP * (cols - 1)) / cols);
    const th = Math.ceil((H + OVERLAP * (rows - 1)) / rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.min(W - tw, c * (tw - OVERLAP));
        const y = Math.min(H - th, r * (th - OVERLAP));
        images.push({
          label: `${p}페이지 확대 타일 (위에서 ${r + 1}번째 줄, 왼쪽에서 ${c + 1}번째 칸)`,
          data: toB64(crop(page, Math.max(0, x), Math.max(0, y), tw, th, 1600)),
        });
      }
    }
  }
  return images;
}

export async function pdfThumbnail(pdf, width = 720, pageNo = 1) {
  const canvas = await renderPage(pdf, pageNo, width);
  const c = crop(canvas, 0, 0, canvas.width, Math.min(canvas.height, Math.round(canvas.width * 1.25)), width);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
}

export async function renderPagesInto(pdf, container, width) {
  container.innerHTML = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const canvas = await renderPage(pdf, p, width);
    canvas.className = 'pdf-page';
    container.appendChild(canvas);
  }
}

/**
 * PPM 자료처럼 쪽수가 많은 PDF에서 촬영 일정과 관련된 페이지만 고른다.
 * - 8쪽 이하: 전부
 * - 시간 글자("06:30")가 3개 이상인 페이지 = 타임테이블, 그 바로 뒤 3쪽까지(장소·주차 지도 등)
 * - 그런 페이지가 없으면(스캔본 등) 앞 10쪽
 */
export async function pickPages(pdf) {
  const all = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  if (pdf.numPages <= 8) return { pages: all, picked: false };
  const isTable = [];
  for (const p of all) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const text = tc.items.map((t) => t.str).join(' ');
    isTable[p] = (text.match(/\b\d{1,2}:\d{2}\b/g) || []).length >= 3;
  }
  const set = new Set();
  for (const p of all) {
    if (!isTable[p]) continue;
    set.add(p);
    if (!isTable[p + 1]) for (let k = 1; k <= 3 && p + k <= pdf.numPages && !isTable[p + k]; k++) set.add(p + k);
  }
  const pages = set.size ? [...set].sort((a, b) => a - b).slice(0, 12) : all.slice(0, 10);
  return { pages, picked: true, found: set.size > 0 };
}

/**
 * 고른 페이지만 고화질 이미지로 다시 만든 가벼운 PDF (원본이 너무 커서 저장소에 못 올릴 때).
 * 페이지 크기(pt)를 원본과 같게 두어 콘티 그림 위치(좌표)가 그대로 맞는다.
 */
export async function makeReducedPdf(pdf, pages, onProgress) {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const [n, p] of pages.entries()) {
    onProgress?.(`가벼운 PDF 만드는 중 (${n + 1}/${pages.length})`);
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.sqrt(8e6 / (base.width * base.height)));
    const canvas = await renderPage(pdf, p, Math.round(base.width * scale));
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    canvas.width = canvas.height = 0;
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const pg = out.addPage([base.width, base.height]);
    pg.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
  }
  return new Blob([await out.save()], { type: 'application/pdf' });
}
