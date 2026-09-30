import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const str = (description) => ({ type: 'string', description });
const obj = (properties, description) => ({
  type: 'object',
  description,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arr = (items, description) => ({ type: 'array', items, description });

export const BRIEFING_SCHEMA = obj({
  production: obj({
    production_company: str('주최/제작 프로덕션 이름. 문서에 없으면 빈 문자열'),
    agency: str('대행사 이름. 없으면 빈 문자열'),
    client: str('광고주/브랜드. 없으면 빈 문자열'),
    project_title: str('프로젝트(캠페인) 제목. 예: "n% Brand Campaign 1회차"'),
    shoot_type: str('촬영 종류 한 줄. 예: "브랜드 캠페인 광고 촬영 (영상+포토)"'),
    shoot_summary: str('무엇을 찍는 촬영인지 2문장 이내 설명'),
    shoot_date: str('촬영일 YYYY-MM-DD'),
    weekday: str('요일 한 글자. 예: "금"'),
  }),
  version_label: str('문서에 적힌 버전 표기. 없으면 빈 문자열'),
  headline: str('기사에게 가장 중요한 동선 요약. 단계는 " → "로 구분. 예: "11:00 용인 그린피크스튜디오 도착 → 21:20 고양 수작코리아로 이동 → 익일 02:00 종료"'),
  briefing: str('장비차량 기사 관점의 브리핑. 짧은 문장 3~6개(한 문장 40자 안팎)로 쓰고 문장마다 줄바꿈(\\n)으로 구분. 도착 시간·장소·이동·종료 예상·주의점 순서'),
  my_call: obj({
    time: str('촬영팀(카메라팀) 현장 도착 시간 HH:MM'),
    location_name: str('도착해야 하는 장소 이름'),
    address: str('그 장소의 주소'),
    note: str('도착 관련 참고 (세팅 시작, 주차, 반입 등). 없으면 빈 문자열'),
  }, '기사가 촬영팀 인원과 장비를 싣고 도착해야 하는 기준'),
  locations: arr(obj({
    name: str('장소 이름'),
    address: str('도로명/지번 주소 전체. 동·호수 포함'),
    role: str('예: "1차 촬영지 (스튜디오)", "2차 촬영지 (수중 촬영)"'),
    time_range: str('이 장소에서 머무는 대략의 시간대. 예: "10:00–21:20"'),
    note: str('주차/반입/층수 등 참고. 없으면 빈 문자열'),
  }), '촬영지 목록. 방문 순서대로'),
  moves: arr(obj({
    time: str('이동 시작 시간 HH:MM (범위면 "21:20–23:00")'),
    from: str('출발 장소 이름'),
    to: str('도착 장소 이름'),
    who: str('누가 이동하는지. 예: "전체 스태프", "메인 모델"'),
    note: str('식사 겸 이동 등 참고'),
  }), '촬영지 간 이동. 장비차량 이동이 필요한 전체 로케이션 이동을 반드시 포함. 없으면 빈 배열'),
  call_times: arr(obj({
    time: str('HH:MM. 미정이면 "TBD"'),
    team: str('팀/인원 이름. 예: "촬영팀", "조명팀", "메인 모델(유로님)"'),
    location_name: str('도착 장소(명시된 경우). 없으면 빈 문자열'),
    is_camera_team: { type: 'boolean', description: '촬영팀(카메라팀)이면 true' },
    note: str('참고. 없으면 빈 문자열'),
  }), '팀별 현장 도착(콜) 시간 전부'),
  schedule: arr(obj({
    start: str('HH:MM'),
    end: str('HH:MM. 없으면 빈 문자열'),
    minutes: { type: 'integer', description: '소요 분. 모르면 0' },
    next_day: { type: 'boolean', description: '자정을 넘긴 다음날 시간이면 true' },
    track: str('"A CAM", "B CAM" 또는 "전체"'),
    kind: { type: 'string', enum: ['촬영', '세팅', '이동', '식사', '휴식', '교육', '포토', '종료', '기타'] },
    title: str('짧은 제목. 예: "HOUSE 가족 씬 촬영 (C#26)"'),
    location_name: str('촬영 장소/세트. 예: "HOUSE", "WHITE HORIZON", "수중(WATER)"'),
    details: str('주요 컷·준비물·특이사항. 짧은 문장으로, 여러 항목이면 줄바꿈(\\n)으로 구분'),
  }), '시간 순 진행표. A/B CAM이 병행되면 각각 행으로'),
  wrap_time: str('촬영 종료 예정 시간 HH:MM (다음날이면 "익일 02:00")'),
  checks: arr(obj({
    level: { type: 'string', enum: ['critical', 'important', 'info'] },
    text: str('체크사항. 짧은 한 문장(40자 안팎)'),
  }), '기사/촬영팀 입장에서 중요한 체크사항. 빨간 글씨·별표·강조 표시, 안전교육, 장비(달리/크로마키/수중/특효 등), 식사, 늦은 종료, 퇴근 인원 등'),
  contacts: arr(obj({
    role: str('예: "PD", "AD", "제작실장"'),
    name: str('이름'),
    phone: str('전화번호 010-0000-0000 형식'),
  }), '문서에 적힌 담당자와 연락처 전부'),
});

export const CHANGES_SCHEMA = obj({
  summary: str('이전 버전 대비 핵심 변경 1~2문장. 변경이 없으면 "변경사항 없음"'),
  changes: arr(obj({
    category: { type: 'string', enum: ['도착시간', '장소', '이동', '진행', '종료', '체크사항', '연락처', '인원', '기타'] },
    importance: { type: 'string', enum: ['high', 'medium', 'low'] },
    title: str('무엇이 바뀌었는지 짧게'),
    before: str('이전 값. 새로 생긴 항목이면 빈 문자열'),
    after: str('변경된 값. 삭제된 항목이면 빈 문자열'),
    driver_impact: str('장비차량 기사에게 미치는 영향 한 문장. 영향 없으면 빈 문자열'),
  })),
});

const SYSTEM_BRIEFING = `당신은 광고·영상 촬영 현장의 "촬영팀 장비차량 기사"를 돕는 비서입니다.
기사는 촬영팀 인원과 카메라 장비를 차에 싣고 촬영팀 콜타임에 맞춰 촬영지에 도착시키는 일을 합니다.
사용자가 보내는 것은 한 촬영의 타임테이블(콜시트) PDF를 페이지별로 렌더링한 이미지입니다.
각 페이지마다 "전체 개요" 이미지 1장과, 작은 글씨를 읽을 수 있도록 확대해 겹치게 자른 "타일" 이미지들이 순서대로 주어집니다. 타일은 서로 겹치므로 같은 내용을 두 번 세지 마세요.

규칙:
- 문서에 실제로 적힌 내용만 추출하세요. 추측으로 채우지 말고, 없는 값은 빈 문자열로 두세요.
- 주소·전화번호·시간은 한 글자도 틀리지 않게 확대 타일을 보고 정확히 옮기세요.
- 촬영팀(카메라팀) 도착 시간과 장소가 기사에게 가장 중요합니다. 로케이션 이동(촬영지 변경)이 있으면 반드시 moves에 넣으세요.
- 빨간 글씨, 별표(*), 강조 박스로 표시된 주의사항은 checks에 넣으세요.
- 모든 텍스트는 한국어로 쓰세요. 휴대폰에서 읽기 쉽게 한 문장은 짧게 끊고, 긴 내용은 여러 문장으로 나눠 줄바꿈하세요.`;

const SYSTEM_DIFF = `당신은 촬영팀 장비차량 기사를 돕는 비서입니다.
같은 촬영의 타임테이블 분석 결과 두 개(이전 버전, 새 버전)를 비교해 실제로 바뀐 점만 정리하세요.
표현만 달라지고 의미가 같은 것은 변경으로 치지 마세요.
기사의 운행에 영향을 주는 변경(도착 시간, 장소/주소, 로케이션 이동, 종료 시간)은 importance를 high로 표시하세요.`;

function client(apiKey) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

async function runStructured(apiKey, { system, content, schema, effort, maxTokens, onText }) {
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  };
  const c = client(apiKey);
  const run = async (p, beta) => {
    const stream = beta ? c.beta.messages.stream(p) : c.messages.stream(p);
    if (onText) stream.on('text', onText);
    return stream.finalMessage();
  };
  let message;
  try {
    // 안전 분류기가 요청을 거절하면 서버가 자동으로 다른 모델로 재시도하도록 fallbacks 사용
    message = await run({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, true);
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    if (/fallback/i.test(String(err.message))) {
      message = await run(params, false);
    } else {
      // 구조화 출력(스키마)이 거부된 경우: 스키마를 프롬프트로 주고 일반 JSON 응답으로 재시도
      console.warn('structured output rejected, retrying as plain JSON', err.message);
      const { format, ...rest } = params.output_config;
      message = await run({
        ...params,
        output_config: rest,
        system: `${system}\n\n반드시 아래 JSON 스키마를 따르는 JSON 객체 하나만 출력하세요. 코드블록·설명 없이 JSON만.\n${JSON.stringify(schema)}`,
      }, false);
    }
  }
  if (message.stop_reason === 'refusal') throw new Error('Claude가 이 문서의 분석을 거절했습니다.');
  if (message.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 중간에 잘렸습니다. 다시 시도해 주세요.');
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return { data: JSON.parse(json), usage: message.usage };
}

export async function analyzeTimetable(apiKey, { images, fileName, onText }) {
  const content = [];
  for (const img of images) {
    content.push({ type: 'text', text: `[${img.label}]` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.data } });
  }
  content.push({
    type: 'text',
    text: `파일명: ${fileName}\n위 타임테이블을 장비차량 기사 관점에서 분석해 주세요.`,
  });
  return runStructured(apiKey, {
    system: SYSTEM_BRIEFING,
    content,
    schema: BRIEFING_SCHEMA,
    effort: 'high',
    maxTokens: 32000,
    onText,
  });
}

export async function compareVersions(apiKey, { prev, next, prevLabel, nextLabel }) {
  const content = [
    {
      type: 'text',
      text: `<previous version="${prevLabel}">\n${JSON.stringify(prev, null, 1)}\n</previous>\n\n<new version="${nextLabel}">\n${JSON.stringify(next, null, 1)}\n</new>\n\n이전 버전 대비 새 버전에서 바뀐 점을 정리해 주세요.`,
    },
  ];
  return runStructured(apiKey, {
    system: SYSTEM_DIFF,
    content,
    schema: CHANGES_SCHEMA,
    effort: 'medium',
    maxTokens: 16000,
  });
}

export async function testKey(apiKey) {
  const res = await client(apiKey).messages.create({
    model: MODEL,
    max_tokens: 64,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: 'OK라고만 답하세요.' }],
  });
  return res.content.some((b) => b.type === 'text');
}
