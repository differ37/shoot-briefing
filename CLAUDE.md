# 촬영 브리핑 (shoot-briefing)

촬영팀 장비차량 기사용 타임테이블(콜시트) 브리핑 웹앱. 사용자(jj = 정준연)는 촬영팀 인원·장비를 콜타임에 맞춰 운반하는 기사이고,
타임테이블 PDF는 촬영 당일까지 여러 버전으로 계속 온다. PDF를 올리면 Claude가 분석해 도착 시간·촬영지 주소·이동 동선·
진행표·체크사항·연락처를 정리하고, 새 버전은 이전 버전과의 변경사항을 표시한다. UI·문서는 모두 한국어.

- 사이트: https://differ37.github.io/shoot-briefing/ (이 저장소, 공개 — 비밀 정보 절대 넣지 말 것)
- 데이터: 비공개 저장소 `differ37/shoot-briefing-data`
- 스택: Vite + 바닐라 JS (프레임워크 없음), `@anthropic-ai/sdk`(브라우저 직접 호출), `pdfjs-dist`, `pdf-lib`(큰 PDF 줄이기), `fflate`(엑셀)
- 디자인: 애플 홈페이지 스타일, Paperlogy 폰트, 라이트/다크 모드, **모바일(아이폰) 우선**

## 명령어

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

`main`에 push하면 GitHub Actions(`.github/workflows/deploy.yml`)가 Pages로 배포한다.
**push 전에 항상 `git pull --rebase`** — 앱이 사용자 저장 시 이 저장소의 `public/users/*`, `public/accounts.json`에 직접 커밋한다.

## 화면 구성

- 로그인: 계정 카드(준연·효권·신훈) 선택 → 비밀번호
- 홈(4칸, 2026-11-14 개편): ① 다가오는 촬영(있을 때만 — 큰 카드 + '그다음 촬영' 목록, 없으면 칸 자체를 숨김·안내 문구 없음)
  ② 지난 촬영 칸(건수·최근 촬영) → 누르면 `#/s/<공간>/past` 지난 촬영 목록 화면(`renderPast`) ③ 타임테이블 올리기 ④ 견적서 다운로드(③④는 2열 정사각 타일, 하나만 있으면 한 줄)
- 브리핑(촬영 1건): 제목·날짜(편집 권한이면 눌러서 촬영일 고치기, 고쳤으면 "직접 고침" 표시)·"시간 기록" 버튼 → 동선 요약 → 버전 칩 → **바로가기 바(고정)** →
  내 시간 기록(+ 업무 공유) → 변경사항 → 촬영팀 도착 카드(내비 버튼) → 브리핑 → 촬영지·동선 → 팀별 도착 →
  진행 타임라인(콘티 그림) → 체크사항 → 연락처 → 원본 타임테이블 → 버전 히스토리
- 지난 촬영 목록(`#/s/<공간>/past`): 월별 목록, "‹ 홈"으로 돌아감
- 옆 메뉴: 다른 사람 스케줄 보기, 견적서 만들기, 설정, 로그아웃

## 파일

- `src/main.js` — 라우터·화면 전체(로그인, 홈, 브리핑, 설정, 업로드, 옆 메뉴, 견적서 창, 시간 기록 창, 업무 공유 창, 콘티 크게 보기, 바로가기 바)
- `src/claude.js` — 분석/버전 비교/콘티 맞추기 프롬프트와 JSON 스키마. 모델 `claude-opus-5-5`, structured output, `fallbacks: 'default'`(beta `server-side-fallback-2026-07-01`), 스트리밍.
  `analyzeTimetable`(effort high) · `compareVersions`(medium) · `matchConti`(high)
- `src/pdf.js` — PDF → 개요 1장 + 겹치는 확대 타일 이미지(타임테이블 PDF는 텍스트 레이어 한글이 깨져 있어 이미지로 보냄).
  `pickPages`: 9쪽 이상(PPM 자료 등)이면 시간 글자 3개 이상인 페이지 + 바로 뒤 3쪽(장소·주차 지도)만 분석(최대 12쪽, 못 찾으면 앞 10쪽).
  `makeReducedPdf`: 40MB(`main.js`의 `BIG_PDF`) 넘는 PDF는 고른 페이지만 이미지 PDF(pdf-lib, 원본과 같은 pt 크기)로 줄여 저장 —
  GitHub 100MB 제한·휴대폰 메모리 때문.
  `imagesToPdf`: 사진·캡처 업로드 — 한 번에 고른 사진들을 이름순으로 한 장=한 쪽인 PDF로 묶어(≤12MP, JPEG) 그 뒤는 PDF와 똑같이 처리.
  (PDF는 파일마다 한 버전, 사진은 묶어서 한 버전. 텍스트 레이어가 없어 규칙 방식 콘티·`pickPages` 시간 찾기는 안 됨) 이때 콘티용 그림 위치는 원본에서 미리 뽑아 버전 JSON의 `conti.rows`/`conti.boxes`에, 줄인 정보는 `reduced`에 저장.
  **모든 업로드의 원본을 올린 기기에 보관**하고, 다른 기기에서도 한 번 열면(저장소에서 받으면) 그 기기에 보관 → 브리핑 제목 아래 "원본 PDF" 버튼으로 바로 열림(`openOriginal`).
  원본 자체는 `storage.js`의 `originals`(IndexedDB `shoot-briefing-originals`, 키 `<공간>/<pid>/<vid>`)에 올린 기기에만 보관 →
  원본 칸 "원본 PDF 열기(전체)". 없는 기기는 "원본 파일 선택"으로 받은 파일을 골라 보관. 로그아웃·버전 삭제 시 지움.
  (GitHub Releases는 다운로드 리다이렉트·업로드가 CORS를 막아 브라우저에서 못 씀 — 2026-10-06 확인)
- `src/library.js` — 촬영(project) ⊃ 버전 데이터 관리, 버전 순서(파일명 `v0930_01`), 변경 재계산, `saveVersion`(버전 JSON 고쳐 저장).
  내 시간 기록: 실제 `project.log=[{id,label,time}]` + 계획 `project.plan`(같은 모양, `setLog(pid, entries, 'plan')`) — 화면에선 이름으로 짝지어 계획/실제/차이 표(`logRows`, 시간순, 첫 기록보다 6시간 넘게 이른 시간은 다음날), 요약·업무 공유는 실제 우선·없으면 계획(`effLog`). (예전 `project.prep` 장비집 집합/출발은 `logOf()`가 기록으로 바꿔 보여주고 저장 시 log로 옮김),
  업무 공유에 쓴 값 `project.share={title,date,route,start,end,fee,prod,pd,phone,note,notion?:{ids,lines}}`,
  촬영일 직접 고치기 `setDate(pid, date|null)` → `project.dateFixed=true`면 새 버전이 와도 날짜 유지(null이면 최신 버전 타임테이블 날짜로 되돌림, 촬영 id는 안 바꿈)
  `fixShootDate`: 타임테이블에 연도가 없으면 Claude가 요일만 맞춰 엉뚱한 해(2020)를 고른 적이 있다 → 오늘에서 200일 넘게 떨어진 촬영일은 작년·올해·내년 중 요일이 맞고 가장 가까운 해로 바꾼다(목록 load·버전 읽기·저장 때 자동). 분석 프롬프트에도 오늘 날짜를 넘김.
- `src/storage.js` — `GitHubStore`(Contents API, 1MB 넘으면 raw로 읽음) / `LocalStore`(IndexedDB) / `PrefixedStore`(사람별 폴더) / `originals`(큰 원본 기기 보관)
- `src/vault.js` — 아이디/비밀번호 로그인(서버 없음), 공개 계정 목록, `encryptUser`/`decryptUser`(큰 데이터는 base64 변환을 나눠서)
- `src/diff.js` — 이전 버전 대비 항목별 NEW/변경 배지
- `src/nav.js` — 네이버지도·카카오맵/내비 연결. 카카오 JS 키는 `main.js`의 `SITE_KAKAO_KEY`(공개 키·도메인 제한, Kakao Developers 앱 'beta test'에서 카카오맵 사용 설정 ON 필요). 계정별 설정의 키가 있으면 그게 우선.
  SDK 2.x는 `Kakao.Navi.start`(예전 `Navigation` 아님), `routeInfo: true`로 경로 화면부터.
- `src/quote.js` — 견적서 엑셀 생성. `public/quote-template.xlsx`(실제 견적서에서 개인정보·촬영 내용을 비운 틀)의 시트 XML에 값만 채움(fflate).
  DAY 줄은 15~27행(7일 이하면 한 줄씩 띄움), H12 수식은 `=G28`. 개인정보(이름·원천·전화·계좌)는 비밀번호로 암호화해 각자 공간의 `quote-profile.json`에 저장,
  로그인 때 풀어서 localStorage 설정(`quoteProfile`)에 둔다. **틀이나 코드에 개인정보를 절대 넣지 말 것.**
  원천자료(신분증·통장 사본 이미지)도 같은 방식으로 `quote-source.json`에 암호화 저장, 로그인 때 localStorage `shoot-briefing.source`로(로그아웃 시 삭제).
  `cityOf`(주소 → 시·군 이름), `finalMessage`, `shortRange`, `quoteFileName`. 파일명·문구의 "카메라팀 장비차량기사"는 고정.
- `src/conti.js` — 진행표 항목마다 원본 PDF의 콘티 그림 찾기. **우선순위:**
  ① 버전 JSON의 `contiAI`(Claude가 맞춘 결과 `{boxes:[{n,page,x,y,w,h}], assign:{그림번호: 진행표 index}, at}`) → `mapFromAI`
  ② 없고 편집 권한 + Claude 키가 있으면 `annotatedImages`로 그림마다 빨간 번호를 그린 페이지 이미지(개요+타일)를 만들어
     `matchConti`로 맞추고 `lib.saveVersion`으로 저장 — 처음 열 때 한 번(1분쯤), 진행표 위 "다시 맞추기"로 재실행
  ③ 실패·권한 없음이면 규칙 방식: 텍스트 레이어의 시간 글자("10:00", "06:30 ~ 08:00")로 시작 시간 열을 찾고, 그 열을 가로지르는 표 선·면으로 칸 경계를 잡아
     그림을 칸에 배정 → schedule.start와 순서대로 매칭, 끝 시간 전까지 이어지는 줄의 그림을 모음. 표 머리에 "A CAM…"/"B CAM…"이 있으면 두 열 사이 틈으로 A/B 구분.
     (규칙 방식은 Buick PPM처럼 그림이 칸 경계에 걸치거나 요약표에 시간이 있는 문서에서 틀린다 — 그래서 ②를 만듦)
  썸네일은 페이지를 한 번 렌더링(≤12MP)해 잘라내고(`thumbRenderer`), 크게 보기는 그 영역만 고해상도 렌더링(`renderRegion`).
- `src/typeset.js` — 모바일 줄바꿈 다듬기(화면이 바뀔 때 MutationObserver로 자동 실행). 긴 문장을 쉼표·화살표·연결어미(…며/…고/…므로 등) 뒤에서 마디(`span.ch`, inline-block)로 나눠
  마디 사이에서 줄이 바뀌게 하고(괄호 안은 안 나눔), 번호(02-1, 010-…)는 `span.nb`로 안 끊기게. 제목·주소 등(`FIT` 목록)은 700px 이하 화면에서 글자를 줄여 한 줄에 맞춤.
- `src/profiles.js` — 표시 이름·얼굴 아이콘(jj=준연/정/아이언맨풍, hk=효권/서/슈퍼맨풍, sh=신훈/강/배트맨풍, 자체 SVG)

## 계정·권한

- 3명: `jj`(관리자), `hk`·`sh`(멤버). 모든 기능이 세 계정에 똑같이 적용된다(각자 자기 공간에 저장).
- 사용자별 설정(토큰·Claude 키·카카오 키·권한)을 그 사람 비밀번호로 PBKDF2(60만)+AES-GCM 암호화해 `public/users/<sha256('shoot-briefing:'+id) 앞 12바이트>.json`에 둔다.
  비밀번호는 코드·문서에 넣지 않는다(관리자가 사이트 설정 → 사용자 관리에서 입력). 멤버 설정에도 jj의 Claude 키가 들어 있다.
- 각자 자기 공간에 업로드·시간 기록·삭제. 옆 메뉴로 다른 사람 스케줄 보기. 관리자는 모든 공간 쓰기 가능.
  멤버들은 데이터 저장소 RW 토큰 하나를 공유하므로 "남의 것은 보기 전용"은 화면에서만 강제된다(사용자도 알고 있음).
- **계정 잠금**: 사용자 관리의 "잠그기"(멤버만) → `users.json`·`public/accounts.json`에 `locked:true`. 로그인 카드에서 숨기고 로그인 거절,
  로그인된 멤버 기기는 화면을 열 때(1분 간격·앱 복귀 시) `accounts.json`을 확인해 로그아웃(`lockedOut`). 화면에서 막는 것이라
  확실히 끊으려면 **멤버 토큰을 GitHub에서 폐기**(→ 401 → 자동 로그아웃) — 멤버 파일엔 jj의 Claude 키도 있으니 필요하면 Claude 키도 교체.
- 견적서 개인정보·원천자료는 각자 본인 것을 한 번 입력하고 본인 비밀번호로 저장해야 한다.

## 데이터 레이아웃 (shoot-briefing-data)

- 관리자(jj) 공간 = 저장소 루트: `index.json`, `projects/<pid>/<vid>.{json,pdf,jpg}`, `quote-profile.json`, `quote-source.json`(둘 다 암호화)
- 멤버 공간 = `spaces/<id>/` 아래 같은 구조
- `users.json` — 계정 목록(아이디·권한만)
- 버전 JSON(`<vid>.json`): `analysis`, `changes`, (큰 PDF면) `reduced`·`conti`, (콘티 맞춘 뒤) `contiAI`
- `index.json`의 project: `title, date, weekday, dateFixed, production, versions[], log[], plan[], share{}, myCall{}, stay{}, callTime, callPlace, days{}`
  - `days['YYYY-MM-DD'] = {plan, log, myCall, stay, share}` — 여러 날 촬영의 둘째 날부터(첫날 것은 project 바로 아래)

## 기기(브라우저)에만 저장되는 것 (localStorage / IndexedDB)

- `shoot-briefing.settings` — 로그인 세션(토큰·키·quoteProfile)
- `shoot-briefing.source` — 원천자료 이미지(로그아웃 시 삭제)
- `shoot-briefing.lastPrice` — 마지막 견적 금액
- `shoot-briefing.cityAlias` — 경로 이름 고친 것(예: 고양→일산)
- `shoot-briefing.conti` — 콘티 켜기/끄기
- `shoot-briefing.worklogPass` — 노션 업무일지 비밀번호(업무 공유 → 노션 기록용, 로그아웃 시 삭제)
- IndexedDB `shoot-briefing-originals` — 큰 원본 PDF

## 주의할 점

- pdf.js는 **legacy 빌드**(`pdfjs-dist/legacy/build/pdf.mjs`, 워커도 legacy)를 쓴다 — 기본 빌드는 `Map.getOrInsertComputed`·`Math.sumPrecise` 등
  최신 기능을 그냥 써서 안드로이드(신훈 폰) 등 조금 오래된 브라우저에서 "getOrInsertComputed is not a function"으로 멈췄다(2026-10-17).
- pdf.js `page.render`는 `intent: 'print'` 유지(기본값은 requestAnimationFrame을 써서 백그라운드 탭에서 멈춤).
  pdf.js v6에는 `pdf.destroy()`가 없다 — 메모리 해제는 `pdf.loadingTask.destroy()`.
- 큰 파일은 `openPdf(new Uint8Array(buf))`로 넘겨 복사 없이 연다(ArrayBuffer를 넘기면 복사본을 만든다).
- CSS 클래스 `.hero`는 페이지 상단 섹션용 — 다른 요소에 쓰지 말 것(아바타는 `.avatar.face`).
- 주소 해시(`#/s/<공간>/p/<pid>/<vid>`)는 라우터가 쓴다 — 페이지 안 이동(바로가기)은 해시를 바꾸지 말고 scrollIntoView.
  해시를 같은 값으로 바꾸면 hashchange가 안 일어난다 → `if (location.hash === target) route(); else location.hash = target;`
- `main.js`를 스크립트로 잘라 붙일 때 "// ---- 설정" 같은 구분 주석은 파일에 여러 번 나온다 — 위치를 꼭 확인할 것(한 번 파일이 통째로 중복된 적 있음).
- 화면 시험은 `_localtest/README.md`의 도구가 가장 빠르다(가짜 데이터 자동 주입·390px 스크린샷).
- 로컬 테스트: 설정을 `{mode:'local', role:'admin', userId:'jj', anthropicKey:'x'}`로 localStorage에 넣고 IndexedDB에 테스트 데이터를 넣어 확인. 사용자 관리 화면은 github.io 주소에서만 나온다.
  - 실제 데이터: `gh api repos/differ37/shoot-briefing-data/contents/<경로> -H "Accept: application/vnd.github.raw+json"`로 받아
    `public/__test/`(커밋 금지, 작업 중에만 .gitignore에 추가)에 두고 `LocalStore`에 넣는다. PDF 원본은 `~/Downloads/01. 타임테이블/`,
    Buick PPM(165MB)은 `~/Downloads/1004_buick e7_Client_업데이트 ppm_FN.pdf`.
  - 업로드 흐름은 dropzone에 `DragEvent('drop', {dataTransfer})`를 보내 시험할 수 있다(Claude 단계는 키가 없어 401에서 멈춤).
  - 모바일 화면은 `public/__test/frame.html`에 390px 폭 iframe(`/#/s/jj/...`)을 만들어 보고 줌 스크린샷으로 확인(브라우저 창 크기 변경이 안 먹힘).
    자동화 탭은 hidden 상태라 IntersectionObserver·부드러운 스크롤·페이드 애니메이션이 멈춘다 — 스크린샷을 한 번 찍으면 보이는 상태가 된다.
  - 끝나면 `public/__test/`, .gitignore 줄, IndexedDB(`shoot-briefing`, `shoot-briefing-originals`)·localStorage 테스트 데이터를 지우고 dev 서버를 끈다.
- **이 컴퓨터에는 Claude API 키가 없다**(`ant` 없음, 환경변수 없음) — 실제 Claude 호출(분석·콘티 맞추기)은 사용자가 휴대폰에서 확인해야 한다.
  로그인 비밀번호가 필요한 흐름(실제 로그인, 사용자 관리)도 직접 테스트할 수 없다.
- 배포 후 확인을 부탁할 때는 `?v=N`을 붙인 주소를 준다(GitHub Pages가 HTML을 10분 캐시). **지금까지 v=24까지 썼다** → 다음은 v=25.
- 사용자는 모바일(아이폰)로 주로 본다. 새 화면은 390px 폭에서 줄바꿈·넘침을 꼭 확인할 것.
- push(=배포)는 사용자가 "배포해줘"라고 할 때. 사용자가 휴대폰으로 테스트하며 버그를 알려주는 경우엔 고친 뒤 바로 배포해 왔다.
- 사용자에게는 한국어로, 쉬운 말로 설명한다(개발 용어 최소화). 커밋 메시지는 한국어.

## 작업 기록

### 2026-10-01 ~ 10-02
- 카카오내비 바로 실행 (사용자 확인 완료) — 원인은 ① 카카오맵 사용 설정 OFF ② 키가 PC에만 저장 ③ SDK 2.x 함수 이름(`Navi`). 실패하면 이유를 토스트로 알림.
- 견적서 엑셀 (확인 완료) — 홈 "견적서 다운로드" → 일정(여러 날 가능) 선택 → 날짜별 금액 → 엑셀. 샘플: `~/Downloads/01. 견적서/*.xlsx`(개인정보 포함 — 저장소에 절대 넣지 말 것).
- 최종 문구 + 원천자료 (확인 완료) — `안녕하세요. 9/22~24 <제목> 촬영 건 카메라팀 장비차량기사 <이름> 견적서 및 원천자료 보내드립니다. 며칠 간 고생 많으셨습니다!`
  편집 가능, Web Share로 견적서+원천자료 공유(문구 자동 복사). 큰 이미지 저장 시 스택 초과 버그 수정.
- 진행 타임라인 콘티 그림 (확인 완료) — 썸네일, 크게 보기, A/B CAM 구분, "콘티" 켜기/끄기.
- 모바일 줄바꿈 (확인 완료) — `typeset.js`, 이동 정보 줄 나눔, 촬영지 시간 따로 표시, 내비 버튼 한 줄.
- 로그인 후 "확인 중…"에서 멈춤 수정 (확인 완료).

### 2026-10-05
- 165MB PPM 자료(Buick E7, 26쪽) 업로드가 끊기던 문제 (업로드 성공 확인) — 관련 쪽(19–24)만 분석(이미지 78장→18장),
  원본 복사 제거, 분석 중 화면 꺼짐 방지(Wake Lock), 40MB 넘으면 줄인 PDF(165MB→3MB)로 저장.

### 2026-10-06
- 브리핑 바로가기 바 — 버전 줄 아래 고정 칩 [기록·변경·도착·브리핑·동선·팀별·진행표·체크·연락처·원본], 스크롤 위치 표시. 섹션 id `sec-*`.
- 내 시간 기록 — "+ 기록 추가"(자주 쓰는 이름 칩: 사무실 집합·장비집 집합/출발/도착·현장 도착/출발/종료·업무 종료, 같은 이름 있으면 "현장2 도착"처럼 번호 제안), 눌러서 수정·삭제.
- 업무 공유(카톡) — `제목 / 빈 줄 / 10/2 금 / 용인>일산 / 11:00~25:20 / 견적 550,000`. 집합·종료는 기록에서, 경로는 촬영지 주소의 시·군에서 자동.
  자정 넘으면 25:20. 경로 이름 고친 것(고양→일산)은 기기에 기억.
- 큰 PDF 원본 전체 보기 — 원본은 올린 기기에 보관, 없으면 "원본 파일 선택". (아이폰에서 아직 미확인)
- 콘티를 Claude가 직접 보고 맞추기 (`contiAI`) — Buick에서 그림이 전부 11:00에 몰리던 문제 때문. (**실제 Claude 호출은 아직 미확인**)

### 2026-10-11
- 사진·캡처로도 업로드 (`imagesToPdf`) — 로컬에서 변환·묶기·Claude 호출 직전까지 확인. (배포함 v=15, **실제 분석 결과는 아이폰에서 미확인**)
- 촬영일 직접 고치기 — 타임테이블 날짜가 잘못돼 '지난 촬영'으로 가는 문제. 브리핑의 날짜를 누르면 날짜 선택 창(v=16 배포)
- 보안 점검 후 사용자 요청으로 **효권(hk)·신훈(sh) 계정 잠금**(v=17). 로그인 화면 안내 문구가 숨은 폼 안에 있어 안 보이던 것도 고침.
  멤버 토큰 폐기·Claude 키 교체는 사용자가 직접 해야 함
- 2026-10-17 사용자 요청으로 두 계정 **잠금 해제** (잠금 기능은 그대로 남음)
- 신훈 폰(안드로이드)에서 PDF 변환 단계 오류 `getOrInsertComputed is not a function` → pdf.js legacy 빌드로 교체(v=18). 기능을 지운 흉내 환경에서 오류 재현·해결 확인, 실제 폰은 미확인

### 2026-10-26
- EXO 10/30 타임테이블이 2020년으로 저장돼 '지난 촬영'·D+2187로 보이던 문제 → `fixShootDate`로 자동 보정(데이터 저장소의 index.json·폴더 이름 `2020-10-30-…`은 그대로, 다음 저장 때 날짜만 고쳐짐).
  지난 촬영의 D-day는 "N일 전"(60일 넘으면 숨김). 지난 촬영 목록의 도착 줄이 세로로 쪼개지던 것(flex) 고침.
- 시간 기록을 계획 ↔ 실제 비교표로. 홈·도착 카드 요약은 실제가 없으면 "○○ 예정"(흐리게).
- 원본 PDF 기기 보관·바로 열기. "페이지 보기" 버튼이 await 뒤 `e.currentTarget`이 비어 오류 토스트를 내던 것 고침.
- 로컬 테스트는 `puppeteer-core`(스크래치 폴더에 설치)로 Chrome을 390px 모바일 화면으로 띄워 확인했다(seed 페이지로 IndexedDB·localStorage 채움). (v=19 배포)

### 2026-11-14 ~ 11-15 (모두 사용자 폰에서 확인 완료 — "이제 잘 돼")
- **홈 4칸 개편(v=20)** `renderHome`: ① 다가오는 촬영 큰 카드(+그다음 촬영 목록) — 없으면 칸째 숨김, "예정된 촬영이 없어요" 같은 안내 문구 넣지 말 것(사용자가 싫어함)
  ② 지난 촬영 한 줄 카드 → `#/s/<공간>/past` 목록 화면(`renderPast`, 라우터 `parts[2]==='past'`) ③ 타임테이블 올리기 ④ 견적서 다운로드(③④ 2열 타일, 그라데이션 아이콘).
  공용 함수 `shootRow`·`shootsByMonth`·`splitShoots`·`fillCallTimes`. CSS는 styles.css 끝 "홈: 4칸" 블록(`.tile*`, `.t-icon`, `.tile-pair`).
- **업무 공유 창(v=21)** `openShareSheet`: 칸 전부 펼침 — 현장 집합/종료·견적·제목·날짜·이동 경로·프로덕션명·담당 PD·연락처(숫자만 쳐도 010-0000-0000)·비고.
  **날짜만 자동, 나머지는 빈칸**(전에 입력한 값은 `project.share`에서 다시 채움 — 분석 결과·기록·마지막 견적 자동 채우기는 사용자 요청으로 뺐음).
  보낼 내용 = 날짜 / 제목 / 시간(자정 넘으면 26:00) / 이동 경로 / 견적 / `프로덕션 PD 연락처`(빈 것 빼고 한 칸씩 띄움) / 비고(있을 때만), 빈 줄은 뺌.
  **공유 버튼(관리자 jj 본인 공간만 `toNotion`)** → Web Share(누른 순간 열어야 함)와 동시에 업무일지 Worker `POST /append`로 노션 '🎬 촬영 업무일지' 맨 아래에 빈 줄+한 줄씩 기록.
  첫 줄 날짜는 노션 기존 모양 `11/12(목)미결`로 바꿔 적음(카톡 문구는 `11/12 목`). 기록한 블록 id·줄을 `project.share.notion={ids,lines}`에 저장 →
  다시 공유하면 예전 기록을 지우고 새로 적음(내용이 같으면 안 적음, 노션에서 이미 고친 기록이면 409 → 건드리지 않고 "그대로 뒀어요").
  업무일지 비밀번호는 처음 공유 때 창 안의 칸에 입력 → localStorage `shoot-briefing.worklogPass`(401이면 지움, 로그아웃 시 삭제).
  Worker·업무일지 사이트 코드: `~/Desktop/프로그램/내부파일/촬영_업무일지/`(그쪽 CLAUDE.md에 `/append`·간단 헤더 `11/12 목` 파서 지원 기록). Worker 배포 `cd worker && npx -y wrangler@4 deploy`.
- **원본 PDF 버튼(v=22)** `openOriginal`: PC는 새 탭에서 PDF 바로 열기(팝업 막히면 파일 내려받기). 휴대폰(iPhone/Android)은 Web Share로 PDF 파일(원래 파일 이름)을 넘김 → 공유 창에서 'Acrobat'.
  아이폰 웹에서 Acrobat 앱을 직접 띄워 로컬 파일을 넘기는 방법은 없다(파일이 기기 IndexedDB/비공개 저장소에 있음) — 공유 창이 유일한 길. 공유 창은 누른 순간 열어야 해서
  브리핑 열 때 파일을 미리 준비(`prepOrig` → `origFile`), 준비 전이면 "한 번 더 누르세요".
- **계획 시간 창(v=22~23)** `openPlanSheet`(`PLAN_DEFAULTS`): 한 창에 여러 줄 — 기본 장비집 도착·장비집 출발·현장 도착(+ 이미 있는 계획) + "+ 추가"(이름·시간 직접), 줄마다 × 지우기.
  시간순 자동 정렬(FLIP 애니메이션), 낮 시간이 있으면 0~5시는 다음날로. 시간 빈 줄은 저장 안 함. 표의 계획 칸을 눌러도 이 창(그 줄 시간 칸에 포커스). 실제 기록 창(`openLogSheet`)은 그대로.
  **아이폰 주의(v=23에서 고침):** 시간 휠은 돌리는 중에도 change가 계속 온다 → 그때 DOM을 옮기면 휠이 닫히고 중간 값이 들어감. 정렬은 목록에서 포커스가 빠진 뒤(focusout+250ms)만.
  휠 바깥을 누르면 그 터치가 창 바깥(backdrop)으로 전달돼 창이 닫혔다 → **날짜·시간 칸이 있는 창(촬영일·실제 기록·계획·업무 공유)은 바깥 눌러도 안 닫힘**(취소/닫기만). 새 창을 만들 때도 지킬 것.
- 로컬 화면 시험 도구를 `_localtest/`(커밋 안 함)에 보관 — 사용법은 `_localtest/README.md`. 390px 스크린샷 + 창 열기·입력·노션 호출 가로채기 훅.

### 2026-11-17 (v=24) — B팀·여러 날 촬영·숙소
- 계기: Stray Kids MV 타임테이블(1119-1120)이 이틀치(11/19 DAY2 + 11/20 DAY3)이고, 사용자는 **B팀이라 타임테이블 집합(08:00)과 다른 시간(17:30 광릉초)에 투입**.
- **내 집합** `openDaySheet`: 도착 카드의 "내 집합 · 숙소"(설정 후 "고치기") → 팀(A/B/C 칩 또는 직접), 내 집합 시간, 장소(타임테이블 촬영지 칩 → 이름·주소 채움), 숙소 이름·주소.
  저장 `day.myCall={team,time,place,address}`, `day.stay={name,address}` (`lib.setDayInfo`). 카드: "내 집합 B팀 17:30 광릉초…" + 흐린 "타임테이블 08:00 · 나사…", 숙소 줄(길찾기 버튼 따로).
  다음 날 카드엔 "전날 숙소"도 보임. "타임테이블대로"로 되돌림. 버전 변경 배지는 타임테이블 그대로일 때만. 홈 카드·목록도 내 집합 우선(`callOf`).
- **여러 날** `shootDays`: 촬영일 + `project.days` 키 + 타임테이블 글에 적힌 뒷날(`sheetDays`: call_times·locations·moves·briefing의 `M/D`, 촬영일 뒤 1~6일, `–11/21 03:00`·`익일` 같은 밤샘 끝 시각은 제외).
  브리핑에 날 탭(`.day-tabs`, "+ 날짜"로 직접 추가 `openAddDaySheet`, 직접 추가한 날만 "이 날 빼기"). 탭 고르면 **내 시간 기록·계획·실제·업무 공유·도착 카드**가 그날 것.
  첫날 데이터는 그대로 project 바로 아래(예전 데이터 호환), 다른 날은 `project.days[날짜]` — `dayRec(project, day)`, `lib.dayObj`. `setLog/setShare(..., day)`.
  업무 공유도 날마다 따로(노션 기록도 날마다 한 덩어리). 타임테이블에서 찾은 뒷날은 편집 권한으로 브리핑을 열 때 `days`에 빈 칸으로 저장(`addDays`) → 홈에서 마지막 날까지 '다가오는 촬영'.
  홈은 늘 날짜 기준(오늘/다음 촬영일)의 날을 보여주고, 브리핑의 날 탭 선택(`dayPick`, 메모리)은 브리핑에만.
- 둘째 날 기본 집합은 타임테이블 call_times 중 그 날짜(`11/20`)가 적힌 촬영팀 항목.
- 견적서 창은 아직 촬영 1건 = 하루로 본다(여러 날 촬영을 DAY 여러 줄로 나누는 건 안 함 — 필요하면 다음 작업).
- 시험: `_localtest/shot_real.mjs`(실제 촬영 1건 index 항목+버전 JSON을 넣고 찍기).

## 사용자 취향 (작업 방식)

- 깔끔하고 트렌디한 카드형 UI 선호, 군더더기 안내 문구 싫어함. 폰(아이폰, 다크 모드)으로 보고 스크린샷으로 요청한다.
- 요청은 "이 칸 유지/새로 생성/순서" 식으로 구체적 — 그대로 따르고, 기존 데이터 형식과 어긋나는 부분(예: 노션 날짜 줄 모양)은 맞추되 반드시 알려 줄 것.
- 고친 뒤 바로 배포하고 `?v=N` 주소를 주면 폰에서 확인해 준다.

## 확인 대기 / 다음 후보

- [ ] (v=24) B팀 내 집합·숙소·11/20 둘째 날 기록이 폰에서 잘 되는지
- [ ] 휴대폰 원본 PDF → 공유 창에 Acrobat이 뜨고 열리는지 (명시적 확인은 아직)
- [ ] 업무 공유 → 노션 기록을 실제로 써 봤는지 (Worker는 실제 노션으로 기록·교체·충돌·삭제 시험 완료). 11/12 비트펠라하우스는 노션에 이미 손으로 적혀 있어 공유 누르면 중복됨
- [ ] 원본 PDF 기기 보관(로그아웃하면 지워짐) — 기존 Buick 버전은 "원본 파일 선택"으로 한 번 골라야 함
- [ ] 잠금 해제한 효권·신훈이 실제로 로그인되는지 (멤버 토큰은 폐기하지 않았음 — 사용자 확인 2026-10-17, 그대로 쓰면 됨)
- [ ] Claude 콘티 맞추기 결과가 실제로 맞는지 (Buick·n% 브리핑을 처음 열 때 자동 실행됨) — 사용자 피드백 대기
- [ ] 효권·신훈 님이 카메라팀 장비차량기사가 아니면 견적서 파일명·최종 문구의 직무를 사람별로 설정하게 바꾸기 (사용자 답변 대기)
- 마디 나누기는 연결어미 규칙 기반이라 가끔 애매한 위치("이후" 등)에서 끊긴다.
- 사용자가 계속 휴대폰으로 써보며 개선점을 알려주기로 함.
