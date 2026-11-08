<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
// playground 는 배포 패키지와 같은 진입점(src/index.ts)을 사용한다
import { SearchGrid, type DataSource, type GridColumn, type LogRecord } from '../src'
import { generateEvents } from '../mock-server/generate'

type Mode = 'remote' | 'local'

const mode = ref<Mode>('remote')
const theme = ref<'light' | 'dark'>(
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
)
const query = ref('')
const lastClicked = ref<LogRecord | null>(null)

const columns: GridColumn[] = [
  {
    field: '_time',
    label: 'Time',
    width: 190,
    formatter: (v) => (typeof v === 'string' ? v.replace('T', ' ').replace('Z', '') : String(v ?? '')),
  },
  {
    field: 'severity',
    label: 'Severity',
    width: 100,
    cellClass: (v) => `sev-badge sev-badge--${String(v)}`,
  },
  { field: 'host', label: 'Host', width: 120 },
  { field: 'sourcetype', label: 'Sourcetype', width: 140 },
  { field: 'action', label: 'Action', width: 90 },
  { field: 'user', label: 'User', width: 110 },
  { field: 'src_ip', label: 'Src IP', width: 130 },
  { field: 'dest_ip', label: 'Dest IP', width: 130 },
  { field: 'dest_port', label: 'Port', width: 70, align: 'right' },
  { field: 'geo.country', label: 'Country', width: 80 },
  { field: 'message', label: 'Message', width: 640 },
]

// --- 원격 모드: docker 의 mock-api (/api 프록시) 호출
const remoteSource: DataSource = async ({ query, offset, limit, sort, signal }) => {
  const params = new URLSearchParams({ q: query, offset: String(offset), limit: String(limit) })
  if (sort) {
    params.set('sort', sort.field)
    params.set('order', sort.order)
  }
  const res = await fetch(`/api/search?${params}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// --- 로컬 모드: 브라우저에서 생성한 데이터로 클라이언트 측 검색
const localRows = shallowRef<LogRecord[]>([])
function ensureLocal() {
  if (!localRows.value.length) localRows.value = generateEvents(20000)
}

const dataSource = computed(() => (mode.value === 'remote' ? remoteSource : undefined))
const rows = computed(() => (mode.value === 'local' ? localRows.value : []))

function setMode(m: Mode) {
  if (m === 'local') ensureLocal()
  mode.value = m
}

const examples = [
  'severity=critical',
  'sourcetype=linux_secure action=failure',
  'host=web-* NOT 200',
  'dest_port>=3389 action=blocked',
  'geo.country=RU',
  '"audit log was cleared"',
]
const grid = ref<InstanceType<typeof SearchGrid> | null>(null)
</script>

<template>
  <div class="page" :class="`page--${theme}`">
    <header class="bar">
      <h1>COD-SEARCHGRID <small>playground</small></h1>
      <div class="seg">
        <button :class="{ on: mode === 'remote' }" @click="setMode('remote')">Remote API (50k)</button>
        <button :class="{ on: mode === 'local' }" @click="setMode('local')">Local (20k)</button>
      </div>
      <button class="ghost" @click="theme = theme === 'dark' ? 'light' : 'dark'">
        {{ theme === 'dark' ? '☀ Light' : '☾ Dark' }}
      </button>
    </header>

    <div class="examples">
      <span>예시:</span>
      <button v-for="ex in examples" :key="ex" class="chip" @click="grid?.search(ex)">{{ ex }}</button>
    </div>

    <main class="content">
      <SearchGrid
        ref="grid"
        :key="mode"
        v-model:query="query"
        :columns="columns"
        :data-source="dataSource"
        :rows="rows"
        :theme="theme"
        :default-sort="{ field: '_time', order: 'desc' }"
        row-key="event_id"
        @row-click="(row) => (lastClicked = row)"
      >
        <template #status>
          <span v-if="lastClicked">selected: {{ lastClicked.event_id }}</span>
        </template>
      </SearchGrid>
    </main>
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
.page {
  --bg: #f4f6f8;
  --fg: #1f2328;
  --muted: #656d76;
  --line: #dde1e6;
  --chip: #ffffff;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  color: var(--fg);
  font-family: ui-sans-serif, system-ui, 'Segoe UI', 'Malgun Gothic', sans-serif;
}
.page--dark {
  --bg: #0a0e13;
  --fg: #d6dde5;
  --muted: #8b96a3;
  --line: #2b3540;
  --chip: #151b22;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
}
.bar h1 {
  flex: 1;
  margin: 0;
  font-size: 16px;
}
.bar h1 small {
  color: var(--muted);
  font-weight: 400;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
.seg button,
.ghost,
.chip {
  border: 0;
  background: var(--chip);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  padding: 6px 10px;
  cursor: pointer;
}
.seg button.on {
  background: #2f6fde;
  color: #fff;
}
.ghost {
  border: 1px solid var(--line);
  border-radius: 6px;
}
.examples {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 0 16px 10px;
  color: var(--muted);
  font-size: 12px;
}
.chip {
  border: 1px solid var(--line);
  border-radius: 999px;
  font-family: ui-monospace, Consolas, monospace;
}
.content {
  flex: 1;
  min-height: 0;
  padding: 0 16px 16px;
}
.sev-badge {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px !important;
}
.sev-badge--critical {
  color: #e53935;
}
.sev-badge--high {
  color: #fb8c00;
}
.sev-badge--medium {
  color: #c79100;
}
.sev-badge--low {
  color: #43a047;
}
.sev-badge--info {
  color: #78909c;
}
</style>
