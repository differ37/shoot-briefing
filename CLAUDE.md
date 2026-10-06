# 촬영 브리핑 (shoot-briefing)

촬영팀 장비차량 기사용 타임테이블(콜시트) 브리핑 웹앱. 사용자는 촬영팀 인원·장비를 콜타임에 맞춰 운반하는 기사이고,
타임테이블 PDF는 촬영 당일까지 여러 버전으로 계속 온다. PDF를 올리면 Claude가 분석해 도착 시간·촬영지 주소·이동 동선·
진행표·체크사항·연락처를 정리하고, 새 버전은 이전 버전과의 변경사항을 표시한다. UI·문서는 모두 한국어.

- 사이트: https://differ37.github.io/shoot-briefing/ (이 저장소, 공개 — 비밀 정보 절대 넣지 말 것)
- 데이터: 비공개 저장소 `differ37/shoot-briefing-data`
- 스택: Vite + 바닐라 JS (프레임워크 없음), `@anthropic-ai/sdk`(브라우저 직접 호출), `pdfjs-dist`
- 디자인: 애플 홈페이지 스타일, Paperlogy 폰트, 라이트/다크 모드, 모바일 우선

## 명령어

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

`main`에 push하면 GitHub Actions(`.github/workflows/deploy.yml`)가 Pages로 배포한다.
**push 전에 항상 `git pull --rebase`** — 앱이 사용자 저장 시 이 저장소의 `public/users/*`, `public/accounts.json`에 직접 커밋한다.

## 파일

- `src/main.js` — 라우터·화면 전체(로그인, 홈, 브리핑, 설정, 업로드, 시간 작성 팝업, 옆 메뉴)
- `src/claude.js` — 분석/버전 비교 프롬프트와 JSON 스키마. 모델 `claude-opus-5-5`, structured output, `fallbacks: 'default'`
- `src/pdf.js` — PDF → 개요 1장 + 겹치는 확대 타일 이미지(타임테이블 PDF는 텍스트 레이어 한글이 깨져 있어 이미지로 보냄).
  `pickPages`: 9쪽 이상(PPM 자료 등)이면 시간 글자 3개 이상인 페이지 + 바로 뒤 3쪽(장소·주차 지도)만 분석(최대 12쪽, 못 찾으면 앞 10쪽).
  `makeReducedPdf`: 40MB(`BIG_PDF`) 넘는 PDF는 고른 페이지만 이미지 PDF(pdf-lib, 원본과 같은 pt 크기)로 줄여 저장 —
  GitHub 100MB 제한·휴대폰 메모리 때문. 이때 콘티 위치는 원본에서 미리 뽑아 버전 JSON의 `conti.rows`에, 줄인 정보는 `reduced`에 저장.
  원본 자체는 `storage.js`의 `originals`(IndexedDB `shoot-briefing-originals`, 키 `<공간>/<pid>/<vid>`)에 올린 기기에만 보관 →
  원본 칸 "원본 PDF 열기(전체)". 없는 기기는 "원본 파일 선택"으로 받은 파일을 골라 보관. 로그아웃·버전 삭제 시 지움.
  (GitHub Releases는 다운로드 리다이렉트·업로드가 CORS를 막아 브라우저에서 못 씀 — 2026-10-06 확인)
- `src/library.js` — 촬영(project) ⊃ 버전 데이터 관리, 버전 순서(파일명 `v0930_01`), 변경 재계산.
  내 시간 기록 `project.log=[{id,label,time}]`(예전 `project.prep` 장비집 집합/출발은 `logOf()`가 기록으로 바꿔 보여주고 저장 시 log로 옮김),
  업무 공유에 쓴 값 `project.share={title,date,route,start,end,fee}`
- `src/storage.js` — `GitHubStore`(Contents API) / `LocalStore`(IndexedDB) / `PrefixedStore`(사람별 폴더)
- `src/vault.js` — 아이디/비밀번호 로그인(서버 없음), 공개 계정 목록
- `src/diff.js` — 이전 버전 대비 항목별 NEW/변경 배지
- `src/nav.js` — 네이버지도·카카오맵/내비 연결. 카카오 JS 키는 `main.js`의 `SITE_KAKAO_KEY`(공개 키·도메인 제한, Kakao Developers 앱 'beta test'에서 카카오맵 사용 설정 ON 필요). 계정별 설정의 키가 있으면 그게 우선
- `src/quote.js` — 견적서 엑셀 생성. `public/quote-template.xlsx`(실제 견적서에서 개인정보·촬영 내용을 비운 틀)의 시트 XML에 값만 채움(fflate).
  DAY 줄은 15~27행(7일 이하면 한 줄씩 띄움), H12 수식은 `=G28`. 개인정보(이름·원천·전화·계좌)는 비밀번호로 암호화해 각자 공간의 `quote-profile.json`에 저장,
  로그인 때 풀어서 localStorage 설정(`quoteProfile`)에 둔다. **틀이나 코드에 개인정보를 절대 넣지 말 것.**
  원천자료(신분증·통장 사본 이미지)도 같은 방식으로 `quote-source.json`에 암호화 저장, 로그인 때 localStorage `shoot-briefing.source`로(로그아웃 시 삭제).
  "최종 문구 생성" = PD에게 보낼 메시지 + 견적서·원천자료 파일 공유(Web Share API, 안 되면 복사·다운로드).
- `src/conti.js` — 진행표 줄마다 원본 PDF의 콘티 그림 찾기. 텍스트 레이어의 시간 글자("10:00")로 시작 시간 열을 찾고, 그 열을 가로지르는 표 선·면으로 칸 경계를 잡아
  그림을 칸에 배정 → schedule.start와 순서대로 매칭하고 끝 시간 전까지 이어지는 줄의 그림을 모은다.
  표 머리에 "A CAM…"/"B CAM…" 글자가 있으면 두 열 사이 틈을 경계로 그림을 A/B로 나눠, 항목의 track에 맞는 쪽만 보여준다.
  **우선순위 (2026-10-06~):** ① 버전 JSON의 `contiAI`(Claude가 맞춘 결과 `{boxes:[{n,page,x,y,w,h}], assign:{그림번호: 진행표 index}}`)
  ② 없고 편집 권한+Claude 키가 있으면 `annotatedImages`로 그림마다 빨간 번호를 그린 페이지 이미지(개요+타일)를 만들어
  `claude.js`의 `matchConti`(structured output)로 맞추고 `lib.saveVersion`으로 저장 — 처음 열 때 한 번, "다시 맞추기"로 재실행
  ③ 실패·권한 없음이면 위 규칙 방식. 규칙 방식은 Buick PPM처럼 그림이 칸 경계에 걸친 표에서 틀리기 쉬움.
  시간 글자는 "06:30 ~ 08:00" 범위도 인식. 큰 PDF는 줄일 때 그림 위치 전체를 `conti.boxes`에 저장(줄인 PDF엔 그림 정보가 없음). 썸네일은 페이지를 한 번 렌더링(≤12MP)해 잘라내고, 크게 보기는 그 영역만 고해상도 렌더링.
- `src/typeset.js` — 모바일 줄바꿈 다듬기(화면이 바뀔 때 자동 실행). 긴 문장을 쉼표·화살표·연결어미(…며/…고/…므로 등) 뒤에서 마디(`span.ch`, inline-block)로 나눠
  마디 사이에서 줄이 바뀌게 하고(괄호 안은 안 나눔), 번호(02-1, 010-…)는 `span.nb`로 안 끊기게. 제목·주소 등(`FIT` 목록)은 700px 이하 화면에서 글자를 줄여 한 줄에 맞춤.
- `src/profiles.js` — 표시 이름·얼굴 아이콘(jj=준연/정/아이언맨풍, hk=효권/서/슈퍼맨풍, sh=신훈/강/배트맨풍, 자체 SVG)

## 계정·권한

- 3명: `jj`(관리자), `hk`·`sh`(멤버). 첫 화면에서 계정 카드 선택 → 비밀번호.
- 사용자별 설정(토큰·Claude 키·권한)을 그 사람 비밀번호로 PBKDF2(60만)+AES-GCM 암호화해 `public/users/<sha256('shoot-briefing:'+id) 앞 12바이트>.json`에 둔다.
  비밀번호는 코드·문서에 넣지 않는다(관리자가 사이트 설정 → 사용자 관리에서 입력).
- 각자 자기 공간에 업로드·시간 작성·삭제. 옆 메뉴로 다른 사람 스케줄 보기. 관리자는 모든 공간 쓰기 가능.
  멤버들은 데이터 저장소 RW 토큰 하나를 공유하므로 "남의 것은 보기 전용"은 화면에서만 강제된다(사용자도 알고 있음).

## 데이터 레이아웃 (shoot-briefing-data)

- 관리자(jj) 공간 = 저장소 루트: `index.json`, `projects/<pid>/<vid>.{json,pdf,jpg}`
- 멤버 공간 = `spaces/<id>/` 아래 같은 구조
- `users.json` — 계정 목록(아이디·권한만)

## 주의할 점

- pdf.js `page.render`는 `intent: 'print'` 유지(기본값은 requestAnimationFrame을 써서 백그라운드 탭에서 멈춤).
- CSS 클래스 `.hero`는 페이지 상단 섹션용 — 다른 요소에 쓰지 말 것(아바타는 `.avatar.face`).
- 로컬 테스트: 설정을 `{mode:'local', role:'admin', userId:'jj', anthropicKey:'x'}`로 localStorage에 넣고 IndexedDB에 테스트 데이터를 넣어 확인. 사용자 관리 화면은 github.io 주소에서만 나온다.
  - 실제 데이터로 보려면 `gh api repos/differ37/shoot-briefing-data/contents/<경로> -H "Accept: application/vnd.github.raw+json"`로 받아
    `public/__test/`(커밋 금지, 작업 중에만 .gitignore에 추가)에 두고 `LocalStore`에 넣는다. PDF 원본은 `~/Downloads/01. 타임테이블/`에도 있다.
  - 모바일 화면은 `public/__test/frame.html`에 390px 폭 iframe(`/#/s/jj/...`)을 만들어 보고 줌 스크린샷으로 확인(브라우저 창 크기 변경이 안 먹힘).
    자동화 탭은 hidden 상태라 IntersectionObserver(콘티 자동 로드)가 안 돈다 — 스크린샷을 한 번 찍으면 보이는 상태가 된다.
  - 끝나면 `public/__test/`, .gitignore 줄, IndexedDB·localStorage 테스트 데이터를 지운다.
- 로그인 비밀번호가 필요한 흐름(실제 로그인, 사용자 관리)은 직접 테스트할 수 없다 — 사용자에게 휴대폰에서 확인을 부탁한다.
- 배포 후 확인을 부탁할 때는 `?v=N`을 붙인 주소를 준다(GitHub Pages가 HTML을 10분 캐시). 지금까지 v=10까지 썼다.
- 사용자는 모바일(아이폰)로 주로 본다. 새 화면은 390px 폭에서 줄바꿈·넘침을 꼭 확인할 것(`src/typeset.js` 참고).
- push(=배포)는 사용자가 "배포해줘"라고 할 때. 사용자가 휴대폰으로 테스트하며 버그를 알려주는 경우엔 고친 뒤 바로 배포해 왔다.
- 커밋 메시지는 한국어.

## 작업 기록 (2026-10-01 ~ 10-02)

완료된 기능 (모두 배포됨, 사용자 휴대폰에서 동작 확인):
- 카카오내비 바로 실행 — 앱 'beta test'의 카카오맵 사용 설정 ON + `SITE_KAKAO_KEY` + SDK 2.x `Kakao.Navi.start({..., routeInfo: true})`.
  실패하면 이유를 토스트로 알리고 카카오맵으로 연다.
- 견적서 — 홈 "견적서 다운로드"/옆 메뉴 → 일정(여러 날 가능) 선택 → 날짜별 금액 → 엑셀 다운로드 또는 "최종 문구 생성".
  샘플: `~/Downloads/01. 견적서/*.xlsx`(개인정보 포함 — 저장소에 절대 넣지 말 것). 파일명·날짜·내용 형식은 샘플을 그대로 따름.
- 최종 문구 — `안녕하세요. 9/22~24 <제목> 촬영 건 카메라팀 장비차량기사 <이름> 견적서 및 원천자료 보내드립니다. 며칠 간 고생 많으셨습니다!`
  (하루면 "고생 많으셨습니다!"). 편집 가능, Web Share로 견적서+원천자료 공유(문구 자동 복사), 카톡은 글이 빠질 수 있어 붙여넣기 안내.
- 진행 타임라인 콘티 그림 — 줄마다 썸네일, 눌러서 크게 보기, A/B CAM 열 구분. "콘티" 버튼으로 켜고 끔.
- 모바일 줄바꿈 — 마디 단위 줄바꿈, 제목·주소 한 줄 맞춤, 이동 정보 줄 나눔, 내비 버튼 한 줄.
- 로그인 후 "확인 중…"에서 멈추던 문제(이미 같은 주소일 때 hashchange 없음) 수정.
- 브리핑 바로가기 바(2026-10-06) — 버전 줄 아래 고정되는 [기록·도착·브리핑·동선·팀별·진행표·체크·연락처·원본] 칩, 스크롤 위치 표시.
  섹션 id는 `sec-*`. 주소 해시(#/s/…)는 라우터가 쓰므로 바로가기는 해시를 바꾸지 않고 scrollIntoView.
- 내 시간 기록(2026-10-06) — 브리핑 맨 위 "내 시간 기록"에 +로 추가(자주 쓰는 이름 칩, 같은 이름 있으면 "현장2 도착"처럼 번호 제안), 눌러서 수정·삭제.
- 업무 공유(2026-10-06) — 카톡용 `제목 / 빈 줄 / 10/2 금 / 용인>일산 / 11:00~25:20 / 견적 550,000`.
  집합·종료는 기록("현장 도착/집합", "현장 종료")에서, 경로는 촬영지 주소의 시·군에서 자동. 자정 넘으면 25:20처럼 표기.
  경로 이름을 고치면(고양→일산) localStorage `shoot-briefing.cityAlias`에 기억해 다음부터 자동 적용.
- 165MB PPM 자료(26쪽) 업로드가 끊기던 문제 (2026-10-05) — 관련 쪽만 분석(78장→18장), 원본 복사 제거(Uint8Array로 넘김),
  분석 중 화면 꺼짐 방지(Wake Lock), 40MB 넘으면 줄인 PDF(165MB→3MB)로 저장.

알려진 한계 / 다음 후보:
- 콘티 매칭은 텍스트 레이어의 시간 글자와 표 선에 의존 — 형식이 다른 타임테이블에선 그림이 안 나오거나 A/B 구분이 안 될 수 있다.
- 마디 나누기는 연결어미 규칙 기반이라 가끔 애매한 위치("이후" 등)에서 끊긴다.
- 사용자가 계속 휴대폰으로 써보며 개선점을 알려주기로 함.
