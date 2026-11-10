<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { GridMessages } from '../types'
import { DEFAULT_MESSAGES, fmtMsg } from '../messages'
import { analyzePayload, formatBytes } from '../utils/payload'
import { analyzeCapture, fieldAt, matchPacketFilter, toPcapFile, type PcapField, type PcapLayer } from '../utils/pcap'
import { downloadBlob, timestampedName } from '../utils/export'

const props = withDefaults(
  defineProps<{
    /** payload 값 (base64 / hex 문자열 또는 Uint8Array) */
    value: unknown
    /** 'base64' | 'hex' — 미지정 시 자동 판별 */
    encoding?: string | null
    messages?: GridMessages
    /** hex 뷰 최대 바이트 (패킷 1개 기준) */
    maxHexBytes?: number
    /** 파싱할 최대 패킷 수 */
    maxPackets?: number
  }>(),
  { encoding: null, messages: () => DEFAULT_MESSAGES, maxHexBytes: 16 * 1024, maxPackets: 10000 },
)

const bytes = computed<Uint8Array | null>(() => {
  if (props.value instanceof Uint8Array) return props.value
  return analyzePayload(props.value, props.encoding)?.bytes ?? null
})
const capture = computed(() => (bytes.value ? analyzeCapture(bytes.value, props.maxPackets) : null))

const filter = ref('')
const filtered = computed(() => {
  const c = capture.value
  if (!c) return []
  return filter.value.trim() ? c.packets.filter((p) => matchPacketFilter(p, filter.value)) : c.packets
})
const LIST_LIMIT = 5000
const listRows = computed(() => filtered.value.slice(0, LIST_LIMIT))

const selNo = ref(1)
const current = computed(() => capture.value?.packets[selNo.value - 1] ?? capture.value?.packets[0] ?? null)

type Range = { start: number; end: number }
const selRange = shallowRef<Range | null>(null)
const open = ref(new Set<string>())

watch(
  capture,
  (c) => {
    selNo.value = c?.packets[0]?.frame.no ?? 1
    filter.value = ''
  },
  { immediate: true },
)
watch(
  current,
  (p) => {
    selRange.value = null
    // 레이어는 기본 펼침, 하위 필드 그룹은 접힘
    open.value = new Set(p?.layers.map((_, i) => `L${i}`) ?? [])
  },
  { immediate: true },
)

const t0 = computed(() => capture.value?.packets.find((p) => p.frame.ts != null)?.frame.ts ?? null)
function relTime(ts: number | null): string {
  if (ts == null || t0.value == null) return '—'
  return (ts - t0.value).toFixed(6)
}
function absTime(ts: number | null): string {
  if (ts == null) return ''
  return new Date(ts * 1000).toISOString()
}

const PROTO_CLASS: Record<string, string> = {
  TCP: 'tcp',
  UDP: 'udp',
  HTTP: 'http',
  TLS: 'tls',
  DNS: 'dns',
  ICMP: 'icmp',
  ICMPv6: 'icmp',
  ARP: 'arp',
}
const protoClass = (p: string) => `csg-pcap__proto--${PROTO_CLASS[p] ?? 'other'}`

function toggle(key: string): void {
  const s = new Set(open.value)
  if (s.has(key)) s.delete(key)
  else s.add(key)
  open.value = s
}
function select(x: Range): void {
  selRange.value = { start: x.start, end: x.end }
}
const isSel = (x: Range) => !!selRange.value && selRange.value.start === x.start && selRange.value.end === x.end

/** 트리를 평탄화해 렌더 (key, depth, 펼침 상태 포함) */
type TreeRow = { key: string; depth: number; node: PcapLayer | PcapField; layer: boolean; hasKids: boolean }
const treeRows = computed<TreeRow[]>(() => {
  const p = current.value
  if (!p) return []
  const out: TreeRow[] = []
  const walk = (fs: PcapField[], prefix: string, depth: number) => {
    fs.forEach((fd, i) => {
      const key = `${prefix}.${i}`
      const hasKids = !!fd.children?.length
      out.push({ key, depth, node: fd, layer: false, hasKids })
      if (hasKids && open.value.has(key)) walk(fd.children!, key, depth + 1)
    })
  }
  p.layers.forEach((l, i) => {
    const key = `L${i}`
    out.push({ key, depth: 0, node: l, layer: true, hasKids: l.fields.length > 0 })
    if (open.value.has(key)) walk(l.fields, key, 1)
  })
  return out
})

const frameRow = computed(() => {
  const fr = current.value?.frame
  if (!fr) return ''
  return `Frame ${fr.no}: ${fr.origLen} bytes on wire, ${fr.capLen} bytes captured${fr.ts != null ? ` · ${absTime(fr.ts)}` : ''}`
})

// ------------------------------------------------------------ hex pane
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))
const hexRows = computed(() => {
  const d = current.value?.frame.data
  if (!d) return []
  const n = Math.min(d.length, props.maxHexBytes)
  const rows: { off: number; cells: { i: number; hex: string; ch: string }[] }[] = []
  for (let off = 0; off < n; off += 16) {
    const cells = []
    for (let i = off; i < Math.min(off + 16, n); i++) {
      const b = d[i]
      cells.push({ i, hex: HEX[b], ch: b >= 32 && b < 127 ? String.fromCharCode(b) : '.' })
    }
    rows.push({ off, cells })
  }
  return rows
})
const hexTruncated = computed(() => (current.value?.frame.data.length ?? 0) > props.maxHexBytes)
const inSel = (i: number) => !!selRange.value && i >= selRange.value.start && i < selRange.value.end

function pickByte(i: number): void {
  const p = current.value
  if (!p) return
  const hit = fieldAt(p.layers, i)
  if (!hit) return
  select(hit)
  // 선택 필드가 보이도록 상위 노드 펼치기
  const s = new Set(open.value)
  p.layers.forEach((l, li) => {
    if (i < l.start || i >= l.end) return
    s.add(`L${li}`)
    const walk = (fs: PcapField[], prefix: string) =>
      fs.forEach((fd, fi) => {
        if (i < fd.start || i >= fd.end || !fd.children?.length) return
        const key = `${prefix}.${fi}`
        if (fd !== hit) s.add(key)
        walk(fd.children, key)
      })
    walk(l.fields, `L${li}`)
  })
  open.value = s
}

function onListKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const rows = listRows.value
  const idx = rows.findIndex((r) => r.frame.no === selNo.value)
  const next = rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
  if (next) {
    selNo.value = next.frame.no
    ;(e.currentTarget as HTMLElement).querySelector(`[data-no="${next.frame.no}"]`)?.scrollIntoView({ block: 'nearest' })
  }
}

function download(): void {
  const c = capture.value
  if (!c) return
  const out =
    c.format === 'raw' ? toPcapFile(c.frames) : bytes.value! // 원본 캡처 파일은 그대로 저장
  downloadBlob(new Blob([out as BlobPart], { type: 'application/vnd.tcpdump.pcap' }), timestampedName('capture', c.format === 'pcapng' ? 'pcapng' : 'pcap'))
}
</script>

<template>
  <div class="csg-pcap">
    <div v-if="!capture" class="csg-payload__empty">{{ messages.pcapNotPacket }}</div>
    <template v-else>
      <div class="csg-payload__bar">
        <input
          v-if="capture.packets.length > 1"
          v-model="filter"
          class="csg-input csg-pcap__filter"
          type="search"
          :placeholder="messages.pcapFilter"
          :aria-label="messages.pcapFilter"
          spellcheck="false"
        />
        <span class="csg-payload__meta">
          {{ capture.format }} ·
          {{
            filter.trim()
              ? `${fmtMsg(messages.pcapPackets, filtered.length)} / ${capture.packets.length}`
              : fmtMsg(messages.pcapPackets, capture.packets.length)
          }}
          · {{ formatBytes(bytes?.length ?? 0) }}
        </span>
        <span class="csg-payload__spacer" />
        <button type="button" class="csg-btn csg-btn--sm" :title="messages.pcapDownloadHint" @click="download">⤓ {{ messages.pcapDownload }}</button>
      </div>
      <div v-if="capture.truncated || capture.warnings.length" class="csg-payload__note">
        {{ capture.warnings[0] ?? messages.truncated }}
      </div>

      <!-- 패킷 목록 -->
      <div
        v-if="capture.packets.length > 1"
        class="csg-pcap__list"
        tabindex="0"
        role="listbox"
        :aria-label="messages.pcapPacketList"
        @keydown="onListKey"
      >
        <table class="csg-pcap__table">
          <thead>
            <tr>
              <th class="csg-pcap__num">No.</th>
              <th>Time</th>
              <th>Source</th>
              <th>Destination</th>
              <th>Protocol</th>
              <th class="csg-pcap__num">Length</th>
              <th>Info</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in listRows"
              :key="p.frame.no"
              :data-no="p.frame.no"
              role="option"
              :aria-selected="p.frame.no === selNo"
              :class="[protoClass(p.summary.protocol), { 'csg-pcap__row--on': p.frame.no === selNo }]"
              @click="selNo = p.frame.no"
            >
              <td class="csg-pcap__num">{{ p.frame.no }}</td>
              <td :title="absTime(p.frame.ts)">{{ relTime(p.frame.ts) }}</td>
              <td>{{ p.summary.src }}</td>
              <td>{{ p.summary.dst }}</td>
              <td>{{ p.summary.protocol }}</td>
              <td class="csg-pcap__num">{{ p.frame.origLen }}</td>
              <td class="csg-pcap__info">{{ p.summary.info }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!filtered.length" class="csg-payload__empty">{{ messages.pcapNoMatch }}</div>
        <div v-else-if="filtered.length > LIST_LIMIT" class="csg-payload__note">{{ messages.truncated }}</div>
      </div>

      <!-- 단일 패킷 요약 -->
      <div v-else-if="current" class="csg-pcap__single" :class="protoClass(current.summary.protocol)">
        <strong>{{ current.summary.protocol }}</strong>
        <span>{{ current.summary.src }} → {{ current.summary.dst }}</span>
        <span class="csg-pcap__info">{{ current.summary.info }}</span>
      </div>

      <template v-if="current">
        <!-- 프로토콜 트리 -->
        <div class="csg-pcap__tree" role="tree" :aria-label="messages.pcapTree">
          <div class="csg-pcap__node csg-pcap__node--frame">{{ frameRow }}</div>
          <div
            v-for="r in treeRows"
            :key="r.key"
            role="treeitem"
            class="csg-pcap__node"
            :class="{ 'csg-pcap__node--layer': r.layer, 'csg-pcap__node--on': isSel(r.node) }"
            :style="{ paddingLeft: `${8 + r.depth * 16}px` }"
            :aria-expanded="r.hasKids ? open.has(r.key) : undefined"
            @click="select(r.node)"
          >
            <button
              v-if="r.hasKids"
              type="button"
              class="csg-pcap__twisty"
              :aria-label="open.has(r.key) ? messages.collapseAll : messages.expandAll"
              @click.stop="toggle(r.key)"
            >
              {{ open.has(r.key) ? '▾' : '▸' }}
            </button>
            <span v-else class="csg-pcap__twisty" />
            <template v-if="r.layer">{{ (r.node as PcapLayer).title }}</template>
            <template v-else>
              <span class="csg-pcap__fname">{{ (r.node as PcapField).name }}</span
              ><span v-if="(r.node as PcapField).value" class="csg-pcap__fval">{{ (r.node as PcapField).value }}</span>
            </template>
          </div>
        </div>

        <!-- hex -->
        <div class="csg-pcap__hex" :aria-label="messages.pcapBytes">
          <div v-for="row in hexRows" :key="row.off" class="csg-pcap__hexrow">
            <span class="csg-pcap__off">{{ row.off.toString(16).padStart(4, '0') }}</span>
            <span class="csg-pcap__bytes"
              ><span
                v-for="cell in row.cells"
                :key="cell.i"
                class="csg-pcap__b"
                :class="{ 'csg-pcap__b--on': inSel(cell.i), 'csg-pcap__b--gap': cell.i % 16 === 7 }"
                @click="pickByte(cell.i)"
                >{{ cell.hex }}</span
              ></span
            >
            <span class="csg-pcap__ascii"
              ><span
                v-for="cell in row.cells"
                :key="cell.i"
                class="csg-pcap__c"
                :class="{ 'csg-pcap__b--on': inSel(cell.i) }"
                @click="pickByte(cell.i)"
                >{{ cell.ch }}</span
              ></span
            >
          </div>
          <div v-if="hexTruncated" class="csg-payload__note">{{ messages.truncated }}</div>
        </div>
      </template>
    </template>
  </div>
</template>

<style>
.csg-pcap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  font-size: 12px;
}
.csg-pcap__filter {
  flex: 1 1 160px !important;
  height: 24px;
  font-family: var(--csg-font-mono);
}
.csg-pcap__list {
  flex: 0 1 auto;
  max-height: 34%;
  min-height: 72px;
  overflow: auto;
  border-bottom: 1px solid var(--csg-border);
  outline: none;
}
.csg-pcap__list:focus-visible {
  box-shadow: inset 0 0 0 2px var(--csg-focus);
}
.csg-pcap__table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--csg-font-mono);
  font-size: 11.5px;
}
.csg-pcap__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 4px 6px;
  border-bottom: 1px solid var(--csg-border);
  background: var(--csg-header-bg);
  color: var(--csg-text-muted);
  font-family: var(--csg-font);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
.csg-pcap__table td {
  padding: 2px 6px;
  white-space: nowrap;
  cursor: pointer;
}
.csg-pcap__num {
  text-align: right !important;
}
.csg-pcap__info {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 0;
  width: 40%;
}
.csg-pcap__single .csg-pcap__info {
  max-width: none;
  width: auto;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}
/* 프로토콜 색상 (Wireshark coloring rule 유사, 테마 토큰 기반) */
.csg-pcap__proto--tcp {
  background: color-mix(in srgb, var(--csg-series-7) 10%, transparent);
}
.csg-pcap__proto--udp,
.csg-pcap__proto--dns {
  background: color-mix(in srgb, var(--csg-series-1) 12%, transparent);
}
.csg-pcap__proto--http {
  background: color-mix(in srgb, var(--csg-series-3) 16%, transparent);
}
.csg-pcap__proto--tls {
  background: color-mix(in srgb, var(--csg-series-4) 14%, transparent);
}
.csg-pcap__proto--icmp,
.csg-pcap__proto--arp {
  background: color-mix(in srgb, var(--csg-series-5) 14%, transparent);
}
.csg-pcap__row--on,
.csg-pcap__row--on td {
  background: var(--csg-accent) !important;
  color: var(--csg-accent-text);
}
.csg-pcap__single {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--csg-border);
  font-family: var(--csg-font-mono);
  font-size: 11.5px;
  overflow: hidden;
}
.csg-pcap__tree {
  flex: 1 1 40%;
  min-height: 80px;
  overflow: auto;
  padding: 4px 0;
  border-bottom: 1px solid var(--csg-border);
  font-family: var(--csg-font-mono);
  font-size: 11.5px;
}
.csg-pcap__node {
  display: flex;
  align-items: center;
  min-height: 20px;
  padding-right: 8px;
  white-space: nowrap;
  cursor: default;
}
.csg-pcap__node:hover {
  background: var(--csg-bg-hover);
}
.csg-pcap__node--frame {
  padding-left: 24px;
  color: var(--csg-text-muted);
}
.csg-pcap__node--layer {
  font-weight: 600;
}
.csg-pcap__node--on,
.csg-pcap__node--on:hover {
  background: var(--csg-bg-selected);
}
.csg-pcap__twisty {
  flex: none;
  width: 16px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--csg-text-muted);
  font: inherit;
  text-align: center;
  cursor: pointer;
}
.csg-pcap__fname {
  color: var(--csg-text-muted);
}
.csg-pcap__fval {
  color: var(--csg-text);
}
.csg-pcap__fval::before {
  content: ': ';
  color: var(--csg-text-muted);
  white-space: pre;
}
.csg-pcap__hex {
  flex: 1 1 30%;
  min-height: 60px;
  overflow: auto;
  padding: 6px 10px;
  font-family: var(--csg-font-mono);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre;
}
.csg-pcap__hexrow {
  display: flex;
  gap: 12px;
}
.csg-pcap__off {
  color: var(--csg-text-muted);
  user-select: none;
}
.csg-pcap__bytes {
  display: inline-grid;
  grid-template-columns: repeat(16, auto);
  column-gap: 0.5ch;
  min-width: calc(16 * 2.5ch + 0.5ch);
}
.csg-pcap__b,
.csg-pcap__c {
  cursor: pointer;
  border-radius: 2px;
}
.csg-pcap__b--gap {
  margin-right: 0.6ch;
}
.csg-pcap__b--on {
  background: var(--csg-hl-bg);
  color: var(--csg-hl-text);
}
.csg-pcap__b:hover,
.csg-pcap__c:hover {
  outline: 1px solid var(--csg-accent);
}
</style>
