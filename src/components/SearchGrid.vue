<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, shallowRef, watch } from 'vue'
import type {
  Bookmark,
  CellEditEvent,
  ContextMenuContext,
  DataSource,
  DetailMode,
  DetailTab,
  GridColumn,
  GridFeatures,
  GridMessages,
  GridState,
  GridTheme,
  LogRecord,
  MenuItem,
  RowKey,
  SearchRequest,
  SearchResult,
  SortState,
  SuggestFn,
} from '../types'
import { DEFAULT_MESSAGES, fmtMsg } from '../messages'
import {
  appendToQuery,
  buildFilterToken,
  compareValues,
  filterRecords,
  getValueByPath,
  highlightTerms,
  parseQuery,
  setValueByPath,
  type FilterOp,
} from '../utils/query'
import { buildGroupTree, collectGroupKeys, makeGroupNode, type GroupNode } from '../utils/group'
import { buildHighlightRegExp, HighlightText } from '../utils/highlight'
import { DND_FIELD } from '../utils/dnd'
import { copyText, downloadText, timestampedName, toCSV, toJSON, toTSV } from '../utils/export'
import { readStore, removeStore, writeStore } from '../utils/storage'
import { collectFieldPaths, rankByPrefix, topValues } from '../utils/suggest'
import { useColumns } from '../composables/useColumns'
import { useSelection } from '../composables/useSelection'
import { useVirtualRows } from '../composables/useVirtualRows'
import GroupPanel from './GroupPanel.vue'
import GroupChart from './GroupChart.vue'
import EventDetail from './EventDetail.vue'
import SearchBox from './SearchBox.vue'
import FilterBuilder from './FilterBuilder.vue'
import ColumnChooser from './ColumnChooser.vue'
import Dropdown from './Dropdown.vue'
import ContextMenu from './ContextMenu.vue'
import '../styles/searchgrid.css'

const props = withDefaults(
  defineProps<{
    columns: GridColumn[]
    /** 로컬 데이터 (dataSource 미지정 시 클라이언트 측 검색/정렬/그룹핑) */
    rows?: LogRecord[]
    /** 원격 데이터 소스 (지정 시 서버 측 검색 + 무한 스크롤 + 그룹 집계) */
    dataSource?: DataSource
    /** v-model:query */
    query?: string
    /** v-model:groupBy — 그룹핑 필드 목록 (순서 = 레벨) */
    groupBy?: string[]
    /** group by 패널 표시 */
    groupable?: boolean
    /** 원격 그룹 집계 요청 시 최대 그룹 수 */
    groupLimit?: number
    rowKey?: RowKey
    rowHeight?: number
    pageSize?: number
    overscan?: number
    height?: string
    theme?: GridTheme
    /** 행 색상 구분에 사용할 심각도 필드 */
    severityField?: string
    showDetail?: boolean
    /** 상세 패널 초기 폭(px) */
    detailWidth?: number
    /** payload 후보 필드 (먼저 존재하는 필드 사용) */
    payloadField?: string | string[]
    /** payload 인코딩 필드 (base64 / hex / text) */
    payloadEncodingField?: string
    /** 마운트 시 자동 검색 (dataSource 모드) */
    immediate?: boolean
    defaultSort?: SortState | null
    /** 체크박스 다중 선택 컬럼 */
    selectable?: boolean
    /** 행 번호 컬럼 */
    showRowNumber?: boolean
    /** 초기 줄바꿈(행 높이 자동) 모드 */
    defaultWrap?: boolean
    /** 지정 시 컬럼/정렬/그룹/검색 기록/즐겨찾기를 localStorage 에 저장 */
    storageKey?: string
    /** 자동완성 값 제안 함수 */
    suggest?: SuggestFn
    /** 컨텍스트 메뉴 (false 로 끄거나, 함수로 항목 커스터마이징) */
    contextMenu?: boolean | ((ctx: ContextMenuContext) => MenuItem[])
    /** 내보내기 파일명 (타임스탬프가 붙는다) */
    exportFileName?: string
    /** 툴바 기능 on/off */
    features?: Partial<GridFeatures>
    messages?: Partial<GridMessages>
  }>(),
  {
    rows: () => [],
    dataSource: undefined,
    query: undefined,
    groupBy: undefined,
    groupable: true,
    groupLimit: 500,
    rowKey: undefined,
    rowHeight: 28,
    pageSize: 200,
    overscan: 10,
    height: '100%',
    theme: 'light',
    severityField: 'severity',
    showDetail: true,
    detailWidth: 440,
    payloadField: () => ['payload', '_raw'],
    payloadEncodingField: 'payload_encoding',
    immediate: true,
    defaultSort: null,
    selectable: true,
    showRowNumber: false,
    defaultWrap: false,
    storageKey: undefined,
    suggest: undefined,
    contextMenu: true,
    exportFileName: 'events',
    features: () => ({}),
    messages: () => ({}),
  },
)

const emit = defineEmits<{
  'update:query': [query: string]
  'update:groupBy': [fields: string[]]
  search: [request: SearchRequest]
  'row-click': [row: LogRecord, index: number]
  'row-dblclick': [row: LogRecord, index: number]
  'sort-change': [sort: SortState | null]
  'column-resize': [field: string, width: number]
  'group-toggle': [node: GroupNode, expanded: boolean]
  'selection-change': [rows: LogRecord[]]
  'cell-edit': [event: CellEditEvent]
  export: [format: 'csv' | 'json', rows: LogRecord[]]
  'state-change': [state: GridState]
  loaded: [rows: LogRecord[], total: number]
  error: [error: unknown]
}>()

const DEFAULT_FEATURES: GridFeatures = {
  filterBuilder: true,
  columnChooser: true,
  export: true,
  wrapToggle: true,
  bookmarks: true,
  history: true,
  autocomplete: true,
  contextMenu: true,
  keyboard: true,
  groupChart: true,
}
const CHECK_W = 36
const NUM_W = 56
const HEADER_H = 32

const feat = computed<GridFeatures>(() => ({ ...DEFAULT_FEATURES, ...props.features }))
const m = computed<GridMessages>(() => ({ ...DEFAULT_MESSAGES, ...props.messages }))
const remote = computed(() => !!props.dataSource)
const uid = `csg-${Math.random().toString(36).slice(2, 8)}`
const skey = (name: string) => (props.storageKey ? `${props.storageKey}:${name}` : undefined)
const payloadFields = computed(() => (Array.isArray(props.payloadField) ? props.payloadField : [props.payloadField]))

// ================================================================ query / sort
const queryText = ref(props.query ?? '')
const activeQuery = ref(props.query ?? '')
const parsed = computed(() => parseQuery(activeQuery.value))
const sort = ref<SortState | null>(props.defaultSort ?? null)
const filterCount = computed(
  () => parsed.value.filters.length + parsed.value.terms.length + parsed.value.excludedTerms.length,
)

watch(
  () => props.query,
  (q) => {
    if (q !== undefined && q !== queryText.value) queryText.value = q
  },
)
watch(queryText, (q) => emit('update:query', q))

// ================================================================ columns
const leadCount = computed(() => (props.selectable ? 1 : 0) + (props.showRowNumber ? 1 : 0))
const leadWidth = computed(() => (props.selectable ? CHECK_W : 0) + (props.showRowNumber ? NUM_W : 0))
const cols = useColumns(
  () => props.columns,
  () => leadWidth.value,
)
const { layout: colLayout, visible: visibleCols, ordered: orderedCols, hidden: hiddenSet, frozen: frozenSet } = cols
const gridTemplateColumns = computed(() =>
  [
    ...(props.selectable ? [`${CHECK_W}px`] : []),
    ...(props.showRowNumber ? [`${NUM_W}px`] : []),
    ...colLayout.value.map((c) => `${c.width}px`),
  ].join(' '),
)
const totalWidth = computed(() => leadWidth.value + cols.dataWidth.value)
const leadShadow = computed(() => !colLayout.value.some((c) => c.frozen))
const labelOf = (field: string) => props.columns.find((c) => c.field === field)?.label ?? field

// ================================================================ group by state
const groupFields = ref<string[]>(props.groupBy ? [...props.groupBy] : [])
const grouped = computed(() => groupFields.value.length > 0)
const expanded = ref<Set<string>>(new Set())
const showChart = ref(false)

watch(
  () => props.groupBy,
  (v) => {
    if (v && v.join('\u0001') !== groupFields.value.join('\u0001')) setGroupBy(v, false)
  },
)

function setGroupBy(fields: string[], notify = true, refetch = true): void {
  groupFields.value = [...fields]
  expanded.value = new Set()
  focusIndex.value = -1
  if (notify) emit('update:groupBy', [...fields])
  scrollToIndex(0)
  if (remote.value && refetch && mounted) fetchRoot()
}

// ================================================================ local data
const localRows = computed<LogRecord[]>(() => {
  if (remote.value) return []
  const rows = filterRecords(props.rows, parsed.value)
  const s = sort.value
  if (s) {
    const dir = s.order === 'asc' ? 1 : -1
    rows.sort((a, b) => dir * compareValues(getValueByPath(a, s.field), getValueByPath(b, s.field)))
  }
  return rows
})

// ================================================================ remote data
interface NodeState {
  children?: GroupNode[]
  rows: LogRecord[]
  total: number
  loading: boolean
  error?: string
}

const remoteRows = shallowRef<LogRecord[]>([])
const remoteGroups = shallowRef<GroupNode[]>([])
const remoteTotal = ref(0)
const nodeState = new Map<string, NodeState>()
const nodeVersion = ref(0)
const loading = ref(false)
const took = ref<number | null>(null)
const errorMsg = ref<string | null>(null)
let generation = 0
let abort: AbortController | null = null
let mounted = false

type Outcome = { res: SearchResult; error?: undefined } | { res?: undefined; error: unknown }

async function request(req: Omit<SearchRequest, 'signal'>): Promise<Outcome> {
  const ds = props.dataSource as DataSource
  try {
    return { res: await ds({ ...req, signal: abort?.signal }) }
  } catch (error) {
    return { error }
  }
}

function reportError(e: unknown): void {
  if (abort?.signal.aborted) return
  errorMsg.value = e instanceof Error ? e.message : String(e)
  emit('error', e)
}

function bucketsToNodes(
  res: SearchResult,
  depth: number,
  parent: { key: string; filters: string[]; count: number },
): GroupNode[] {
  const field = groupFields.value[depth]
  const leaf = depth === groupFields.value.length - 1
  return (res.groups ?? []).map((b) => makeGroupNode(field, b, depth, parent, leaf))
}

/** 새 검색 (그룹핑 시 1레벨 그룹 집계, 아니면 첫 페이지) */
async function fetchRoot(): Promise<void> {
  if (!props.dataSource) return
  abort?.abort()
  abort = new AbortController()
  const gen = ++generation
  nodeState.clear()
  nodeVersion.value++
  loading.value = true
  errorMsg.value = null
  const base = { query: activeQuery.value, offset: 0, sort: sort.value ?? undefined }
  const out = grouped.value
    ? await request({ ...base, limit: props.groupLimit, groupBy: groupFields.value[0] })
    : await request({ ...base, limit: props.pageSize })
  if (gen !== generation) return
  loading.value = false
  if (out.error !== undefined) {
    remoteRows.value = []
    remoteGroups.value = []
    remoteTotal.value = 0
    reportError(out.error)
    return
  }
  const res = out.res as SearchResult
  remoteTotal.value = res.total
  took.value = res.took ?? null
  if (grouped.value) {
    if (!res.groups) reportError(new Error(m.value.groupUnsupported))
    remoteRows.value = []
    remoteGroups.value = bucketsToNodes(res, 0, { key: '', filters: [], count: res.total })
  } else {
    remoteGroups.value = []
    remoteRows.value = res.rows
  }
  emit('loaded', remoteRows.value, res.total)
  await nextTick()
  maybeLoadMore()
}

/** 그룹 미사용 시 무한 스크롤 다음 페이지 */
async function fetchMoreRows(): Promise<void> {
  if (!props.dataSource || loading.value || grouped.value) return
  if (remoteRows.value.length >= remoteTotal.value) return
  const gen = generation
  loading.value = true
  const out = await request({
    query: activeQuery.value,
    offset: remoteRows.value.length,
    limit: props.pageSize,
    sort: sort.value ?? undefined,
  })
  if (gen !== generation) return
  loading.value = false
  if (out.error !== undefined) return reportError(out.error)
  const res = out.res as SearchResult
  remoteRows.value = remoteRows.value.concat(res.rows)
  remoteTotal.value = res.rows.length === 0 ? remoteRows.value.length : res.total
  emit('loaded', remoteRows.value, remoteTotal.value)
  await nextTick()
  maybeLoadMore()
}

/** 원격 그룹 노드 로드: 리프면 다음 행 페이지, 아니면 하위 그룹 집계 */
async function loadNode(node: GroupNode): Promise<void> {
  if (!props.dataSource) return
  let st = nodeState.get(node.key)
  if (st?.loading) return
  if (st && !st.error && (node.leaf ? st.rows.length >= st.total : st.children)) return
  if (!st) nodeState.set(node.key, (st = { rows: [], total: node.count, loading: false }))
  st.loading = true
  st.error = undefined
  nodeVersion.value++
  const gen = generation
  const query = appendToQuery(activeQuery.value, node.filters.join(' '))
  const s = sort.value ?? undefined
  const out = node.leaf
    ? await request({ query, offset: st.rows.length, limit: props.pageSize, sort: s })
    : await request({ query, offset: 0, limit: props.groupLimit, sort: s, groupBy: groupFields.value[node.depth + 1] })
  if (gen !== generation) return
  st.loading = false
  if (out.error !== undefined) {
    st.error = out.error instanceof Error ? out.error.message : String(out.error)
    reportError(out.error)
  } else {
    const res = out.res as SearchResult
    if (node.leaf) {
      st.rows = st.rows.concat(res.rows)
      st.total = res.rows.length === 0 ? st.rows.length : res.total
    } else {
      st.children = bucketsToNodes(res, node.depth + 1, { key: node.key, filters: node.filters, count: node.count })
    }
  }
  nodeVersion.value++
  await nextTick()
  maybeLoadMore()
}

const anyNodeLoading = computed(() => {
  void nodeVersion.value
  for (const st of nodeState.values()) if (st.loading) return true
  return false
})

// ================================================================ actions
function search(query?: string): void {
  if (query !== undefined) queryText.value = query
  activeQuery.value = queryText.value.trim()
  detailRow.value = null
  focusIndex.value = -1
  sel.clear()
  scrollToIndex(0)
  pushHistory(activeQuery.value)
  emit('search', { query: activeQuery.value, offset: 0, limit: props.pageSize, sort: sort.value ?? undefined })
  if (remote.value) {
    expanded.value = new Set()
    fetchRoot()
  }
}

function refresh(): void {
  if (remote.value) fetchRoot()
}

function setSort(s: SortState | null): void {
  sort.value = s
  emit('sort-change', s)
  if (remote.value) {
    scrollToIndex(0)
    expanded.value = new Set()
    fetchRoot()
  }
}

function toggleSort(col: GridColumn): void {
  if (col.sortable === false) return
  const cur = sort.value
  if (!cur || cur.field !== col.field) setSort({ field: col.field, order: 'asc' })
  else if (cur.order === 'asc') setSort({ field: col.field, order: 'desc' })
  else setSort(null)
}

function addFilter(field: string, op: FilterOp, value: unknown): void {
  search(appendToQuery(queryText.value, buildFilterToken(field, op, value)))
}

function toggleNode(node: GroupNode): void {
  const next = new Set(expanded.value)
  const open = !next.has(node.key)
  if (open) next.add(node.key)
  else next.delete(node.key)
  expanded.value = next
  emit('group-toggle', node, open)
  if (open && remote.value) loadNode(node)
}

function expandAll(): void {
  if (remote.value) return // 원격은 대량 요청을 피하기 위해 지원하지 않음
  expanded.value = new Set(collectGroupKeys(groupRoots.value))
}
function collapseAll(): void {
  expanded.value = new Set()
}

watch(
  () => props.dataSource,
  () => {
    valueCache.clear()
    refresh()
  },
)

// ================================================================ display items
type Item =
  | { kind: 'row'; key: string | number; row: LogRecord; depth: number; index: number }
  | { kind: 'group'; key: string; node: GroupNode }
  | {
      kind: 'more'
      key: string
      node: GroupNode
      depth: number
      loading: boolean
      error?: string
      remaining: number
      loaded: number
    }

const groupRoots = computed<GroupNode[]>(() => {
  if (!grouped.value) return []
  if (remote.value) return remoteGroups.value
  return buildGroupTree(localRows.value, groupFields.value, sort.value)
})

/** 그룹 모드에서 펼쳐진 트리를 평탄화한 목록 (가상 스크롤 대상) */
const groupItems = computed<Item[]>(() => {
  if (!grouped.value) return []
  void nodeVersion.value
  const out: Item[] = []
  const exp = expanded.value
  let rowIndex = 0
  const pushRows = (node: GroupNode, rows: readonly LogRecord[]) => {
    rows.forEach((row, i) => {
      out.push({ kind: 'row', key: `${node.key}\u0002${keyOf(row, i)}`, row, depth: node.depth + 1, index: rowIndex++ })
    })
  }
  const walk = (nodes: readonly GroupNode[]) => {
    for (const node of nodes) {
      out.push({ kind: 'group', key: `g${node.key}`, node })
      if (!exp.has(node.key)) continue
      if (!remote.value) {
        if (node.leaf) pushRows(node, node.rows ?? [])
        else walk(node.children ?? [])
        continue
      }
      const st = nodeState.get(node.key)
      if (!node.leaf && st?.children) {
        walk(st.children)
        continue
      }
      if (node.leaf && st) pushRows(node, st.rows)
      const loaded = st?.rows.length ?? 0
      const remaining = node.leaf ? (st ? st.total - loaded : node.count) : 0
      if (!st || st.loading || st.error || remaining > 0) {
        out.push({
          kind: 'more',
          key: `m${node.key}`,
          node,
          depth: node.depth + 1,
          loading: !st || st.loading,
          error: st?.error,
          remaining,
          loaded,
        })
      }
    }
  }
  walk(groupRoots.value)
  return out
})

const flatRows = computed(() => (remote.value ? remoteRows.value : localRows.value))
const itemCount = computed(() => (grouped.value ? groupItems.value.length : flatRows.value.length))
const total = computed(() => (remote.value ? remoteTotal.value : localRows.value.length))

/** 선택/내보내기 대상: 로컬은 검색 결과 전체, 원격은 로드된 행 */
const allRows = computed<LogRecord[]>(() => {
  if (!remote.value) return localRows.value
  if (!grouped.value) return remoteRows.value
  void nodeVersion.value
  const out: LogRecord[] = []
  for (const st of nodeState.values()) out.push(...st.rows)
  return out
})

function itemAt(i: number): Item | undefined {
  if (i < 0 || i >= itemCount.value) return undefined
  if (grouped.value) return groupItems.value[i]
  const row = flatRows.value[i]
  return { kind: 'row', key: keyOf(row, i), row, depth: 0, index: i }
}

const progress = computed(() => {
  if (!remote.value || grouped.value || !remoteTotal.value) return null
  const loaded = remoteRows.value.length
  return { loaded, total: remoteTotal.value, pct: Math.min(100, (loaded / remoteTotal.value) * 100) }
})

// ================================================================ virtual scroll
const wrap = ref(props.defaultWrap)
const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(0)
const dataTick = ref(0)
let ro: ResizeObserver | null = null

const virtual = useVirtualRows({
  count: () => itemCount.value,
  keyAt: (i) => String(grouped.value ? groupItems.value[i].key : keyOf(flatRows.value[i], i)),
  variable: () => wrap.value,
  rowHeight: () => props.rowHeight,
  overscan: () => props.overscan,
  scrollTop,
  viewportH,
})

const visibleItems = computed(() => {
  void dataTick.value
  const { start, end } = virtual.range.value
  const out: (Item & { pos: number })[] = []
  for (let i = start; i < end; i++) {
    const it = itemAt(i)
    if (it) out.push({ ...it, pos: i })
  }
  return out
})

watch(wrap, () => virtual.reset())
watch(
  () => cols.widths.value,
  () => wrap.value && virtual.reset(),
)
onUpdated(() => {
  if (wrap.value) virtual.measure(scrollEl.value)
})

function maybeLoadMore(): void {
  if (!remote.value) return
  if (!grouped.value) {
    if (virtual.range.value.end >= remoteRows.value.length - props.overscan) fetchMoreRows()
    return
  }
  for (const it of visibleItems.value) {
    if (it.kind === 'more' && it.node.leaf && !it.loading && !it.error) loadNode(it.node)
  }
}

function onScroll(): void {
  const el = scrollEl.value
  if (!el) return
  scrollTop.value = el.scrollTop
  maybeLoadMore()
}

function scrollToIndex(index: number): void {
  const top = Math.max(0, virtual.offsetOf(Math.max(0, index)))
  scrollTop.value = top
  if (scrollEl.value) scrollEl.value.scrollTop = top
}

function ensureVisible(i: number): void {
  const el = scrollEl.value
  if (!el || !el.clientHeight) return
  const top = virtual.offsetOf(i)
  const h = virtual.heightOf(i)
  const view = el.clientHeight - HEADER_H
  if (top < el.scrollTop) el.scrollTop = top
  else if (top + h > el.scrollTop + view) el.scrollTop = top + h - view
  scrollTop.value = el.scrollTop
}

// ================================================================ rendering helpers
function keyOf(row: LogRecord, index: number): string | number {
  const k = props.rowKey
  if (!k) return index
  if (typeof k === 'function') return k(row, index)
  const v = getValueByPath(row, k)
  return v == null ? index : String(v)
}

function toText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function cellText(col: GridColumn, row: LogRecord): string {
  const v = getValueByPath(row, col.field)
  return col.formatter ? col.formatter(v, row) : toText(v)
}

function cellClass(col: GridColumn, row: LogRecord): string | undefined {
  const c = col.cellClass
  if (!c) return undefined
  return typeof c === 'function' ? c(getValueByPath(row, col.field), row) : c
}

function rowClass(item: Item & { pos: number }, row: LogRecord, index: number): (string | Record<string, boolean>)[] {
  const sev = toText(getValueByPath(row, props.severityField)).toLowerCase()
  return [
    sev ? `csg-sev--${sev.replace(/[^a-z0-9_-]/g, '')}` : '',
    {
      'csg-tr--odd': index % 2 === 1,
      'csg-tr--active': row === detailRow.value,
      'csg-tr--checked': isSelected(row),
      'csg-tr--focus': item.pos === focusIndex.value,
      'csg-tr--wrap': wrap.value,
    },
  ]
}

const highlightRe = computed(() => buildHighlightRegExp(highlightTerms(parsed.value)))
const numberFmt = new Intl.NumberFormat()
const pct = (node: GroupNode) => (node.parentCount ? (node.count / node.parentCount) * 100 : 0)
const nodeLoading = (node: GroupNode) => !!nodeState.get(node.key)?.loading
const rowId = (pos: number) => `${uid}-i-${pos}`

function hasPayload(row: LogRecord): boolean {
  return payloadFields.value.some((f) => {
    const v = getValueByPath(row, f)
    return v != null && v !== ''
  })
}

// ================================================================ column resize / reorder
let dragCleanup: (() => void) | null = null
function startDrag(e: PointerEvent, onMove: (dx: number) => void, onEnd?: () => void): void {
  const startX = e.clientX
  const move = (ev: PointerEvent) => onMove(ev.clientX - startX)
  const up = () => {
    dragCleanup?.()
    onEnd?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  dragCleanup = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    dragCleanup = null
  }
}

function startResize(e: PointerEvent, col: GridColumn): void {
  const startW = cols.widths.value[col.field] ?? 160
  const min = col.minWidth ?? 60
  startDrag(
    e,
    (dx) => cols.setWidth(col.field, Math.max(min, Math.round(startW + dx))),
    () => emit('column-resize', col.field, cols.widths.value[col.field]),
  )
}

const dropTarget = ref<{ field: string; after: boolean } | null>(null)
const hasDndField = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes(DND_FIELD)

function onHeaderDragStart(e: DragEvent, col: GridColumn): void {
  if (dragCleanup) {
    e.preventDefault()
    return
  }
  e.dataTransfer?.setData(DND_FIELD, col.field)
  e.dataTransfer?.setData('text/plain', col.field)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove'
}

function onHeaderDragOver(e: DragEvent, col: GridColumn): void {
  if (!hasDndField(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { field: col.field, after: e.clientX > r.left + r.width / 2 }
}

function onHeaderDrop(e: DragEvent, col: GridColumn): void {
  const field = e.dataTransfer?.getData(DND_FIELD)
  const t = dropTarget.value
  dropTarget.value = null
  if (!field || field === col.field) return
  e.preventDefault()
  if (t?.after) {
    const list = visibleCols.value
    const idx = list.findIndex((c) => c.field === col.field)
    cols.move(field, list[idx + 1]?.field)
  } else cols.move(field, col.field)
}

function autoFit(col: GridColumn): void {
  const rows = allRows.value.slice(0, 500)
  const label = col.label ?? col.field
  let w: number | undefined
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx && scrollEl.value) {
      const mono = getComputedStyle(scrollEl.value).getPropertyValue('--csg-font-mono') || 'monospace'
      ctx.font = `600 13px sans-serif`
      let max = ctx.measureText(label).width + 30
      ctx.font = `12px ${mono}`
      for (const r of rows) max = Math.max(max, ctx.measureText(cellText(col, r).slice(0, 300)).width)
      w = max + 24
    }
  } catch {
    w = undefined
  }
  if (w === undefined) {
    const chars = Math.max(label.length + 3, ...rows.map((r) => Math.min(300, cellText(col, r).length)))
    w = chars * 7.4 + 24
  }
  cols.setWidth(col.field, Math.min(900, Math.max(col.minWidth ?? 60, Math.round(w))))
}

// ================================================================ selection / focus
const sel = useSelection((row) => {
  const k = props.rowKey
  if (!k) return row
  if (typeof k === 'function') return k(row, -1)
  const v = getValueByPath(row, k)
  return v == null ? row : String(v)
})
const { isSelected, size: selSize, rows: selRows } = sel
watch(selRows, (rows) => emit('selection-change', rows))

const allSelected = computed(() => allRows.value.length > 0 && selSize.value >= allRows.value.length && allRows.value.every(isSelected))
const someSelected = computed(() => selSize.value > 0 && !allSelected.value)

const focusIndex = ref(-1)
let anchorIndex = -1

function toggleAll(): void {
  if (allSelected.value) sel.removeRows(allRows.value)
  else sel.setRows(allRows.value, true)
}

function selectRange(a: number, b: number, additive: boolean): void {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  const list: LogRecord[] = []
  for (let i = lo; i <= hi; i++) {
    const it = itemAt(i)
    if (it?.kind === 'row') list.push(it.row)
  }
  sel.setRows(list, additive)
}

function onRowMouseDown(e: MouseEvent): void {
  if (e.shiftKey) e.preventDefault() // 텍스트 선택 방지
}

function onRowClick(e: MouseEvent, item: Item & { pos: number }): void {
  if (item.kind !== 'row') return
  focusIndex.value = item.pos
  if (e.shiftKey && anchorIndex >= 0) {
    selectRange(anchorIndex, item.pos, e.ctrlKey || e.metaKey)
    return
  }
  anchorIndex = item.pos
  if (e.ctrlKey || e.metaKey) {
    sel.toggle(item.row)
    return
  }
  detailRow.value = detailRow.value === item.row && detailMode.value === 'side' ? null : item.row
  emit('row-click', item.row, item.index)
}

function onCheckClick(e: MouseEvent, item: Item & { pos: number }): void {
  if (item.kind !== 'row') return
  focusIndex.value = item.pos
  if (e.shiftKey && anchorIndex >= 0) selectRange(anchorIndex, item.pos, true)
  else sel.toggle(item.row)
  anchorIndex = item.pos
}

function onRowDblClick(item: Item & { pos: number }): void {
  if (item.kind !== 'row') return
  openDetail(item.row, hasPayload(item.row) ? 'payload' : 'fields')
  emit('row-dblclick', item.row, item.index)
}

function moveFocus(i: number, extend: boolean): void {
  const n = itemCount.value
  if (!n) return
  const next = Math.min(n - 1, Math.max(0, i))
  if (extend) {
    if (anchorIndex < 0) anchorIndex = Math.max(0, focusIndex.value)
    selectRange(anchorIndex, next, false)
  } else anchorIndex = next
  focusIndex.value = next
  ensureVisible(next)
  const it = itemAt(next)
  if (detailRow.value && it?.kind === 'row') detailRow.value = it.row
}

const isEditableTarget = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')

function onGridKeydown(e: KeyboardEvent): void {
  if (!feat.value.keyboard || isEditableTarget(e.target)) return
  const n = itemCount.value
  if (!n) return
  const cur = focusIndex.value < 0 ? -1 : Math.min(focusIndex.value, n - 1)
  const it = itemAt(cur)
  const page = Math.max(1, Math.floor((viewportH.value - HEADER_H) / props.rowHeight) - 1)
  const ctrl = e.ctrlKey || e.metaKey
  let handled = true
  switch (e.key) {
    case 'ArrowDown':
      moveFocus(cur + 1, e.shiftKey)
      break
    case 'ArrowUp':
      moveFocus(cur < 0 ? 0 : cur - 1, e.shiftKey)
      break
    case 'PageDown':
      moveFocus(cur + page, e.shiftKey)
      break
    case 'PageUp':
      moveFocus(cur - page, e.shiftKey)
      break
    case 'Home':
      moveFocus(0, e.shiftKey)
      break
    case 'End':
      moveFocus(n - 1, e.shiftKey)
      break
    case 'ArrowRight':
    case 'ArrowLeft':
      if (it?.kind === 'group' && (e.key === 'ArrowRight') !== expanded.value.has(it.node.key)) toggleNode(it.node)
      else handled = false
      break
    case 'Enter':
      if (it?.kind === 'group') toggleNode(it.node)
      else if (it?.kind === 'row') openDetail(it.row, 'fields')
      else if (it?.kind === 'more') loadNode(it.node)
      break
    case ' ':
      if (it?.kind === 'row') {
        sel.toggle(it.row)
        anchorIndex = cur
      } else if (it?.kind === 'group') toggleNode(it.node)
      break
    case 'Escape':
      if (detailRow.value) closeDetail()
      else if (selSize.value) sel.clear()
      else handled = false
      break
    case 'F2': {
      const col = it?.kind === 'row' ? visibleCols.value.find((c) => isEditable(c, it.row)) : undefined
      if (col && it?.kind === 'row') startEdit(it.row, col)
      else handled = false
      break
    }
    case 'ContextMenu':
      openMenuForFocused()
      break
    case 'F10':
      if (e.shiftKey) openMenuForFocused()
      else handled = false
      break
    default:
      if (ctrl && e.key.toLowerCase() === 'a') sel.setRows(allRows.value)
      else if (ctrl && e.key.toLowerCase() === 'c')
        copyRows(selSize.value ? selRows.value : it?.kind === 'row' ? [it.row] : [])
      else handled = false
  }
  if (handled) e.preventDefault()
}

function onRootKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && detailRow.value && detailMode.value === 'modal') {
    closeDetail()
    e.preventDefault()
  } else if (e.key === '/' && feat.value.keyboard && !isEditableTarget(e.target)) {
    e.preventDefault()
    searchBox.value?.focus()
  }
}

// ================================================================ copy / export
const notice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function notify(msg: string): void {
  notice.value = msg
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 2000)
}

async function copyRows(rows: readonly LogRecord[]): Promise<void> {
  if (!rows.length) return
  if (await copyText(toTSV(rows, visibleCols.value))) notify(fmtMsg(m.value.copiedRows, rows.length))
}
async function copyJsonRows(rows: readonly LogRecord[]): Promise<void> {
  if (await copyText(rows.length === 1 ? JSON.stringify(rows[0], null, 2) : toJSON(rows)))
    notify(fmtMsg(m.value.copiedRows, rows.length))
}
async function copyValue(v: unknown): Promise<void> {
  if (await copyText(toText(v))) notify(m.value.copied)
}

function exportData(format: 'csv' | 'json', scope: 'all' | 'selected' = 'all'): void {
  const rows = scope === 'selected' ? selRows.value : allRows.value
  const name = timestampedName(props.exportFileName, format)
  if (format === 'csv') downloadText(toCSV(rows, visibleCols.value), name, 'text/csv')
  else downloadText(toJSON(rows), name, 'application/json')
  emit('export', format, rows)
}

// ================================================================ cell edit
const editing = ref<{ row: LogRecord; field: string; value: string } | null>(null)

function isEditable(col: GridColumn, row: LogRecord): boolean {
  const e = col.editable
  return typeof e === 'function' ? e(row) : !!e
}
const isEditingCell = (row: LogRecord, col: GridColumn) => editing.value?.row === row && editing.value.field === col.field

function startEdit(row: LogRecord, col: GridColumn): void {
  if (!isEditable(col, row)) return
  editing.value = { row, field: col.field, value: toText(getValueByPath(row, col.field)) }
  nextTick(() => {
    const input = scrollEl.value?.querySelector<HTMLInputElement>('.csg-cell-input')
    input?.focus()
    input?.select()
  })
}

function commitEdit(): void {
  const e = editing.value
  if (!e) return
  editing.value = null
  const oldValue = getValueByPath(e.row, e.field)
  const value = typeof oldValue === 'number' && e.value.trim() !== '' && !Number.isNaN(Number(e.value)) ? Number(e.value) : e.value
  if (value === oldValue || (oldValue == null && value === '')) return
  setValueByPath(e.row, e.field, value)
  dataTick.value++
  emit('cell-edit', { row: e.row, field: e.field, value, oldValue })
}

function cancelEdit(): void {
  editing.value = null
  scrollEl.value?.focus()
}

function onCellDblClick(e: MouseEvent, item: Item & { pos: number }, col: GridColumn): void {
  if (item.kind !== 'row' || !isEditable(col, item.row)) return
  e.stopPropagation()
  startEdit(item.row, col)
}

// ================================================================ context menu
const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)
const menuEnabled = computed(() => feat.value.contextMenu && props.contextMenu !== false)

function customize(ctx: ContextMenuContext): MenuItem[] {
  return typeof props.contextMenu === 'function' ? props.contextMenu(ctx) : ctx.defaults
}

function shorten(v: unknown): string {
  const t = toText(v)
  return t.length > 24 ? `${t.slice(0, 24)}…` : t || '""'
}

function cellMenuItems(row: LogRecord, col?: GridColumn): MenuItem[] {
  const v = col ? getValueByPath(row, col.field) : undefined
  const multi = isSelected(row) && selSize.value > 1
  const target = multi ? selRows.value : [row]
  const t = m.value
  const items: MenuItem[] = []
  if (col) items.push({ label: t.copyValue, action: () => copyValue(v) })
  items.push({
    label: multi ? fmtMsg(t.copySelected, target.length) : t.copyRows,
    shortcut: 'Ctrl+C',
    action: () => copyRows(target),
  })
  items.push({ label: t.copyJson, action: () => copyJsonRows(target) })
  if (col) {
    items.push({ separator: true })
    items.push({ label: `${t.include}: ${shorten(v)}`, action: () => addFilter(col.field, '=', v) })
    items.push({ label: `${t.exclude}: ${shorten(v)}`, action: () => addFilter(col.field, '!=', v) })
    if (props.groupable && col.groupable !== false && !groupFields.value.includes(col.field))
      items.push({ label: t.groupByColumn, action: () => setGroupBy([...groupFields.value, col.field]) })
    if (isEditable(col, row)) items.push({ label: t.edit, shortcut: 'F2', action: () => startEdit(row, col) })
  }
  items.push({ separator: true })
  items.push({ label: isSelected(row) ? t.clearSelection : t.select, shortcut: 'Space', action: () => sel.toggle(row) })
  items.push({ label: t.viewDetail, shortcut: 'Enter', action: () => openDetail(row, 'fields') })
  if (hasPayload(row)) items.push({ label: `${t.payload} ${t.viewPayload}`, action: () => openDetail(row, 'payload') })
  items.push({ label: t.popout, action: () => openDetail(row, 'fields', 'modal') })
  return items
}

function headerMenuItems(col: GridColumn): MenuItem[] {
  const t = m.value
  const items: MenuItem[] = []
  if (col.sortable !== false) {
    items.push({ label: t.sortAsc, action: () => setSort({ field: col.field, order: 'asc' }) })
    items.push({ label: t.sortDesc, action: () => setSort({ field: col.field, order: 'desc' }) })
    if (sort.value?.field === col.field) items.push({ label: t.sortClear, action: () => setSort(null) })
    items.push({ separator: true })
  }
  if (props.groupable && col.groupable !== false && !groupFields.value.includes(col.field))
    items.push({ label: t.groupByColumn, action: () => setGroupBy([...groupFields.value, col.field]) })
  const isFrozen = frozenSet.value.has(col.field)
  items.push({ label: isFrozen ? t.unfreeze : t.freeze, action: () => cols.setFrozen(col.field, !isFrozen) })
  items.push({ label: t.hide, disabled: visibleCols.value.length <= 1, action: () => cols.setHidden(col.field, true) })
  items.push({ label: t.autoFit, action: () => autoFit(col) })
  items.push({ separator: true })
  items.push({ label: t.resetColumns, action: () => cols.reset() })
  return items
}

function openCellMenu(e: MouseEvent, item: Item & { pos: number }, col?: GridColumn): void {
  if (!menuEnabled.value || item.kind !== 'row') return
  e.preventDefault()
  focusIndex.value = item.pos
  const value = col ? getValueByPath(item.row, col.field) : undefined
  const items = customize({ row: item.row, column: col, value, selection: selRows.value, defaults: cellMenuItems(item.row, col) })
  menu.value = { x: e.clientX, y: e.clientY, items }
}

function openHeaderMenu(e: MouseEvent, col: GridColumn): void {
  if (!menuEnabled.value) return
  e.preventDefault()
  const items = customize({ column: col, selection: selRows.value, defaults: headerMenuItems(col) })
  menu.value = { x: e.clientX, y: e.clientY, items }
}

function openMenuForFocused(): void {
  const it = itemAt(focusIndex.value)
  if (!menuEnabled.value || it?.kind !== 'row') return
  const el = document.getElementById(rowId(focusIndex.value))
  const r = el?.getBoundingClientRect()
  const items = customize({ row: it.row, selection: selRows.value, defaults: cellMenuItems(it.row) })
  menu.value = { x: (r?.left ?? 0) + 40, y: r?.bottom ?? 0, items }
}

function closeMenu(): void {
  menu.value = null
  scrollEl.value?.focus()
}

// ================================================================ detail panel
const detailRow = shallowRef<LogRecord | null>(null)
const detailTab = ref<DetailTab>('fields')
const detailMode = ref<DetailMode>('side')
const panelWidth = ref(props.detailWidth)
const modalEl = ref<HTMLElement | null>(null)

function openDetail(row: LogRecord, tab: DetailTab, mode?: DetailMode): void {
  detailRow.value = row
  detailTab.value = tab
  if (mode) detailMode.value = mode
}

function closeDetail(): void {
  const wasModal = detailMode.value === 'modal'
  detailRow.value = null
  if (wasModal) scrollEl.value?.focus()
}

watch([detailRow, detailMode], ([row, mode]) => {
  if (row && mode === 'modal') nextTick(() => modalEl.value?.focus())
})

function startPanelResize(e: PointerEvent): void {
  const startW = panelWidth.value
  const max = Math.max(300, (scrollEl.value?.parentElement?.clientWidth ?? 1200) * 0.8)
  startDrag(e, (dx) => {
    panelWidth.value = Math.min(max, Math.max(260, Math.round(startW - dx)))
  })
}

// ================================================================ group chart
const chartChildren = (node: GroupNode): GroupNode[] | undefined =>
  remote.value ? nodeState.get(node.key)?.children : node.children

watch([showChart, remoteGroups], () => {
  // 원격 + 2단계 이상이면 상위 그룹의 하위 집계를 미리 로드해서 누적 막대로 표시
  if (!showChart.value || !remote.value || groupFields.value.length < 2) return
  for (const node of remoteGroups.value.slice(0, 12)) loadNode(node)
})

function onChartSelect(node: GroupNode): void {
  if (!expanded.value.has(node.key)) toggleNode(node)
  nextTick(() => {
    const i = groupItems.value.findIndex((it) => it.kind === 'group' && it.node.key === node.key)
    if (i < 0) return
    focusIndex.value = i
    scrollToIndex(i)
    scrollEl.value?.focus()
  })
}

// ================================================================ autocomplete / suggestions
const searchBox = ref<InstanceType<typeof SearchBox> | null>(null)
const showFilter = ref(false)
const valueCache = new Map<string, string[]>()
watch(
  () => props.rows,
  () => valueCache.clear(),
)

const knownFields = computed(() => {
  const list: { field: string; label?: string }[] = props.columns.map((c) => ({ field: c.field, label: c.label }))
  const have = new Set(list.map((f) => f.field))
  const sample = remote.value ? allRows.value : props.rows
  for (const f of collectFieldPaths(sample, 100, payloadFields.value)) if (!have.has(f)) list.push({ field: f })
  return list
})

async function suggestValues(field: string, prefix: string): Promise<string[]> {
  if (props.suggest) return props.suggest(field, prefix, activeQuery.value)
  let vals = valueCache.get(field)
  if (!vals) {
    if (props.dataSource) {
      try {
        const res = await props.dataSource({ query: '', offset: 0, limit: 200, groupBy: field })
        vals = (res.groups ?? []).filter((g) => g.value !== null).map((g) => String(g.value))
      } catch {
        vals = topValues(allRows.value, field)
      }
    } else vals = topValues(props.rows, field, 200)
    valueCache.set(field, vals)
  }
  return rankByPrefix(vals, prefix, 10)
}

function applyFilterBuilder(q: string): void {
  showFilter.value = false
  search(q)
}

// ================================================================ history / bookmarks
const history = ref<string[]>(readStore(skey('history'), []))
const bookmarks = ref<Bookmark[]>(readStore(skey('bookmarks'), []))
const bmName = ref('')

function pushHistory(q: string): void {
  if (!feat.value.history || !q) return
  history.value = [q, ...history.value.filter((h) => h !== q)].slice(0, 30)
  writeStore(skey('history'), history.value)
}
function clearHistory(): void {
  history.value = []
  writeStore(skey('history'), [])
}
function saveBookmark(close?: () => void): void {
  const query = queryText.value.trim()
  if (!query) return
  const b: Bookmark = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: bmName.value.trim() || query,
    query,
    groupBy: groupFields.value.length ? [...groupFields.value] : undefined,
    createdAt: Date.now(),
  }
  bookmarks.value = [b, ...bookmarks.value.filter((x) => x.name !== b.name)].slice(0, 50)
  writeStore(skey('bookmarks'), bookmarks.value)
  bmName.value = ''
  notify(m.value.saved)
  close?.()
}
function removeBookmark(id: string): void {
  bookmarks.value = bookmarks.value.filter((b) => b.id !== id)
  writeStore(skey('bookmarks'), bookmarks.value)
}
function applyBookmark(b: Bookmark, close?: () => void): void {
  setGroupBy(b.groupBy ?? [], true, false)
  search(b.query)
  close?.()
}

// ================================================================ preferences (state)
function getState(): GridState {
  return {
    columns: cols.getState(),
    wrap: wrap.value,
    sort: sort.value,
    groupBy: [...groupFields.value],
    detailMode: detailMode.value,
    detailWidth: panelWidth.value,
    showChart: showChart.value,
  }
}

function applyState(s: Partial<GridState>, refetch = true): void {
  if (s.columns) cols.applyState(s.columns)
  if (s.wrap != null) wrap.value = s.wrap
  if (s.sort !== undefined) sort.value = s.sort
  if (s.detailMode) detailMode.value = s.detailMode
  if (s.detailWidth) panelWidth.value = s.detailWidth
  if (s.showChart != null) showChart.value = s.showChart
  if (s.groupBy) setGroupBy(s.groupBy, true, false)
  if (refetch && remote.value && mounted) fetchRoot()
}

function resetState(): void {
  cols.reset()
  wrap.value = props.defaultWrap
  sort.value = props.defaultSort ?? null
  detailMode.value = 'side'
  panelWidth.value = props.detailWidth
  showChart.value = false
  removeStore(skey('prefs'))
  if (remote.value) fetchRoot()
}

{
  const saved = readStore<Partial<GridState> | null>(skey('prefs'), null)
  if (saved) applyState(saved, false)
}
watch(
  () => JSON.stringify(getState()),
  (json) => {
    const state = JSON.parse(json) as GridState
    writeStore(skey('prefs'), state)
    emit('state-change', state)
  },
)

// ================================================================ lifecycle
onMounted(() => {
  mounted = true
  const el = scrollEl.value
  if (el) {
    viewportH.value = el.clientHeight
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        viewportH.value = el.clientHeight
        maybeLoadMore()
      })
      ro.observe(el)
    }
  }
  if (remote.value && props.immediate) search()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  dragCleanup?.()
  abort?.abort()
  clearTimeout(noticeTimer)
})

const rootStyle = computed(() => ({
  height: props.height,
  '--csg-row-height': `${props.rowHeight}px`,
}))

defineExpose({
  search,
  refresh,
  addFilter,
  scrollToIndex,
  setGroupBy,
  expandAll,
  collapseAll,
  setSort,
  /** 선택 행 */
  getSelection: () => selRows.value,
  selectAll: () => sel.setRows(allRows.value),
  clearSelection: () => {
    sel.clear()
    detailRow.value = null
  },
  copySelection: () => copyRows(selRows.value),
  exportData,
  getState,
  applyState,
  resetState,
  focus: () => scrollEl.value?.focus(),
})
</script>

<template>
  <div class="csg" :class="`csg--${theme}`" :style="rootStyle" @keydown="onRootKeydown">
    <!-- ============================== toolbar -->
    <form class="csg-toolbar" role="search" @submit.prevent="search()">
      <SearchBox
        ref="searchBox"
        v-model="queryText"
        :fields="knownFields"
        :history="feat.history ? history : []"
        :bookmarks="feat.bookmarks ? bookmarks : []"
        :suggest-values="suggestValues"
        :messages="m"
        :autocomplete="feat.autocomplete"
        @submit="search()"
        @apply-bookmark="applyBookmark"
      />
      <button type="submit" class="csg-btn csg-btn--primary">{{ m.search }}</button>

      <Dropdown v-if="feat.bookmarks || feat.history" :label="'★'" :title="m.bookmarks" panel-class="csg-bm">
        <template #default="{ close }">
          <div v-if="feat.bookmarks" class="csg-bm__save">
            <input
              v-model="bmName"
              class="csg-input"
              :placeholder="queryText.trim() || m.bookmarkName"
              :aria-label="m.bookmarkName"
              @keydown.enter.prevent="saveBookmark(close)"
            />
            <button type="button" class="csg-btn csg-btn--sm csg-btn--primary" :disabled="!queryText.trim()" @click="saveBookmark(close)">
              {{ m.save }}
            </button>
          </div>
          <template v-if="feat.bookmarks">
            <div class="csg-bm__title">{{ m.bookmarks }}</div>
            <ul class="csg-bm__list">
              <li v-for="b in bookmarks" :key="b.id" class="csg-bm__item">
                <button type="button" class="csg-bm__apply" @click="applyBookmark(b, close)">
                  <span class="csg-bm__name">★ {{ b.name }}</span>
                  <code class="csg-bm__query">{{ b.query }}<template v-if="b.groupBy"> · by {{ b.groupBy.join(' › ') }}</template></code>
                </button>
                <button type="button" class="csg-icon-btn" :aria-label="`${m.close}: ${b.name}`" @click="removeBookmark(b.id)">×</button>
              </li>
              <li v-if="!bookmarks.length" class="csg-bm__empty">{{ m.noBookmarks }}</li>
            </ul>
          </template>
          <template v-if="feat.history">
            <div class="csg-bm__title">
              {{ m.recent }}
              <button v-if="history.length" type="button" class="csg-link-btn" @click="clearHistory">{{ m.clearHistory }}</button>
            </div>
            <ul class="csg-bm__list">
              <li v-for="h in history.slice(0, 15)" :key="h" class="csg-bm__item">
                <button type="button" class="csg-bm__apply" @click="(search(h), close())"><code class="csg-bm__query">{{ h }}</code></button>
              </li>
              <li v-if="!history.length" class="csg-bm__empty">{{ m.noHistory }}</li>
            </ul>
          </template>
        </template>
      </Dropdown>

      <button
        v-if="feat.filterBuilder"
        type="button"
        class="csg-btn"
        :class="{ 'csg-btn--active': showFilter }"
        :aria-pressed="showFilter"
        @click="showFilter = !showFilter"
      >
        {{ m.filter }}<span v-if="filterCount" class="csg-badge">{{ filterCount }}</span>
      </button>

      <Dropdown v-if="feat.columnChooser" :label="m.columns" panel-class="csg-dd__panel--cols">
        <ColumnChooser
          :columns="orderedCols"
          :hidden="hiddenSet"
          :frozen="frozenSet"
          :messages="m"
          @set-hidden="cols.setHidden"
          @set-frozen="cols.setFrozen"
          @move="cols.move"
          @show-all="cols.showAll"
          @reset="cols.reset"
        />
      </Dropdown>

      <Dropdown v-if="feat.export" :label="m.export">
        <template #default="{ close }">
          <div class="csg-menu csg-menu--inline" role="menu">
            <button type="button" class="csg-menu__item" role="menuitem" :disabled="!allRows.length" @click="(exportData('csv'), close())">
              <span class="csg-menu__label">CSV · {{ fmtMsg(m.exportAll, allRows.length) }}</span>
            </button>
            <button type="button" class="csg-menu__item" role="menuitem" :disabled="!allRows.length" @click="(exportData('json'), close())">
              <span class="csg-menu__label">JSON · {{ fmtMsg(m.exportAll, allRows.length) }}</span>
            </button>
            <div class="csg-menu__sep" role="separator" />
            <button type="button" class="csg-menu__item" role="menuitem" :disabled="!selSize" @click="(exportData('csv', 'selected'), close())">
              <span class="csg-menu__label">CSV · {{ fmtMsg(m.exportSelected, selSize) }}</span>
            </button>
            <button type="button" class="csg-menu__item" role="menuitem" :disabled="!selSize" @click="(exportData('json', 'selected'), close())">
              <span class="csg-menu__label">JSON · {{ fmtMsg(m.exportSelected, selSize) }}</span>
            </button>
            <div v-if="remote" class="csg-menu__note">{{ m.exportLoadedNote }}</div>
          </div>
        </template>
      </Dropdown>

      <button
        v-if="feat.wrapToggle"
        type="button"
        class="csg-btn"
        :class="{ 'csg-btn--active': wrap }"
        :aria-pressed="wrap"
        :title="m.wrapRows"
        @click="wrap = !wrap"
      >
        ↵ {{ m.wrapRows }}
      </button>
      <slot name="toolbar" />
    </form>

    <FilterBuilder
      v-if="feat.filterBuilder && showFilter"
      :query="queryText"
      :fields="knownFields"
      :messages="m"
      :suggest-values="suggestValues"
      @apply="applyFilterBuilder"
      @close="showFilter = false"
    />

    <GroupPanel
      v-if="groupable"
      :group-by="groupFields"
      :columns="orderedCols"
      :messages="m"
      :can-expand-all="!remote"
      @update:group-by="setGroupBy($event)"
      @expand-all="expandAll"
      @collapse-all="collapseAll"
    >
      <template #actions>
        <button
          v-if="feat.groupChart && grouped"
          type="button"
          class="csg-link-btn"
          :aria-pressed="showChart"
          @click="showChart = !showChart"
        >
          {{ showChart ? '▾' : '▸' }} {{ m.chart }}
        </button>
      </template>
    </GroupPanel>

    <GroupChart
      v-if="feat.groupChart && grouped && showChart && groupRoots.length"
      :roots="groupRoots"
      :children-of="groupFields.length > 1 ? chartChildren : undefined"
      :version="nodeVersion"
      :field-label="labelOf(groupFields[0])"
      :sub-field-label="groupFields[1] ? labelOf(groupFields[1]) : undefined"
      :messages="m"
      @select="onChartSelect"
    />

    <!-- ============================== status -->
    <div class="csg-status" aria-live="polite">
      <span class="csg-status__count">{{ numberFmt.format(total) }} {{ m.events }}</span>
      <span v-if="grouped" class="csg-status__groups">· {{ numberFmt.format(groupRoots.length) }} {{ m.groups }}</span>
      <span v-if="took != null" class="csg-status__took">({{ took }} ms)</span>
      <span v-if="progress && progress.loaded < progress.total" class="csg-status__progress">
        {{ m.loaded }} {{ numberFmt.format(progress.loaded) }} / {{ numberFmt.format(progress.total) }}
        <span class="csg-minibar"><span :style="{ width: `${progress.pct}%` }" /></span>
      </span>
      <span v-if="loading" class="csg-status__loading"><span class="csg-spinner" />{{ m.loading }}</span>
      <span v-if="errorMsg" class="csg-status__error" :title="errorMsg">{{ m.error }}: {{ errorMsg }}</span>
      <span class="csg-status__spacer" />
      <slot name="status" :total="total" :loading="loading" />
      <span v-if="feat.keyboard" class="csg-status__kbd" :title="m.shortcuts" aria-hidden="true">⌨</span>
      <div class="csg-progress" :class="{ 'csg-progress--busy': loading || anyNodeLoading }" aria-hidden="true" />
    </div>

    <!-- ============================== selection bar -->
    <div v-if="selSize > 0" class="csg-selbar" role="region" :aria-label="fmtMsg(m.selected, selSize)">
      <strong>{{ fmtMsg(m.selected, selSize) }}</strong>
      <button type="button" class="csg-link-btn" @click="copyRows(selRows)">{{ m.copyRows }}</button>
      <button v-if="feat.export" type="button" class="csg-link-btn" @click="exportData('csv', 'selected')">CSV</button>
      <button v-if="feat.export" type="button" class="csg-link-btn" @click="exportData('json', 'selected')">JSON</button>
      <slot name="selection-actions" :rows="selRows" :clear="sel.clear" />
      <span class="csg-status__spacer" />
      <button type="button" class="csg-link-btn" @click="sel.clear()">{{ m.clearSelection }}</button>
    </div>

    <!-- ============================== grid -->
    <div class="csg-main">
      <div
        ref="scrollEl"
        class="csg-scroll"
        role="grid"
        tabindex="0"
        :aria-rowcount="itemCount + 1"
        :aria-colcount="leadCount + visibleCols.length"
        :aria-multiselectable="selectable || undefined"
        :aria-activedescendant="focusIndex >= 0 && itemAt(focusIndex) ? rowId(focusIndex) : undefined"
        :aria-label="m.search"
        @scroll.passive="onScroll"
        @keydown="onGridKeydown"
      >
        <div class="csg-header" role="row" aria-rowindex="1" :style="{ gridTemplateColumns, width: `${totalWidth}px` }">
          <div
            v-if="selectable"
            class="csg-th csg-th--lead csg-th--frozen"
            :class="{ 'csg-th--last-frozen': leadShadow && !showRowNumber }"
            style="left: 0"
            role="columnheader"
          >
            <input
              type="checkbox"
              class="csg-check"
              :checked="allSelected"
              :indeterminate="someSelected"
              :disabled="!allRows.length"
              :aria-label="m.selectAll"
              @change="toggleAll"
            />
          </div>
          <div
            v-if="showRowNumber"
            class="csg-th csg-th--lead csg-th--frozen csg-th--num"
            :class="{ 'csg-th--last-frozen': leadShadow }"
            :style="{ left: `${selectable ? CHECK_W : 0}px` }"
            role="columnheader"
          >
            {{ m.rowNumber }}
          </div>
          <div
            v-for="(c, ci) in colLayout"
            :key="c.col.field"
            class="csg-th"
            :class="{
              'csg-th--sortable': c.col.sortable !== false,
              'csg-th--sorted': sort?.field === c.col.field,
              'csg-th--grouped': groupFields.includes(c.col.field),
              'csg-th--frozen': c.frozen,
              'csg-th--last-frozen': c.lastFrozen,
              'csg-th--drop-before': dropTarget?.field === c.col.field && !dropTarget.after,
              'csg-th--drop-after': dropTarget?.field === c.col.field && dropTarget.after,
            }"
            role="columnheader"
            :aria-colindex="leadCount + ci + 1"
            draggable="true"
            :aria-sort="sort?.field === c.col.field ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'"
            :style="{
              left: c.frozen ? `${c.left}px` : undefined,
              justifyContent: c.col.align === 'right' ? 'flex-end' : c.col.align === 'center' ? 'center' : undefined,
            }"
            @click="toggleSort(c.col)"
            @contextmenu="openHeaderMenu($event, c.col)"
            @dragstart="onHeaderDragStart($event, c.col)"
            @dragover="onHeaderDragOver($event, c.col)"
            @dragleave="dropTarget = null"
            @drop="onHeaderDrop($event, c.col)"
            @dragend="dropTarget = null"
          >
            <span v-if="c.frozen" class="csg-th__pin" aria-hidden="true">📌</span>
            <span class="csg-th__label">{{ c.col.label ?? c.col.field }}</span>
            <span v-if="sort?.field === c.col.field" class="csg-th__sort">{{ sort.order === 'asc' ? '▲' : '▼' }}</span>
            <span
              v-if="c.col.resizable !== false"
              class="csg-th__resize"
              @pointerdown.stop.prevent="startResize($event, c.col)"
              @dblclick.stop="autoFit(c.col)"
              @click.stop
            />
          </div>
        </div>

        <div class="csg-body" role="rowgroup" :style="{ height: `${virtual.totalHeight.value}px`, width: `${totalWidth}px` }">
          <template v-for="item in visibleItems" :key="item.key">
            <!-- group header -->
            <div
              v-if="item.kind === 'group'"
              :id="rowId(item.pos)"
              class="csg-tr csg-group"
              :class="{ 'csg-tr--focus': item.pos === focusIndex }"
              role="row"
              :aria-rowindex="item.pos + 2"
              :aria-expanded="expanded.has(item.node.key)"
              :aria-level="item.node.depth + 1"
              :style="{ transform: `translateY(${virtual.offsetOf(item.pos)}px)` }"
              @click="((focusIndex = item.pos), toggleNode(item.node))"
            >
              <div class="csg-group__cell" role="gridcell" :style="{ paddingLeft: `${8 + leadWidth + item.node.depth * 20}px` }">
                <span class="csg-group__chev" :class="{ 'csg-group__chev--open': expanded.has(item.node.key) }">▸</span>
                <span class="csg-group__field">{{ labelOf(item.node.field) }}</span>
                <span class="csg-group__value" :class="{ 'csg-group__value--empty': item.node.value === null }">
                  {{ item.node.value === null ? m.emptyValue : item.node.value === '' ? '""' : item.node.value }}
                </span>
                <span class="csg-group__count">{{ numberFmt.format(item.node.count) }}</span>
                <span class="csg-group__bar" aria-hidden="true"><span :style="{ width: `${pct(item.node)}%` }" /></span>
                <span class="csg-group__pct">{{ pct(item.node).toFixed(1) }}%</span>
                <span v-if="nodeLoading(item.node)" class="csg-spinner" />
              </div>
            </div>

            <!-- remote: loading / load more -->
            <div
              v-else-if="item.kind === 'more'"
              :id="rowId(item.pos)"
              class="csg-tr csg-more"
              :class="{ 'csg-tr--focus': item.pos === focusIndex }"
              role="row"
              :aria-rowindex="item.pos + 2"
              :style="{ transform: `translateY(${virtual.offsetOf(item.pos)}px)` }"
            >
              <div class="csg-group__cell" role="gridcell" :style="{ paddingLeft: `${8 + leadWidth + item.depth * 20}px` }">
                <template v-if="item.loading">
                  <span class="csg-spinner" />{{ m.loading }}
                  <template v-if="item.node.leaf">
                    <span class="csg-more__count">{{ numberFmt.format(item.loaded) }} / {{ numberFmt.format(item.node.count) }}</span>
                    <span class="csg-minibar"><span :style="{ width: `${(item.loaded / Math.max(1, item.node.count)) * 100}%` }" /></span>
                  </template>
                </template>
                <template v-else-if="item.error">
                  <span class="csg-status__error">{{ item.error }}</span>
                  <button type="button" class="csg-link-btn" @click.stop="loadNode(item.node)">{{ m.retry }}</button>
                </template>
                <template v-else>
                  <button type="button" class="csg-link-btn" @click.stop="loadNode(item.node)">
                    {{ m.loadMore }} ({{ numberFmt.format(item.remaining) }})
                  </button>
                  <span class="csg-more__count">{{ numberFmt.format(item.loaded) }} / {{ numberFmt.format(item.node.count) }}</span>
                  <span class="csg-minibar"><span :style="{ width: `${(item.loaded / Math.max(1, item.node.count)) * 100}%` }" /></span>
                </template>
              </div>
            </div>

            <!-- event row -->
            <div
              v-else
              :id="rowId(item.pos)"
              class="csg-tr"
              :class="rowClass(item, item.row, item.index)"
              role="row"
              :aria-rowindex="item.pos + 2"
              :aria-selected="selectable ? isSelected(item.row) : undefined"
              :data-vkey="wrap ? String(item.key) : undefined"
              :style="{ transform: `translateY(${virtual.offsetOf(item.pos)}px)`, gridTemplateColumns }"
              @mousedown="onRowMouseDown"
              @click="onRowClick($event, item)"
              @dblclick="onRowDblClick(item)"
              @contextmenu="openCellMenu($event, item)"
            >
              <div
                v-if="selectable"
                class="csg-td csg-td--lead csg-td--frozen csg-td--check"
                :class="{ 'csg-td--last-frozen': leadShadow && !showRowNumber }"
                style="left: 0"
                role="gridcell"
                aria-colindex="1"
                @click.stop
                @dblclick.stop
              >
                <input
                  type="checkbox"
                  class="csg-check"
                  tabindex="-1"
                  :checked="isSelected(item.row)"
                  :aria-label="m.selectRow"
                  @click.stop="onCheckClick($event, item)"
                />
              </div>
              <div
                v-if="showRowNumber"
                class="csg-td csg-td--lead csg-td--frozen csg-td--num"
                :class="{ 'csg-td--last-frozen': leadShadow }"
                :style="{ left: `${selectable ? CHECK_W : 0}px` }"
                role="gridcell"
                :aria-colindex="selectable ? 2 : 1"
              >
                {{ item.index + 1 }}
              </div>
              <div
                v-for="(c, ci) in colLayout"
                :key="c.col.field"
                class="csg-td"
                :class="[
                  cellClass(c.col, item.row),
                  {
                    'csg-td--frozen': c.frozen,
                    'csg-td--last-frozen': c.lastFrozen,
                    'csg-td--editable': isEditable(c.col, item.row),
                    'csg-td--editing': isEditingCell(item.row, c.col),
                  },
                ]"
                role="gridcell"
                :aria-colindex="leadCount + ci + 1"
                :style="{
                  left: c.frozen ? `${c.left}px` : undefined,
                  textAlign: c.col.align,
                  paddingLeft: ci === 0 && item.depth ? `${10 + item.depth * 20}px` : undefined,
                }"
                :title="wrap ? undefined : cellText(c.col, item.row)"
                @dblclick="onCellDblClick($event, item, c.col)"
                @contextmenu.stop="openCellMenu($event, item, c.col)"
              >
                <input
                  v-if="editing && isEditingCell(item.row, c.col)"
                  v-model="editing.value"
                  class="csg-cell-input"
                  :aria-label="`${m.edit}: ${c.col.label ?? c.col.field}`"
                  @click.stop
                  @dblclick.stop
                  @keydown.enter.prevent="(commitEdit(), scrollEl?.focus())"
                  @keydown.esc.stop.prevent="cancelEdit"
                  @blur="commitEdit"
                />
                <slot v-else :name="`cell-${c.col.field}`" :row="item.row" :value="getValueByPath(item.row, c.col.field)" :column="c.col">
                  <HighlightText :text="cellText(c.col, item.row)" :re="c.col.highlight === false ? null : highlightRe" />
                </slot>
              </div>
            </div>
          </template>
        </div>
        <div v-if="!loading && itemCount === 0" class="csg-empty">
          <slot name="empty">{{ m.empty }}</slot>
        </div>
      </div>

      <aside
        v-if="showDetail && detailRow && detailMode === 'side'"
        class="csg-side"
        :style="{ width: `${panelWidth}px` }"
        :aria-label="m.detail"
      >
        <span class="csg-side__resize" @pointerdown.prevent="startPanelResize" />
        <EventDetail
          v-model:tab="detailTab"
          :row="detailRow"
          mode="side"
          :payload-field="payloadField"
          :payload-encoding-field="payloadEncodingField"
          :highlight="highlightRe"
          :messages="m"
          @close="closeDetail"
          @filter="addFilter"
          @toggle-mode="detailMode = 'modal'"
        />
      </aside>

      <div v-if="notice" class="csg-toast" role="status">{{ notice }}</div>
    </div>

    <!-- ============================== modal detail -->
    <div v-if="showDetail && detailRow && detailMode === 'modal'" class="csg-modal" @pointerdown.self="closeDetail">
      <div ref="modalEl" class="csg-modal__dialog" role="dialog" aria-modal="true" :aria-label="m.detail" tabindex="-1">
        <EventDetail
          v-model:tab="detailTab"
          :row="detailRow"
          mode="modal"
          :payload-field="payloadField"
          :payload-encoding-field="payloadEncodingField"
          :highlight="highlightRe"
          :messages="m"
          @close="closeDetail"
          @filter="addFilter"
          @toggle-mode="detailMode = 'side'"
        />
      </div>
    </div>

    <ContextMenu v-if="menu" :items="menu.items" :x="menu.x" :y="menu.y" @close="closeMenu" />
  </div>
</template>
