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
  /** 요청 취소용 (새 검색이 시작되면 이전 요청은 abort 된다) */
  signal?: AbortSignal
}

export interface SearchResult<T = LogRecord> {
  rows: T[]
  total: number
  /** 서버 처리 시간(ms) */
  took?: number
}

/** 원격 데이터 소스. 지정 시 그리드가 직접 검색/페이징(무한 스크롤)을 수행한다. */
export type DataSource<T = LogRecord> = (req: SearchRequest) => Promise<SearchResult<T>>

export type RowKey = string | ((row: LogRecord, index: number) => string | number)

export type GridTheme = 'light' | 'dark'

/** UI 문구 (다국어/커스터마이징용) */
export interface GridMessages {
  search: string
  placeholder: string
  events: string
  empty: string
  loading: string
  detail: string
  raw: string
  close: string
  include: string
  exclude: string
  error: string
}
