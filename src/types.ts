import type { GroupBucket } from './utils/query'

export type { GroupBucket }

export type LogRecord = Record<string, unknown>

export type SortOrder = 'asc' | 'desc'

export interface SortState {
  field: string
  order: SortOrder
}

export interface GridColumn {
  /** 레코드의 필드명. 중첩 필드는 dot path (예: geo.country) */
  field: string
  /** 헤더 표시명 (기본값: field) */
  label?: string
  /** 초기 폭(px), 기본 160 */
  width?: number
  /** 리사이즈 최소 폭(px), 기본 60 */
  minWidth?: number
  /** 정렬 가능 여부, 기본 true */
  sortable?: boolean
  /** 폭 조절 가능 여부, 기본 true */
  resizable?: boolean
  /** group by 패널로 그룹핑 가능 여부, 기본 true */
  groupable?: boolean
  /** 초기 숨김 (컬럼 선택 메뉴에서 다시 표시 가능) */
  hidden?: boolean
  /** 초기 좌측 고정 */
  frozen?: boolean
  /** 셀 편집 가능 여부 (더블클릭 / F2) */
  editable?: boolean | ((row: LogRecord) => boolean)
  align?: 'left' | 'center' | 'right'
  /** 셀 표시 문자열 변환 */
  formatter?: (value: unknown, row: LogRecord) => string
  /** 셀에 추가할 클래스 */
  cellClass?: string | ((value: unknown, row: LogRecord) => string | undefined)
  /** 검색어 하이라이트 여부, 기본 true */
  highlight?: boolean
}

export interface SearchRequest {
  query: string
  offset: number
  limit: number
  sort?: SortState
  /**
   * 그룹 집계 요청. 지정되면 rows 대신 이 필드의 값별 건수(groups)를 돌려줘야 한다.
   * (offset/limit 은 그룹 목록에 적용, 상위 그룹 조건은 query 에 필터 토큰으로 포함됨)
   */
  groupBy?: string
  /** 요청 취소용 (새 검색이 시작되면 이전 요청은 abort 된다) */
  signal?: AbortSignal
}

export interface SearchResult<T = LogRecord> {
  rows: T[]
  /** 검색 조건에 맞는 전체 이벤트 수 */
  total: number
  /** groupBy 요청에 대한 응답 */
  groups?: GroupBucket[]
  /** 서버 처리 시간(ms) */
  took?: number
}

/** 원격 데이터 소스. 지정 시 그리드가 직접 검색/페이징(무한 스크롤)/그룹 집계를 요청한다. */
export type DataSource<T = LogRecord> = (req: SearchRequest) => Promise<SearchResult<T>>

/** 검색 자동완성 값 제안 (미지정 시 로컬 데이터 / dataSource groupBy 집계 사용) */
export type SuggestFn = (field: string, prefix: string, query: string) => string[] | Promise<string[]>

export type RowKey = string | ((row: LogRecord, index: number) => string | number)

export type GridTheme = 'light' | 'dark'

export type DetailTab = 'fields' | 'payload' | 'json'

export type DetailMode = 'side' | 'modal'

/** 컨텍스트 메뉴 항목 */
export interface MenuItem {
  label?: string
  /** 표시용 단축키 문자열 */
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  action?: () => void
}

export interface ContextMenuContext {
  /** 우클릭한 행 (헤더 메뉴면 undefined) */
  row?: LogRecord
  column?: GridColumn
  value?: unknown
  /** 현재 선택된 행 */
  selection: LogRecord[]
  /** 기본 메뉴 — 그대로 반환하거나 수정/확장해서 반환 */
  defaults: MenuItem[]
}

export interface CellEditEvent {
  row: LogRecord
  field: string
  value: unknown
  oldValue: unknown
}

/** 저장된 검색 (즐겨찾기) */
export interface Bookmark {
  id: string
  name: string
  query: string
  groupBy?: string[]
  createdAt: number
}

/** 툴바 기능 on/off */
export interface GridFeatures {
  filterBuilder: boolean
  columnChooser: boolean
  export: boolean
  wrapToggle: boolean
  bookmarks: boolean
  history: boolean
  autocomplete: boolean
  contextMenu: boolean
  keyboard: boolean
  groupChart: boolean
  /** Payload 플로팅 창 / 비교 */
  payloadWindows: boolean
}

export interface ColumnState {
  order: string[]
  hidden: string[]
  frozen: string[]
  widths: Record<string, number>
}

/** 저장/복원 가능한 그리드 상태 (Preferences) */
export interface GridState {
  columns: ColumnState
  wrap: boolean
  sort: SortState | null
  groupBy: string[]
  detailMode: DetailMode
  detailWidth: number
  showChart: boolean
}

/** UI 문구 (다국어/커스터마이징용). `{n}` 은 숫자로 치환된다. */
export interface GridMessages {
  search: string
  placeholder: string
  events: string
  groups: string
  empty: string
  loading: string
  detail: string
  fields: string
  payload: string
  raw: string
  close: string
  include: string
  exclude: string
  error: string
  groupHint: string
  groupAdd: string
  groupRemove: string
  expandAll: string
  collapseAll: string
  emptyValue: string
  loadMore: string
  retry: string
  noPayload: string
  viewPayload: string
  copy: string
  copied: string
  wrap: string
  truncated: string
  groupUnsupported: string
  // --- filter builder
  filter: string
  filterTitle: string
  addCondition: string
  apply: string
  clear: string
  anyField: string
  value: string
  opContains: string
  opNotContains: string
  opExists: string
  opNotExists: string
  opText: string
  opNotText: string
  // --- columns
  columns: string
  showAll: string
  resetColumns: string
  freeze: string
  unfreeze: string
  hide: string
  autoFit: string
  sortAsc: string
  sortDesc: string
  sortClear: string
  groupByColumn: string
  rowNumber: string
  // --- export / selection
  export: string
  exportAll: string
  exportSelected: string
  exportLoadedNote: string
  wrapRows: string
  selected: string
  selectAll: string
  selectRow: string
  clearSelection: string
  select: string
  copyRows: string
  copySelected: string
  copyValue: string
  copyJson: string
  copiedRows: string
  edit: string
  saved: string
  // --- floating windows / diff
  openWindow: string
  newWindow: string
  openWindows: string
  windows: string
  minimize: string
  maximize: string
  restore: string
  tile: string
  cascade: string
  closeAll: string
  compare: string
  compareHint: string
  comparePayload: string
  diffTitle: string
  onlyChanges: string
  ignoreWhitespace: string
  swap: string
  nextChange: string
  prevChange: string
  identical: string
  diffTooLarge: string
  sameLines: string
  viewDetail: string
  popout: string
  dock: string
  // --- bookmarks / history
  bookmarks: string
  saveBookmark: string
  bookmarkName: string
  save: string
  noBookmarks: string
  recent: string
  clearHistory: string
  noHistory: string
  suggestFields: string
  suggestValues: string
  // --- progress / chart
  loaded: string
  chart: string
  chartTitle: string
  others: string
  shortcuts: string
}
