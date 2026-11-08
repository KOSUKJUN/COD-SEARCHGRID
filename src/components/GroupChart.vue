<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GridMessages } from '../types'
import { DEFAULT_MESSAGES } from '../messages'
import type { GroupNode } from '../utils/group'

/**
 * 그룹 분포 차트 — 1레벨 그룹을 가로 막대로, 2레벨 그룹이 있으면 누적(stacked) 막대로 표시.
 * 색상은 2레벨 값(엔티티)에 고정 순서로 배정되며 순위가 바뀌어도 다시 칠하지 않는다.
 */
const props = withDefaults(
  defineProps<{
    roots: GroupNode[]
    /** 2레벨 그룹 (없거나 미로딩이면 undefined) */
    childrenOf?: (node: GroupNode) => GroupNode[] | undefined
    fieldLabel: string
    subFieldLabel?: string
    messages?: GridMessages
    maxBars?: number
    /** childrenOf 결과가 바뀌었음을 알리는 버전 (원격 로딩용) */
    version?: number
  }>(),
  { childrenOf: undefined, subFieldLabel: undefined, messages: () => DEFAULT_MESSAGES, maxBars: 12, version: 0 },
)
const emit = defineEmits<{ select: [node: GroupNode] }>()

const SLOTS = 7
const fmt = new Intl.NumberFormat()
const keyOf = (v: string | null) => (v === null ? '\u0000' : v)
const labelOf = (v: string | null) => (v === null ? props.messages.emptyValue : v === '' ? '""' : v)

const bars = computed(() => props.roots.slice(0, props.maxBars))
const hiddenCount = computed(() => props.roots.length - bars.value.length)
const max = computed(() => Math.max(1, ...bars.value.map((b) => b.count)))

// 2레벨 값 → 색 슬롯 (엔티티 고정, 하위 필드가 바뀔 때만 초기화)
// (반응형 아님: legend computed 안에서 갱신되며, 템플릿은 legend → segments 순으로 읽는다)
const slotMap = { value: new Map<string, number>() }
watch(
  () => props.subFieldLabel,
  () => (slotMap.value = new Map()),
)

const subTotals = computed(() => {
  void props.version
  const totals = new Map<string, { value: string | null; count: number }>()
  if (!props.childrenOf) return totals
  for (const b of bars.value)
    for (const c of props.childrenOf(b) ?? []) {
      const k = keyOf(c.value)
      const t = totals.get(k)
      if (t) t.count += c.count
      else totals.set(k, { value: c.value, count: c.count })
    }
  return totals
})

const legend = computed(() => {
  const map = slotMap.value
  const ranked = [...subTotals.value.entries()].sort((a, b) => b[1].count - a[1].count)
  // 기존 배정 유지, 새 값은 빈 슬롯에 순서대로
  const used = new Set(map.values())
  for (const [k] of ranked) {
    if (map.has(k)) continue
    if (used.size >= SLOTS) break
    let s = 1
    while (used.has(s)) s++
    map.set(k, s)
    used.add(s)
  }
  const out = ranked
    .filter(([k]) => map.has(k))
    .map(([k, t]) => ({ key: k, label: labelOf(t.value), slot: map.get(k)! }))
    .sort((a, b) => a.slot - b.slot)
  if (ranked.some(([k]) => !map.has(k))) out.push({ key: '__other', label: props.messages.others, slot: 0 })
  return out
})

const stacked = computed(() => legend.value.length > 0)

interface Seg {
  key: string
  label: string
  count: number
  slot: number
}
function segments(node: GroupNode): Seg[] {
  void props.version
  const children = props.childrenOf?.(node)
  if (!children?.length) return [{ key: '__all', label: labelOf(node.value), count: node.count, slot: 1 }]
  const out: Seg[] = []
  let other = 0
  for (const c of children) {
    const slot = slotMap.value.get(keyOf(c.value))
    if (slot) out.push({ key: keyOf(c.value), label: labelOf(c.value), count: c.count, slot })
    else other += c.count
  }
  out.sort((a, b) => a.slot - b.slot)
  const rest = node.count - out.reduce((a, s) => a + s.count, 0) - other
  if (other + rest > 0) out.push({ key: '__other', label: props.messages.others, count: other + Math.max(0, rest), slot: 0 })
  return out
}

// ---- hover tooltip
const tip = ref<{ x: number; y: number; title: string; lines: string[] } | null>(null)
const root = ref<HTMLElement | null>(null)
function showTip(e: MouseEvent, node: GroupNode, seg?: Seg) {
  const r = root.value?.getBoundingClientRect()
  const lines = [`${props.fieldLabel}: ${fmt.format(node.count)} (${((node.count / Math.max(1, node.parentCount)) * 100).toFixed(1)}%)`]
  if (seg && seg.key !== '__all')
    lines.push(`${props.subFieldLabel ?? ''} ${seg.label}: ${fmt.format(seg.count)} (${((seg.count / Math.max(1, node.count)) * 100).toFixed(1)}%)`)
  tip.value = { x: e.clientX - (r?.left ?? 0) + 12, y: e.clientY - (r?.top ?? 0) + 12, title: labelOf(node.value), lines }
}
</script>

<template>
  <section ref="root" class="csg-chart" :aria-label="messages.chartTitle" @mouseleave="tip = null">
    <header class="csg-chart__head">
      <strong>{{ messages.chartTitle }}</strong>
      <span class="csg-chart__sub">{{ fieldLabel }}<template v-if="stacked && subFieldLabel"> × {{ subFieldLabel }}</template></span>
      <ul v-if="stacked" class="csg-chart__legend">
        <li v-for="l in legend" :key="l.key">
          <span class="csg-chart__swatch" :class="`csg-series-${l.slot || 'other'}`" />{{ l.label }}
        </li>
      </ul>
    </header>
    <ul class="csg-chart__rows" role="list">
      <li
        v-for="b in bars"
        :key="b.key"
        class="csg-chart__row"
        role="button"
        tabindex="0"
        :aria-label="`${labelOf(b.value)} ${fmt.format(b.count)}`"
        @click="emit('select', b)"
        @keydown.enter.prevent="emit('select', b)"
      >
        <span class="csg-chart__label" :title="labelOf(b.value)">{{ labelOf(b.value) }}</span>
        <span class="csg-chart__track">
          <span class="csg-chart__bar" :style="{ width: `${(b.count / max) * 100}%` }">
            <span
              v-for="s in segments(b)"
              :key="s.key"
              class="csg-chart__seg"
              :class="`csg-series-${s.slot || 'other'}`"
              :style="{ flexGrow: s.count }"
              @mousemove="showTip($event, b, s)"
            />
          </span>
        </span>
        <span class="csg-chart__value">{{ fmt.format(b.count) }}</span>
      </li>
    </ul>
    <div v-if="hiddenCount > 0" class="csg-chart__more">+{{ fmt.format(hiddenCount) }} {{ messages.groups }}</div>
    <div v-if="tip" class="csg-chart__tip" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }" role="tooltip">
      <strong>{{ tip.title }}</strong>
      <div v-for="(l, i) in tip.lines" :key="i">{{ l }}</div>
    </div>
  </section>
</template>
