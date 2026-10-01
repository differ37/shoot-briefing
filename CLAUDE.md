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
- `src/pdf.js` — PDF → 개요 1장 + 겹치는 확대 타일 이미지(타임테이블 PDF는 텍스트 레이어 한글이 깨져 있어 이미지로 보냄)
- `src/library.js` — 촬영(project) ⊃ 버전 데이터 관리, 버전 순서(파일명 `v0930_01`), 변경 재계산, 장비집 시간(`project.prep`)
- `src/storage.js` — `GitHubStore`(Contents API) / `LocalStore`(IndexedDB) / `PrefixedStore`(사람별 폴더)
- `src/vault.js` — 아이디/비밀번호 로그인(서버 없음), 공개 계정 목록
- `src/diff.js` — 이전 버전 대비 항목별 NEW/변경 배지
- `src/nav.js` — 네이버지도·카카오맵/내비 연결
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
- 커밋 메시지는 한국어.
