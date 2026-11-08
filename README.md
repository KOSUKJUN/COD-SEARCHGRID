# COD-SEARCHGRID

SIEM / Splunk 스타일 **로그 검색 그리드** Vue 3 컴포넌트 라이브러리.

> 📘 사용자 · 개발자 매뉴얼 (Word): [docs/manual/COD-SEARCHGRID-Manual-ko.docx](docs/manual/COD-SEARCHGRID-Manual-ko.docx)
> — `npm run manual:shots` 로 스크린샷, `npm run manual` 로 문서를 다시 생성합니다.

- SPL 스타일 쿼리: `error`, `"phrase"`, `host=web-*`, `severity!=info`, `dest_port>=1024`, `NOT blocked`, `geo.country=KR`
- 가상 스크롤 (수십만 행) + 원격 데이터 소스 무한 스크롤
- 검색어 하이라이트, 컬럼 정렬 / 폭 조절, 심각도 색상
- **Group by 패널**: 컬럼 헤더를 드래그(또는 `+ 그룹 추가`)해서 다단계 그룹핑, 그룹별 건수/비율 표시
- **Payload 뷰어**: Text / JSON / Hex dump, base64·hex 디코딩, 복사, 줄바꿈 (행 더블클릭으로 바로 열기)
- 이벤트 상세 패널 (필드 값 `+`/`−` 클릭으로 검색 조건 추가/제외, JSON 보기, 폭 조절, **팝업(모달) 전환**)
- **Payload 플로팅 창 / 비교**: 브라우저 새 창이 아닌 그리드 내부 창으로 여러 payload 를 동시에 띄워 비교
  - 창 이동(제목줄 드래그, Alt+방향키) · 크기 조절(가장자리, Alt+Shift+방향키) · 최소화/최대화(제목줄 더블클릭) · Esc 닫기
  - 하단 작업표시줄: 창 전환, 나란히 보기(타일), 계단식, 모두 닫기
  - **Diff 비교 창**: 좌우 정렬, 줄 내부 변경 강조, 변경만 보기/공백 무시/좌우 바꾸기/이전·다음 변경 이동, JSON 은 키 정렬 후 비교, 바이너리는 Hex dump 비교
  - 여는 방법: 상세 Payload 탭의 `⧉ 새 창`, 우클릭 메뉴, `Shift+Enter`, 선택 바(`선택 n건 새 창으로`, 2건이면 `Payload 비교`), 창 제목줄의 `⇄` 를 두 창에서 차례로 클릭
- **그룹 분포 차트**: 1레벨 막대 + 2레벨 누적 막대, 범례/툴팁, 클릭 시 해당 그룹으로 이동
- **컬럼 관리**: 숨김/표시, 드래그 재배치(헤더 또는 컬럼 메뉴), 좌측 고정(frozen), 폭 자동 맞춤(리사이즈 핸들 더블클릭)
- **선택**: 체크박스 / 전체 선택 / Shift 범위 / Ctrl 토글, 선택 바(복사·CSV·JSON·사용자 액션 슬롯)
- **내보내기 / 복사**: CSV(Excel 한글 BOM) · JSON 다운로드, 클립보드 TSV 복사
- **고급 필터 UI**: 필드·연산자·값 조건 빌더 ↔ 쿼리 문자열 양방향 변환
- **검색 자동완성**: 필드명 → 값 제안(로컬 데이터 / dataSource groupBy 집계 / `suggest` 함수)
- **검색 기록 · 즐겨찾기 · 설정 저장**: `storageKey` 지정 시 localStorage 에 보존, `state-change` 이벤트로 서버 저장도 가능
- **우클릭 컨텍스트 메뉴**: 셀/헤더 메뉴, `contextMenu` 함수로 항목 확장
- **셀 편집**: `editable` 컬럼 더블클릭/F2 → `cell-edit` 이벤트
- **줄바꿈 모드**: 셀 내용 줄바꿈 + 행 높이 자동(가변 높이 가상 스크롤)
- **키보드 / 접근성**: ↑↓ PgUp/PgDn Home/End 이동, Enter 상세, Space 선택, Shift+↑↓ 범위, Ctrl+A/C, F2 편집, Esc, `/` 검색창, Shift+F10 메뉴 · ARIA grid 패턴(aria-activedescendant, rowindex, colindex, selected, expanded)
- **진행률**: 원격 로드 `로드 n / total` 막대, 그룹 펼침 로딩 진행률, 상단 로딩 라인
- 라이트 / 다크 테마, CSS 변수로 커스터마이징

## 개발 환경

### Docker (권장)

```bash
npm run docker:up      # mock-api(:3001) + playground(:5173) 실행
npm run docker:logs
npm run docker:down
```

- Playground: http://localhost:5173
- Mock API: http://localhost:3001/api/search?q=severity=critical&limit=10

소스는 bind mount 되어 있어 수정 시 HMR 로 즉시 반영됩니다.
`package.json` 의존성을 바꾼 경우에는 `docker compose up -d --build -V` 로 재빌드하세요.

### 로컬

```bash
npm install
npm run mock    # 터미널 1: mock API
npm run dev     # 터미널 2: playground
```

### 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | playground dev server |
| `npm run mock` | mock 로그 API (Node ≥ 22.18) |
| `npm test` | 단위 테스트 (Vitest) |
| `npm run typecheck` | vue-tsc 타입 체크 |
| `npm run build` | 라이브러리 빌드 → `dist/` (ESM, UMD, d.ts, style.css) |

## 다른 프로젝트에서 사용

npm 레지스트리 배포 전에는 GitHub 에서 직접 설치합니다.

```bash
npm install github:<owner>/COD-SEARCHGRID
```

> GitHub 설치 시 `dist/` 가 필요하므로, 배포 방식(GitHub Packages / npm / 태그 릴리스)은 추후 확정합니다.

```ts
// main.ts
import { createApp } from 'vue'
import CodSearchGrid from 'cod-searchgrid'
import 'cod-searchgrid/style.css'

createApp(App).use(CodSearchGrid).mount('#app') // 전역 <CodSearchGrid>
```

```vue
<script setup lang="ts">
import { SearchGrid, type DataSource, type GridColumn } from 'cod-searchgrid'

const columns: GridColumn[] = [
  { field: '_time', label: 'Time', width: 190 },
  { field: 'severity', label: 'Severity', width: 100 },
  { field: 'host', label: 'Host' },
  { field: 'message', label: 'Message', width: 600 },
]

const dataSource: DataSource = async ({ query, offset, limit, sort, signal }) => {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`, { signal })
  return res.json() // { rows, total, took? }
}
</script>

<template>
  <div style="height: 600px">
    <SearchGrid :columns="columns" :data-source="dataSource" row-key="event_id" />
  </div>
</template>
```

### Props

| Prop | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `columns` | `GridColumn[]` | (필수) | 컬럼 정의 |
| `rows` | `LogRecord[]` | `[]` | 로컬 데이터 (클라이언트 측 검색/정렬) |
| `dataSource` | `DataSource` | – | 원격 검색 함수. 지정 시 서버 측 검색 + 무한 스크롤 |
| `query` (`v-model:query`) | `string` | – | 검색어 |
| `groupBy` (`v-model:groupBy`) | `string[]` | `[]` | 그룹핑 필드 (순서 = 레벨) |
| `groupable` | `boolean` | `true` | group by 패널 표시 |
| `groupLimit` | `number` | `500` | 원격 그룹 집계 최대 그룹 수 |
| `payloadField` | `string \| string[]` | `['payload', '_raw']` | payload 필드 (먼저 존재하는 것 사용) |
| `payloadEncodingField` | `string` | `payload_encoding` | 인코딩 필드 (`base64` / `hex` / `text`), 없으면 자동 판별 |
| `detailWidth` | `number` | `440` | 상세 패널 초기 폭 |
| `selectable` | `boolean` | `true` | 체크박스 선택 컬럼 |
| `showRowNumber` | `boolean` | `false` | 행 번호 컬럼 |
| `defaultWrap` | `boolean` | `false` | 초기 줄바꿈(행 높이 자동) 모드 |
| `storageKey` | `string` | – | 설정/검색 기록/즐겨찾기 localStorage 키 |
| `suggest` | `(field, prefix, query) => string[]` | – | 자동완성 값 제안 |
| `contextMenu` | `boolean \| (ctx) => MenuItem[]` | `true` | 컨텍스트 메뉴 on/off·커스터마이징 |
| `exportFileName` | `string` | `events` | 내보내기 파일명 접두어 |
| `windowFields` | `string[]` | 앞쪽 4개 컬럼 | Payload 창 상단에 표시할 필드 |
| `windowTitle` | `(row) => string` | 앞쪽 2개 컬럼 값 | Payload 창 제목 |
| `maxWindows` | `number` | `12` | 동시에 열 수 있는 창 수 (초과 시 가장 오래된 창을 닫음) |
| `features` | `Partial<GridFeatures>` | 모두 `true` | `filterBuilder`, `columnChooser`, `export`, `wrapToggle`, `bookmarks`, `history`, `autocomplete`, `contextMenu`, `keyboard`, `groupChart` |

컬럼 옵션(`GridColumn`)에는 `hidden`, `frozen`, `editable`, `groupable` 이 추가되었습니다.
| `rowKey` | `string \| fn` | index | 행 key |
| `rowHeight` | `number` | `28` | 행 높이(px), 가상 스크롤 기준 |
| `pageSize` | `number` | `200` | 원격 페이지 크기 |
| `height` | `string` | `100%` | 컴포넌트 높이 |
| `theme` | `'light' \| 'dark'` | `light` | 테마 |
| `severityBar` | `boolean` | `false` | 행 맨 앞 심각도 색상 막대 표시 |
| `severityField` | `string` | `severity` | 색상 막대 기준 필드 (critical/high/medium/low/info) |
| `showDetail` | `boolean` | `true` | 상세 패널 표시 |
| `immediate` | `boolean` | `true` | 마운트 시 자동 검색 |
| `defaultSort` | `SortState` | – | 초기 정렬 |
| `messages` | `Partial<GridMessages>` | 한국어 | UI 문구 |

### 원격 그룹핑 프로토콜

`groupBy` 가 설정되면 그리드는 dataSource 를 다음과 같이 호출합니다 (Splunk `stats count by` + drill-down 방식).

1. 1레벨: `{ query, groupBy: 'severity', limit: groupLimit }` → `{ rows: [], total, groups: [{ value, count }] }`
2. 그룹 펼침(하위 레벨): `{ query: 'error severity=high', groupBy: 'host' }` — 상위 그룹 조건이 query 에 필터 토큰으로 붙음
3. 리프 그룹 펼침: `{ query: 'error severity=high host=web-01', offset, limit }` → 일반 행 응답 (스크롤 시 추가 로드)

값이 없는 그룹은 `value: null` 로 응답하며, drill-down 시 `field!=*` 토큰이 사용됩니다.
집계 로직은 `groupCounts()` 로 export 되어 Node 백엔드에서 그대로 쓸 수 있습니다 (`mock-server/server.mjs` 참고).

### Events
`search`, `row-click`, `row-dblclick`, `sort-change`, `column-resize`, `group-toggle`, `selection-change`, `cell-edit`, `export`, `state-change`, `loaded`, `error`, `update:query`, `update:groupBy`

### Slots
`toolbar`, `status`, `empty`, `cell-<field>` (`{ row, value, column }`)

### Exposed methods (`ref`)
`search(query?)`, `refresh()`, `addFilter(field, op, value)`, `scrollToIndex(i)`, `setGroupBy(fields)`, `setSort(sort)`, `expandAll()` (로컬 모드), `collapseAll()`, `getSelection()`, `selectAll()`, `clearSelection()`, `copySelection()`, `exportData(format, scope)`, `openPayloadWindow(row)`, `openPayloadWindows(rows)`, `comparePayloads(a, b)`, `tileWindows()`, `closeAllWindows()`, `getState()`, `applyState(state)`, `resetState()`, `focus()`

### Slots (추가)
`selection-actions` (`{ rows, clear }`) — 선택 바에 사용자 정의 버튼 (예: 티켓 생성, 삭제)

### 단독 컴포넌트
- `<PayloadViewer :value="..." encoding="base64" />` — payload 뷰어만 따로 사용
- `<EventDetail>`, `<GroupPanel>` 도 export 됩니다.

### 유틸
`parseQuery`, `filterRecords`, `matchRecord`, `buildFilterToken` 등 쿼리 파서도 함께 export 되므로
백엔드(Node)나 다른 컴포넌트에서 같은 문법을 재사용할 수 있습니다.

### 테마 커스터마이징

```css
.csg {
  --csg-accent: #7c3aed;
  --csg-font-size: 14px;
  --csg-sev-critical: #ff0040;
}
```

## 구조

```
src/                 라이브러리 소스
  components/SearchGrid.vue
  utils/query.ts     SPL 스타일 쿼리 파서 (mock-server 와 공유)
  types.ts
  index.ts           진입점
playground/          개발/테스트용 데모 앱
mock-server/         가짜 SIEM 로그 API (Docker 서비스)
tests/               Vitest
```
