// 이전 버전 분석과 비교해 화면에 "NEW / 변경" 배지를 붙이기 위한 필드 단위 비교.
// (Claude가 만든 변경사항 요약과 별개로, 각 항목 옆에 즉시 보이도록 로컬에서 계산)

const norm = (s) => String(s ?? '').replace(/[\s·.,()\-–—_:'"‘’“”/]/g, '').toLowerCase();

function byKey(list, keyFn) {
  const m = new Map();
  for (const it of list || []) m.set(keyFn(it), it);
  return m;
}

export function computeMarks(prev, cur) {
  const marks = {
    myCall: {},
    callTimes: new Map(),
    locations: new Map(),
    moves: new Map(),
    schedule: new Map(),
    checks: new Map(),
    contacts: new Map(),
    wrap: null,
  };
  if (!prev || !cur) return marks;

  const mc = prev.my_call || {}, cc = cur.my_call || {};
  if (norm(mc.time) !== norm(cc.time)) marks.myCall.time = mc.time || '없음';
  if (norm(mc.address) !== norm(cc.address)) marks.myCall.address = mc.address || '없음';
  if (norm(mc.location_name) !== norm(cc.location_name)) marks.myCall.location = mc.location_name || '없음';

  const pCalls = byKey(prev.call_times, (c) => norm(c.team));
  (cur.call_times || []).forEach((c, i) => {
    const p = pCalls.get(norm(c.team));
    if (!p) marks.callTimes.set(i, { type: 'new' });
    else if (norm(p.time) !== norm(c.time)) marks.callTimes.set(i, { type: 'changed', before: p.time });
  });

  const pLocs = byKey(prev.locations, (l) => norm(l.name));
  const pAddrs = new Set((prev.locations || []).map((l) => norm(l.address)));
  (cur.locations || []).forEach((l, i) => {
    const p = pLocs.get(norm(l.name));
    if (p && norm(p.address) !== norm(l.address)) marks.locations.set(i, { type: 'changed', before: p.address });
    else if (!p && !pAddrs.has(norm(l.address))) marks.locations.set(i, { type: 'new' });
  });

  const pMoves = byKey(prev.moves, (m) => norm(m.from) + '>' + norm(m.to));
  (cur.moves || []).forEach((m, i) => {
    const p = pMoves.get(norm(m.from) + '>' + norm(m.to));
    if (!p) marks.moves.set(i, { type: 'new' });
    else if (norm(p.time) !== norm(m.time)) marks.moves.set(i, { type: 'changed', before: p.time });
  });

  const timeSig = (s) => `${norm(s.track)}|${s.start}|${s.end}`;
  const prevFull = new Set((prev.schedule || []).map((s) => timeSig(s) + '|' + norm(s.title)));
  const prevTimes = byKey(prev.schedule, timeSig);
  const prevTitles = byKey(prev.schedule, (s) => norm(s.track) + '|' + norm(s.title));
  (cur.schedule || []).forEach((s, i) => {
    if (prevFull.has(timeSig(s) + '|' + norm(s.title))) return;
    const sameTitle = prevTitles.get(norm(s.track) + '|' + norm(s.title));
    if (sameTitle) marks.schedule.set(i, { type: 'changed', before: `${sameTitle.start}–${sameTitle.end}` });
    else if (prevTimes.has(timeSig(s))) marks.schedule.set(i, { type: 'changed', before: prevTimes.get(timeSig(s)).title });
    else marks.schedule.set(i, { type: 'new' });
  });

  const pChecks = new Set((prev.checks || []).map((c) => norm(c.text)));
  (cur.checks || []).forEach((c, i) => !pChecks.has(norm(c.text)) && marks.checks.set(i, { type: 'new' }));

  const pContacts = byKey(prev.contacts, (c) => norm(c.name));
  (cur.contacts || []).forEach((c, i) => {
    const p = pContacts.get(norm(c.name));
    if (!p) marks.contacts.set(i, { type: 'new' });
    else if (norm(p.phone) !== norm(c.phone)) marks.contacts.set(i, { type: 'changed', before: p.phone });
  });

  if (norm(prev.wrap_time) !== norm(cur.wrap_time)) marks.wrap = prev.wrap_time || '없음';
  return marks;
}
