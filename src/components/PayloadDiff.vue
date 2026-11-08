<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GridMessages } from '../types'
import { DEFAULT_MESSAGES, fmtMsg } from '../messages'
import { analyzePayload, hexDump } from '../utils/payload'
import { diffTexts, inlineDiff, splitLines, stableJson, type DiffRow, type InlineSegment } from '../utils/diff'
import type { DiffInput } from '../utils/diff'

const props = withDefaults(
  defineProps<{
    left: DiffInput
    right: DiffInput
    messages?: GridMessages
    /** 렌더링 최대 행 수 */
    maxRows?: number
  }>(),
  { messages: () => DEFAULT_MESSAGES, maxRows: 5000 },
)

type Mode = 'auto' | 'text' | 'hex'
const mode = ref<Mode>('auto')
const ignoreWs = ref(false)
const onlyChanges = ref(true)
const swapped = ref(false)
const expandedSkips = ref(new Set<number>())
const body = ref<HTMLElement | null>(null)
const CONTEXT = 3

const L = computed(() => (swapped.value ? props.right : props.left))
const R = computed(() => (swapped.value ? props.left : props.right))

const infoL = computed(() => analyzePayload(L.value.value, L.value.encoding))
const infoR = computed(() => analyzePayload(R.value.value, R.value.encoding))
/** 한쪽이라도 바이너리면 양쪽 모두 hex 로 비교 */
const effectiveMode = computed<Mode>(() =>
  mode.value === 'auto' && (infoL.value?.binary || infoR.value?.binary) ? 'hex' : mode.value,
)

function linesOf(info: ReturnType<typeof analyzePayload>, m: Mode): string[] {
  if (!info) return []
  if (m === 'hex') return splitLines(hexDump(info.bytes, 256 * 1024).text)
  if (m === 'auto' && info.json) {
    try {
      return splitLines(stableJson(JSON.parse(info.text)))
    } catch {
      /* JSON 아님 */
    }
  }
  return splitLines(info.text)
}

const result = computed(() => {
  const norm = ignoreWs.value ? (s: string) => s.replace(/\s+/g, ' ').trim() : undefined
  return diffTexts(linesOf(infoL.value, effectiveMode.value), linesOf(infoR.value, effectiveMode.value), { normalize: norm })
})
const identical = computed(() => !result.value.added && !result.value.removed && !result.value.changed)

type ViewItem = { kind: 'row'; row: DiffRow; idx: number } | { kind: 'skip'; start: number; count: number }

const view = computed<ViewItem[]>(() => {
  const rows = result.value.rows
  const out: ViewItem[] = []
  let i = 0
  while (i < rows.length && out.length < props.maxRows) {
    if (rows[i].type !== 'equal' || !onlyChanges.value) {
      out.push({ kind: 'row', row: rows[i], idx: i })
      i++
      continue
    }
    let e = i
    while (e < rows.length && rows[e].type === 'equal') e++
    const head = i === 0 ? 0 : CONTEXT
    const tail = e === rows.length ? 0 : CONTEXT
    if (e - i > head + tail + 1 && !expandedSkips.value.has(i + head)) {
      for (let k = i; k < i + head; k++) out.push({ kind: 'row', row: rows[k], idx: k })
      out.push({ kind: 'skip', start: i + head, count: e - i - head - tail })
      for (let k = e - tail; k < e; k++) out.push({ kind: 'row', row: rows[k], idx: k })
    } else for (let k = i; k < e; k++) out.push({ kind: 'row', row: rows[k], idx: k })
    i = e
  }
  return out
})
const truncated = computed(() => view.value.length >= props.maxRows)

function expand(start: number) {
  expandedSkips.value = new Set([...expandedSkips.value, start])
}

const changeStarts = computed(() => {
  const rows = result.value.rows
  const out: number[] = []
  rows.forEach((r, i) => {
    if (r.type !== 'equal' && (i === 0 || rows[i - 1].type === 'equal')) out.push(i)
  })
  return out
})
const current = ref(-1)
function go(delta: number) {
  const list = changeStarts.value
  if (!list.length) return
  current.value = (current.value + delta + list.length) % list.length
  const el = body.value?.querySelector<HTMLElement>(`[data-ri="${list[current.value]}"]`)
  el?.scrollIntoView?.({ block: 'center' })
}

function segs(row: DiffRow, side: 'left' | 'right'): InlineSegment[] {
  const text = row[side]?.text ?? ''
  if (row.type !== 'change' || !row.left || !row.right) return [{ t: text, changed: false }]
  return inlineDiff(row.left.text, row.right.text)[side]
}
</script>

<template>
  <div class="csg-diff">
    <div class="csg-diff__bar">
      <div class="csg-seg" role="radiogroup" aria-label="mode">
        <button
          v-for="mo in (['auto', 'text', 'hex'] as const)"
          :key="mo"
          type="button"
          role="radio"
          class="csg-seg__btn"
          :class="{ 'csg-seg__btn--on': mode === mo }"
          :aria-checked="mode === mo"
          @click="mode = mo"
        >
          {{ mo === 'auto' ? 'Auto' : mo === 'text' ? 'Text' : 'Hex' }}
        </button>
      </div>
      <label class="csg-payload__wrap"><input v-model="ignoreWs" type="checkbox" />{{ messages.ignoreWhitespace }}</label>
      <label class="csg-payload__wrap"><input v-model="onlyChanges" type="checkbox" />{{ messages.onlyChanges }}</label>
      <span class="csg-payload__spacer" />
      <span class="csg-diff__stats" aria-live="polite">
        <span class="csg-diff__stat--add">+{{ result.added }}</span>
        <span class="csg-diff__stat--del">−{{ result.removed }}</span>
        <span class="csg-diff__stat--chg">~{{ result.changed }}</span>
      </span>
      <button type="button" class="csg-btn csg-btn--sm" :disabled="!changeStarts.length" :title="messages.prevChange" :aria-label="messages.prevChange" @click="go(-1)">↑</button>
      <button type="button" class="csg-btn csg-btn--sm" :disabled="!changeStarts.length" :title="messages.nextChange" :aria-label="messages.nextChange" @click="go(1)">↓</button>
      <button type="button" class="csg-btn csg-btn--sm" :title="messages.swap" @click="swapped = !swapped">⇆</button>
    </div>
    <div class="csg-diff__heads">
      <div class="csg-diff__head csg-diff__head--l" :title="L.label">◀ {{ L.label }}</div>
      <div class="csg-diff__head csg-diff__head--r" :title="R.label">▶ {{ R.label }}</div>
    </div>
    <div v-if="identical" class="csg-diff__note">{{ messages.identical }}</div>
    <div v-if="result.simplified" class="csg-diff__note">{{ messages.diffTooLarge }}</div>
    <div
      ref="body"
      class="csg-diff__body"
      :class="{ 'csg-diff__body--nowrap': effectiveMode === 'hex' }"
      role="table"
      :aria-label="messages.diffTitle"
    >
      <template v-for="v in view" :key="v.kind === 'row' ? `r${v.idx}` : `s${v.start}`">
        <button v-if="v.kind === 'skip'" type="button" class="csg-diff__skip" @click="expand(v.start)">
          ⋯ {{ fmtMsg(messages.sameLines, v.count) }}
        </button>
        <div v-else class="csg-diff__row" :class="`csg-diff__row--${v.row.type}`" :data-ri="v.idx" role="row">
          <span class="csg-diff__no" role="cell">{{ v.row.left?.no ?? '' }}</span>
          <span class="csg-diff__code csg-diff__code--l" role="cell"
            ><template v-for="(s, i) in segs(v.row, 'left')" :key="i"
              ><mark v-if="s.changed" class="csg-diff__mark">{{ s.t }}</mark><template v-else>{{ s.t }}</template></template
            ></span
          >
          <span class="csg-diff__no" role="cell">{{ v.row.right?.no ?? '' }}</span>
          <span class="csg-diff__code csg-diff__code--r" role="cell"
            ><template v-for="(s, i) in segs(v.row, 'right')" :key="i"
              ><mark v-if="s.changed" class="csg-diff__mark">{{ s.t }}</mark><template v-else>{{ s.t }}</template></template
            ></span
          >
        </div>
      </template>
      <div v-if="truncated" class="csg-diff__note">{{ messages.truncated }}</div>
    </div>
  </div>
</template>
