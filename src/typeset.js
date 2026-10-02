// 모바일 줄바꿈 다듬기
//
// 1) 마디 나누기: 긴 문장을 쉼표·화살표·연결어미(…며, …고, …므로 등) 뒤에서 마디로 나눠 inline-block으로 감싼다.
//    줄이 넘칠 때 단어 중간이 아니라 마디 사이에서 줄이 바뀌어 읽기 쉬워진다. 괄호 안에서는 나누지 않는다.
// 2) 한 줄 맞춤: 제목·주소처럼 한 줄이 보기 좋은 요소는 글자를 조금씩 줄여 한 줄에 맞춘다(최소 크기까지).
//    그래도 넘치면 원래 크기로 돌리지 않고 최소 크기에서 마디 단위로 줄바꿈한다.

const SKIP = 'input, textarea, select, button, svg, script, style, .nochunk, .ch, .nb';
// 마디 경계 뒤 (괄호 밖에서만 적용)
const ENDINGS = /(?:며|고|지만|는데|므로|도록|으면|하면|면서|하여|해서|이후|후|뒤|때)$/;

function splitChunks(text) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    buf += c;
    if (depth > 0 || c !== ' ') continue;
    const prev = buf.slice(0, -1);
    const word = prev.split(' ').pop();
    const next = text.slice(i + 1);
    const boundary =
      /[,，]$/.test(prev) || // 쉼표 뒤
      /(?:→|->|·|\/)$/.test(prev) || // 화살표·가운뎃점·슬래시 뒤
      /^(?:→|·|\/)/.test(next) || // 화살표 앞
      next.startsWith('(') || // 괄호 앞
      (word.length >= 2 && ENDINGS.test(word.replace(/[,.]$/, '')));
    if (boundary) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  // 너무 짧은 마디는 앞 마디에 붙인다 (예: "등" 한 글자만 따로 놀지 않게)
  const merged = [];
  for (const s of out) {
    if (merged.length && (s.trim().length < 5 || merged[merged.length - 1].trim().length < 5)) merged[merged.length - 1] += s;
    else merged.push(s);
  }
  return merged;
}

// "02-1", "132-17", "010-1234-5678" 같은 번호는 하이픈에서 끊기지 않게
const CODE = /[0-9A-Za-z#]+(?:[-–~][0-9A-Za-z]+)+/g;
function withCodes(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const nb = document.createElement('span');
    nb.className = 'nb';
    nb.textContent = m[0];
    frag.appendChild(nb);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

export function chunkText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim().length >= 6 && !n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const text = n.nodeValue;
    const parts = text.trim().length >= 14 ? splitChunks(text) : [text];
    const hasCode = CODE.test(text);
    CODE.lastIndex = 0;
    if (parts.length < 2 && !hasCode) continue;
    if (parts.length < 2) { n.replaceWith(withCodes(text)); continue; }
    const frag = document.createDocumentFragment();
    parts.forEach((p, i) => {
      const span = document.createElement('span');
      span.className = 'ch';
      span.appendChild(withCodes(p.replace(/ $/, '')));
      frag.appendChild(span);
      if (i < parts.length - 1) frag.appendChild(document.createTextNode(' '));
    });
    n.replaceWith(frag);
  }
}

// [선택자, 최소 글자 크기(px)]
const FIT = [
  ['.project-hero h1', 22],
  ['.f-title', 20],
  ['.eyebrow', 11],
  ['.call-where strong', 18],
  ['.call-where > span', 13],
  ['.stop-head strong', 16],
  ['.stop-addr', 13],
  ['.stop-role', 12],
  ['.call-place', 13],
  ['.tl-title strong', 14],
  ['.sr-body strong', 14],
  ['.f-prod', 12],
  ['.sr-sub', 12],
  ['.flow li', 13],
];

function fit(el, min) {
  el.style.fontSize = '';
  // 줄바꿈을 막으면 그리드·플렉스 칸이 늘어나므로, 지금 폭을 고정해 놓고 잰다
  const width = el.clientWidth;
  el.style.width = `${width}px`;
  el.style.whiteSpace = 'nowrap';
  let size = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > width + 1 && size > min) {
    size = Math.max(min, size - 0.5);
    el.style.fontSize = `${size}px`;
  }
  el.style.whiteSpace = '';
  el.style.width = '';
}

export function fitLines(root) {
  if (window.innerWidth > 700) {
    root.querySelectorAll('[data-fit]').forEach((el) => { el.style.fontSize = ''; el.removeAttribute('data-fit'); });
    return;
  }
  for (const [sel, min] of FIT) {
    root.querySelectorAll(sel).forEach((el) => {
      if (!el.clientWidth) return; // 숨겨진 요소
      el.setAttribute('data-fit', '');
      fit(el, min);
    });
  }
}

/** 화면이 바뀔 때마다 자동으로 다듬는다 */
export function installTypeset(target = document.body) {
  let queued = false;
  const run = () => {
    queued = false;
    chunkText(target);
    fitLines(target);
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  new MutationObserver((muts) => {
    // 우리가 만든 마디(span.ch)·글자 크기 변경만으로는 다시 돌리지 않는다
    const relevant = (n) => (n.nodeType === 1 ? !n.classList.contains('ch') && !n.classList.contains('nb') : n.nodeType === 3 && n.nodeValue.trim().length >= 6);
    if (muts.some((m) => [...m.addedNodes].some(relevant))) queue();
  }).observe(target, { childList: true, subtree: true });
  let w = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth !== w) { w = window.innerWidth; queue(); } });
  document.fonts?.ready.then(queue);
  document.fonts?.addEventListener?.('loadingdone', queue); // 웹폰트가 늦게 오면 폭이 달라진다
  queue();
}
