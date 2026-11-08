# COD-SEARCHGRID

SIEM / Splunk 스타일 **로그 검색 그리드** Vue 3 컴포넌트 라이브러리.

- SPL 스타일 쿼리: `error`, `"phrase"`, `host=web-*`, `severity!=info`, `dest_port>=1024`, `NOT blocked`, `geo.country=KR`
- 가상 스크롤 (수십만 행) + 원격 데이터 소스 무한 스크롤
- 검색어 하이라이트, 컬럼 정렬 / 폭 조절, 심각도 색상
- 이벤트 상세 패널 (필드 값 `+`/`−` 클릭으로 검색 조건 추가/제외, JSON 보기)
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
| `rowKey` | `string \| fn` | index | 행 key |
| `rowHeight` | `number` | `28` | 행 높이(px), 가상 스크롤 기준 |
| `pageSize` | `number` | `200` | 원격 페이지 크기 |
| `height` | `string` | `100%` | 컴포넌트 높이 |
| `theme` | `'light' \| 'dark'` | `light` | 테마 |
| `severityField` | `string` | `severity` | 행 색상 기준 필드 (critical/high/medium/low/info) |
| `showDetail` | `boolean` | `true` | 상세 패널 표시 |
| `immediate` | `boolean` | `true` | 마운트 시 자동 검색 |
| `defaultSort` | `SortState` | – | 초기 정렬 |
| `messages` | `Partial<GridMessages>` | 한국어 | UI 문구 |

### Events
`search`, `row-click`, `sort-change`, `column-resize`, `loaded`, `error`, `update:query`

### Slots
`toolbar`, `status`, `empty`, `cell-<field>` (`{ row, value, column }`)

### Exposed methods (`ref`)
`search(query?)`, `refresh()`, `addFilter(field, op, value)`, `scrollToIndex(i)`, `clearSelection()`

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
