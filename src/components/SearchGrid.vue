<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type {
  DataSource,
  GridColumn,
  GridMessages,
  GridTheme,
  LogRecord,
  RowKey,
  SearchRequest,
  SortState,
} from '../types'
import {
  appendToQuery,
  buildFilterToken,
  compareValues,
  filterRecords,
  getValueByPath,
  highlightTerms,
  parseQuery,
  type FilterOp,
} from '../utils/query'

const DEFAULT_MESSAGES: GridMessages = {
  search: '검색',
  placeholder: '검색어 입력 (예: severity=high host=web-* NOT blocked)',
  events: '건',
  empty: '검색 결과가 없습니다',
  loading: '검색 중…',
  detail: '이벤트 상세',
  raw: 'JSON',
  close: '닫기',
  include: '이 값으로 검색',
  exclude: '이 값 제외',
  error: '검색 중 오류가 발생했습니다',
}

const props = withDefaults(
  defineProps<{
    columns: GridColumn[]
    /** 로컬 데이터 (dataSource 미지정 시 클라이언트 측 검색/정렬) */
    rows?: LogRecord[]
    /** 원격 데이터 소스 (지정 시 서버 측 검색 + 무한 스크롤) */
    dataSource?: DataSource
    /** v-model:query */
    query?: string
    rowKey?: RowKey
    rowHeight?: number
    pageSize?: number
    overscan?: number
    height?: string
    theme?: GridTheme
    /** 행 색상 구분에 사용할 심각도 필드 */
    severityField?: string
    showDetail?: boolean
    /** 마운트 시 자동 검색 (dataSource 모드) */
    immediate?: boolean
    defaultSort?: SortState | null
    messages?: Partial<GridMessages>
  }>(),
  {
    rows: () => [],
    dataSource: undefined,
    query: undefined,
    rowKey: undefined,
    rowHeight: 28,
    pageSize: 200,
    overscan: 10,
    height: '100%',
    theme: 'light',
    severityField: 'severity',
    showDetail: true,
    immediate: true,
    defaultSort: null,
    messages: () => ({}),
  },
)

const emit = defineEmits<{
  'update:query': [query: string]
  search: [request: SearchRequest]
  'row-click': [row: LogRecord, index: number]
  'sort-change': [sort: SortState | null]
  'column-resize': [field: string, width: number]
  loaded: [rows: LogRecord[], total: number]
  error: [error: unknown]
}>()

const m = computed<GridMessages>(() => ({ ...DEFAULT_MESSAGES, ...props.messages }))

// ---------------------------------------------------------------- query / sort
const queryText = ref(props.query ?? '')
const activeQuery = ref(props.query ?? '')
const parsed = computed(() => parseQuery(activeQuery.value))
const sort = ref<SortState | null>(props.defaultSort ?? null)

watch(
  () => props.query,
  (q) => {
    if (q !== undefined && q !== queryText.value) queryText.value = q
  },
)
watch(queryText, (q) => emit('update:query', q))

// ---------------------------------------------------------------- data
const remoteRows = shallowRef<LogRecord[]>([])
const remoteTotal = ref(0)
const loading = ref(false)
const took = ref<number | null>(null)
const errorMsg = ref<string | null>(null)
let reqSeq = 0
let abort: AbortController | null = null

const localRows = computed<LogRecord[]>(() => {
  if (props.dataSource) return []
  const rows = filterRecords(props.rows, parsed.value)
  const s = sort.value
  if (s) {
    const dir = s.order === 'asc' ? 1 : -1
    rows.sort((a, b) => dir * compareValues(getValueByPath(a, s.field), getValueByPath(b, s.field)))
  }
  return rows
})

const displayRows = computed(() => (props.dataSource ? remoteRows.value : localRows.value))
const total = computed(() => (props.dataSource ? remoteTotal.value : localRows.value.length))

async function fetchPage(reset: boolean): Promise<void> {
  const ds = props.dataSource
  if (!ds) return
  if (!reset && (loading.value || remoteRows.value.length >= remoteTotal.value)) return

  if (reset) abort?.abort()
  const controller = reset || !abort ? new AbortController() : abort
  abort = controller
  const id = ++reqSeq
  const offset = reset ? 0 : remoteRows.value.length
  loading.value = true
  errorMsg.value = null
  const req: SearchRequest = {
    query: activeQuery.value,
    offset,
    limit: props.pageSize,
    sort: sort.value ?? undefined,
    signal: controller.signal,
  }
  try {
    const res = await ds(req)
    if (id !== reqSeq) return
    remoteRows.value = reset ? res.rows : remoteRows.value.concat(res.rows)
    // 서버가 빈 페이지를 돌려주면 더 이상 로드하지 않도록 total 보정
    remoteTotal.value = res.rows.length === 0 && !reset ? remoteRows.value.length : res.total
    took.value = res.took ?? null
    emit('loaded', remoteRows.value, remoteTotal.value)
  } catch (e) {
    if (id !== reqSeq || controller.signal.aborted) return
    errorMsg.value = e instanceof Error ? e.message : String(e)
    emit('error', e)
  } finally {
    if (id === reqSeq) loading.value = false
  }
  if (id === reqSeq && !errorMsg.value) {
    await nextTick()
    maybeLoadMore()
  }
}

function search(query?: string): void {
  if (query !== undefined) queryText.value = query
  activeQuery.value = queryText.value.trim()
  selectedIndex.value = -1
  scrollToIndex(0)
  emit('search', { query: activeQuery.value, offset: 0, limit: props.pageSize, sort: sort.value ?? undefined })
  if (props.dataSource) fetchPage(true)
}

function refresh(): void {
  if (props.dataSource) fetchPage(true)
}

function toggleSort(col: GridColumn): void {
  if (col.sortable === false) return
  const cur = sort.value
  if (!cur || cur.field !== col.field) sort.value = { field: col.field, order: 'asc' }
  else if (cur.order === 'asc') sort.value = { field: col.field, order: 'desc' }
  else sort.value = null
  emit('sort-change', sort.value)
  selectedIndex.value = -1
  if (props.dataSource) {
    scrollToIndex(0)
    fetchPage(true)
  }
}

function addFilter(field: string, op: FilterOp, value: unknown): void {
  search(appendToQuery(queryText.value, buildFilterToken(field, op, value)))
}

watch(
  () => props.dataSource,
  () => refresh(),
)

// ---------------------------------------------------------------- columns
const widths = ref<number[]>([])
watch(
  () => props.columns,
  (cols) => {
    widths.value = cols.map((c) => c.width ?? 160)
  },
  { immediate: true, deep: true },
)
const gridTemplateColumns = computed(() => widths.value.map((w) => `${w}px`).join(' '))
const totalWidth = computed(() => widths.value.reduce((a, b) => a + b, 0))

let resizeCleanup: (() => void) | null = null
function startResize(e: PointerEvent, index: number): void {
  const col = props.columns[index]
  const startX = e.clientX
  const startW = widths.value[index]
  const min = col.minWidth ?? 60
  const onMove = (ev: PointerEvent) => {
    const next = widths.value.slice()
    next[index] = Math.max(min, Math.round(startW + ev.clientX - startX))
    widths.value = next
  }
  const onUp = () => {
    resizeCleanup?.()
    emit('column-resize', col.field, widths.value[index])
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  resizeCleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    resizeCleanup = null
  }
}

// ---------------------------------------------------------------- virtual scroll
const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(0)
let ro: ResizeObserver | null = null

const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan))
const endIndex = computed(() =>
  Math.min(
    displayRows.value.length,
    Math.ceil((scrollTop.value + viewportH.value) / props.rowHeight) + props.overscan,
  ),
)
const visibleRows = computed(() => {
  const out: { row: LogRecord; index: number }[] = []
  const rows = displayRows.value
  for (let i = startIndex.value; i < endIndex.value; i++) out.push({ row: rows[i], index: i })
  return out
})
const bodyHeight = computed(() => displayRows.value.length * props.rowHeight)

function maybeLoadMore(): void {
  if (!props.dataSource || loading.value) return
  if (remoteRows.value.length >= remoteTotal.value) return
  if (endIndex.value >= remoteRows.value.length - props.overscan) fetchPage(false)
}

function onScroll(): void {
  const el = scrollEl.value
  if (!el) return
  scrollTop.value = el.scrollTop
  maybeLoadMore()
}

function scrollToIndex(index: number): void {
  const el = scrollEl.value
  const top = Math.max(0, index * props.rowHeight)
  scrollTop.value = top
  if (el) el.scrollTop = top
}

onMounted(() => {
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
  if (props.dataSource && props.immediate) search()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  resizeCleanup?.()
  abort?.abort()
})

// ---------------------------------------------------------------- rendering helpers
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

function severityOf(row: LogRecord): string {
  return toText(getValueByPath(row, props.severityField)).toLowerCase()
}

function rowClass(row: LogRecord, index: number): (string | Record<string, boolean>)[] {
  const sev = severityOf(row)
  return [
    sev ? `csg-sev--${sev.replace(/[^a-z0-9_-]/g, '')}` : '',
    { 'csg-tr--odd': index % 2 === 1, 'csg-tr--selected': index === selectedIndex.value },
  ]
}

const highlightRe = computed<RegExp | null>(() => {
  const terms = highlightTerms(parsed.value).sort((a, b) => b.length - a.length)
  if (!terms.length) return null
  return new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
})

interface Segment {
  t: string
  h: boolean
}
function segments(text: string): Segment[] {
  const re = highlightRe.value
  if (!re || !text) return [{ t: text, h: false }]
  return text
    .split(re)
    .map((t, i) => ({ t, h: i % 2 === 1 }))
    .filter((s) => s.t !== '')
}
function segmentsFor(col: GridColumn, row: LogRecord): Segment[] {
  const text = cellText(col, row)
  return col.highlight === false ? [{ t: text, h: false }] : segments(text)
}

const numberFmt = new Intl.NumberFormat()

// ---------------------------------------------------------------- detail panel
const selectedIndex = ref(-1)
const showRaw = ref(false)
const selected = computed(() => (selectedIndex.value >= 0 ? displayRows.value[selectedIndex.value] : undefined))

function flatten(obj: unknown, prefix = '', out: [string, unknown][] = []): [string, unknown][] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out)
      else out.push([path, v])
    }
  }
  return out
}
const selectedFields = computed(() => (selected.value ? flatten(selected.value) : []))
const selectedJson = computed(() => (selected.value ? JSON.stringify(selected.value, null, 2) : ''))

function onRowClick(row: LogRecord, index: number): void {
  selectedIndex.value = selectedIndex.value === index ? -1 : index
  emit('row-click', row, index)
}

const rootStyle = computed(() => ({
  height: props.height,
  '--csg-row-height': `${props.rowHeight}px`,
}))

defineExpose({ search, refresh, addFilter, scrollToIndex, clearSelection: () => (selectedIndex.value = -1) })
</script>

<template>
  <div class="csg" :class="`csg--${theme}`" :style="rootStyle">
    <form class="csg-toolbar" role="search" @submit.prevent="search()">
      <div class="csg-search">
        <svg class="csg-search__icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
          <path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        <input
          v-model="queryText"
          class="csg-search__input"
          type="search"
          :placeholder="m.placeholder"
          spellcheck="false"
          autocomplete="off"
          :aria-label="m.search"
        />
      </div>
      <button type="submit" class="csg-btn csg-btn--primary">{{ m.search }}</button>
      <slot name="toolbar" />
    </form>

    <div class="csg-status" aria-live="polite">
      <span class="csg-status__count">{{ numberFmt.format(total) }} {{ m.events }}</span>
      <span v-if="took != null" class="csg-status__took">({{ took }} ms)</span>
      <span v-if="loading" class="csg-status__loading"><span class="csg-spinner" />{{ m.loading }}</span>
      <span v-if="errorMsg" class="csg-status__error" :title="errorMsg">{{ m.error }}: {{ errorMsg }}</span>
      <span class="csg-status__spacer" />
      <slot name="status" :total="total" :loading="loading" />
    </div>

    <div class="csg-main">
      <div ref="scrollEl" class="csg-scroll" role="grid" :aria-rowcount="total" @scroll.passive="onScroll">
        <div class="csg-header" role="row" :style="{ gridTemplateColumns, width: `${totalWidth}px` }">
          <div
            v-for="(col, ci) in columns"
            :key="col.field"
            class="csg-th"
            :class="{ 'csg-th--sortable': col.sortable !== false, 'csg-th--sorted': sort?.field === col.field }"
            role="columnheader"
            :aria-sort="sort?.field === col.field ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'"
            :style="{ justifyContent: col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : undefined }"
            @click="toggleSort(col)"
          >
            <span class="csg-th__label">{{ col.label ?? col.field }}</span>
            <span v-if="sort?.field === col.field" class="csg-th__sort">{{ sort.order === 'asc' ? '▲' : '▼' }}</span>
            <span
              v-if="col.resizable !== false"
              class="csg-th__resize"
              @pointerdown.stop.prevent="startResize($event, ci)"
              @click.stop
            />
          </div>
        </div>

        <div class="csg-body" :style="{ height: `${bodyHeight}px`, width: `${totalWidth}px` }">
          <div
            v-for="{ row, index } in visibleRows"
            :key="keyOf(row, index)"
            class="csg-tr"
            :class="rowClass(row, index)"
            role="row"
            :aria-rowindex="index + 1"
            :aria-selected="index === selectedIndex"
            :style="{ transform: `translateY(${index * rowHeight}px)`, gridTemplateColumns }"
            @click="onRowClick(row, index)"
          >
            <div
              v-for="col in columns"
              :key="col.field"
              class="csg-td"
              :class="cellClass(col, row)"
              role="gridcell"
              :style="{ textAlign: col.align }"
              :title="cellText(col, row)"
            >
              <slot :name="`cell-${col.field}`" :row="row" :value="getValueByPath(row, col.field)" :column="col">
                <template v-for="(seg, si) in segmentsFor(col, row)" :key="si"
                  ><mark v-if="seg.h" class="csg-hl">{{ seg.t }}</mark><template v-else>{{ seg.t }}</template></template
                >
              </slot>
            </div>
          </div>
        </div>
        <div v-if="!loading && displayRows.length === 0" class="csg-empty">
          <slot name="empty">{{ m.empty }}</slot>
        </div>
      </div>

      <aside v-if="showDetail && selected" class="csg-detail" :aria-label="m.detail">
        <header class="csg-detail__header">
          <strong>{{ m.detail }}</strong>
          <span class="csg-status__spacer" />
          <button type="button" class="csg-btn" :class="{ 'csg-btn--active': showRaw }" @click="showRaw = !showRaw">
            {{ m.raw }}
          </button>
          <button type="button" class="csg-btn" :aria-label="m.close" @click="selectedIndex = -1">✕</button>
        </header>
        <pre v-if="showRaw" class="csg-detail__raw">{{ selectedJson }}</pre>
        <table v-else class="csg-detail__table">
          <tbody>
            <tr v-for="[path, value] in selectedFields" :key="path">
              <th scope="row">{{ path }}</th>
              <td>
                <template v-for="(seg, si) in segments(toText(value))" :key="si"
                  ><mark v-if="seg.h" class="csg-hl">{{ seg.t }}</mark><template v-else>{{ seg.t }}</template></template
                >
              </td>
              <td class="csg-detail__actions">
                <button type="button" class="csg-icon-btn" :title="m.include" @click="addFilter(path, '=', value)">+</button>
                <button type="button" class="csg-icon-btn" :title="m.exclude" @click="addFilter(path, '!=', value)">−</button>
              </td>
            </tr>
          </tbody>
        </table>
      </aside>
    </div>
  </div>
</template>

<style>
.csg {
  --csg-bg: #ffffff;
  --csg-bg-alt: #f7f8fa;
  --csg-bg-hover: #eef3fb;
  --csg-bg-selected: #dce8fb;
  --csg-header-bg: #f0f2f5;
  --csg-border: #dde1e6;
  --csg-text: #1f2328;
  --csg-text-muted: #656d76;
  --csg-accent: #2f6fde;
  --csg-accent-text: #ffffff;
  --csg-hl-bg: #ffe58f;
  --csg-hl-text: #1f2328;
  --csg-error: #cf222e;
  --csg-sev-critical: #c62828;
  --csg-sev-high: #ef6c00;
  --csg-sev-medium: #f9a825;
  --csg-sev-low: #2e7d32;
  --csg-sev-info: #90a4ae;
  --csg-font: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif;
  --csg-font-mono: ui-monospace, SFMono-Regular, Consolas, 'D2Coding', monospace;
  --csg-font-size: 13px;

  display: flex;
  flex-direction: column;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid var(--csg-border);
  border-radius: 6px;
  background: var(--csg-bg);
  color: var(--csg-text);
  font-family: var(--csg-font);
  font-size: var(--csg-font-size);
  overflow: hidden;
}
.csg *,
.csg *::before,
.csg *::after {
  box-sizing: border-box;
}
.csg--dark {
  --csg-bg: #0f1419;
  --csg-bg-alt: #151b22;
  --csg-bg-hover: #1c2633;
  --csg-bg-selected: #1f3352;
  --csg-header-bg: #19212b;
  --csg-border: #2b3540;
  --csg-text: #d6dde5;
  --csg-text-muted: #8b96a3;
  --csg-accent: #4c8dff;
  --csg-hl-bg: #8a6d00;
  --csg-hl-text: #fff8dc;
  --csg-error: #ff6b6b;
}

.csg-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--csg-border);
  margin: 0;
}
.csg-search {
  position: relative;
  flex: 1;
  min-width: 0;
}
.csg-search__icon {
  position: absolute;
  left: 9px;
  top: 50%;
  width: 16px;
  height: 16px;
  transform: translateY(-50%);
  color: var(--csg-text-muted);
}
.csg-search__input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 32px;
  border: 1px solid var(--csg-border);
  border-radius: 4px;
  background: var(--csg-bg);
  color: var(--csg-text);
  font-family: var(--csg-font-mono);
  font-size: var(--csg-font-size);
  outline: none;
}
.csg-search__input:focus {
  border-color: var(--csg-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--csg-accent) 25%, transparent);
}
.csg-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--csg-border);
  border-radius: 4px;
  background: var(--csg-bg);
  color: var(--csg-text);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.csg-btn:hover {
  background: var(--csg-bg-hover);
}
.csg-btn--primary {
  border-color: var(--csg-accent);
  background: var(--csg-accent);
  color: var(--csg-accent-text);
}
.csg-btn--primary:hover {
  background: color-mix(in srgb, var(--csg-accent) 85%, #000);
}
.csg-btn--active {
  border-color: var(--csg-accent);
  color: var(--csg-accent);
}

.csg-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  min-height: 28px;
  border-bottom: 1px solid var(--csg-border);
  color: var(--csg-text-muted);
  font-size: 12px;
}
.csg-status__count {
  color: var(--csg-text);
  font-weight: 600;
}
.csg-status__loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.csg-status__error {
  color: var(--csg-error);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csg-status__spacer {
  flex: 1;
}
.csg-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--csg-border);
  border-top-color: var(--csg-accent);
  border-radius: 50%;
  animation: csg-spin 0.7s linear infinite;
}
@keyframes csg-spin {
  to {
    transform: rotate(360deg);
  }
}

.csg-main {
  display: flex;
  flex: 1;
  min-height: 0;
}
.csg-scroll {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.csg-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  min-width: 100%;
  background: var(--csg-header-bg);
  border-bottom: 1px solid var(--csg-border);
}
.csg-th {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  border-right: 1px solid var(--csg-border);
  font-weight: 600;
  user-select: none;
  overflow: hidden;
  white-space: nowrap;
}
.csg-th--sortable {
  cursor: pointer;
}
.csg-th--sortable:hover {
  background: var(--csg-bg-hover);
}
.csg-th--sorted {
  color: var(--csg-accent);
}
.csg-th__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.csg-th__sort {
  font-size: 9px;
}
.csg-th__resize {
  position: absolute;
  top: 0;
  right: -3px;
  width: 7px;
  height: 100%;
  cursor: col-resize;
  z-index: 1;
}
.csg-th__resize:hover {
  background: var(--csg-accent);
  opacity: 0.4;
}

.csg-body {
  position: relative;
  min-width: 100%;
}
.csg-tr {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  width: 100%;
  height: var(--csg-row-height);
  border-left: 3px solid transparent;
  cursor: pointer;
}
.csg-tr--odd {
  background: var(--csg-bg-alt);
}
.csg-tr:hover {
  background: var(--csg-bg-hover);
}
.csg-tr--selected,
.csg-tr--selected:hover {
  background: var(--csg-bg-selected);
}
.csg-sev--critical {
  border-left-color: var(--csg-sev-critical);
}
.csg-sev--high {
  border-left-color: var(--csg-sev-high);
}
.csg-sev--medium {
  border-left-color: var(--csg-sev-medium);
}
.csg-sev--low {
  border-left-color: var(--csg-sev-low);
}
.csg-sev--info {
  border-left-color: var(--csg-sev-info);
}
.csg-td {
  padding: 0 10px;
  line-height: var(--csg-row-height);
  font-family: var(--csg-font-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csg-hl {
  padding: 0 1px;
  border-radius: 2px;
  background: var(--csg-hl-bg);
  color: var(--csg-hl-text);
}
.csg-empty {
  position: sticky;
  left: 0;
  padding: 40px 16px;
  color: var(--csg-text-muted);
  text-align: center;
}

.csg-detail {
  display: flex;
  flex-direction: column;
  width: 380px;
  max-width: 45%;
  border-left: 1px solid var(--csg-border);
  background: var(--csg-bg);
}
.csg-detail__header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--csg-border);
  background: var(--csg-header-bg);
}
.csg-detail__header .csg-btn {
  height: 26px;
  padding: 0 8px;
}
.csg-detail__raw {
  flex: 1;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: var(--csg-font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.csg-detail__table {
  display: block;
  flex: 1;
  overflow: auto;
  border-collapse: collapse;
  font-size: 12px;
}
.csg-detail__table tbody {
  display: table;
  width: 100%;
}
.csg-detail__table th,
.csg-detail__table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--csg-border);
  text-align: left;
  vertical-align: top;
}
.csg-detail__table th {
  width: 35%;
  color: var(--csg-text-muted);
  font-weight: 500;
  word-break: break-all;
}
.csg-detail__table td {
  font-family: var(--csg-font-mono);
  word-break: break-all;
}
.csg-detail__actions {
  width: 56px;
  white-space: nowrap;
}
.csg-icon-btn {
  width: 22px;
  height: 22px;
  margin-left: 2px;
  padding: 0;
  border: 1px solid var(--csg-border);
  border-radius: 3px;
  background: var(--csg-bg);
  color: var(--csg-text);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.csg-icon-btn:hover {
  border-color: var(--csg-accent);
  color: var(--csg-accent);
}
</style>
