# 촬영 브리핑

촬영팀 장비차량 기사용 타임테이블(콜시트) 브리핑 웹앱.
PDF를 올리면 Claude(claude-opus-5-5)가 도착 시간·촬영지 주소·이동 동선·진행표·체크사항·담당자 연락처를 정리하고,
새 버전이 올라오면 이전 버전과의 변경사항을 표시합니다.

- 앱 코드: 이 저장소 (GitHub Pages로 배포, 비밀 정보 없음)
- 데이터: 별도 **비공개** 저장소 `shoot-briefing-data` (index.json + projects/<촬영>/<버전>.{json,pdf,jpg})
- API 키·토큰은 각 기기 브라우저(localStorage)에만 저장

## 개발

```bash
npm install
npm run dev
```

`main` 브랜치에 push하면 GitHub Actions가 빌드 후 Pages에 배포합니다.
