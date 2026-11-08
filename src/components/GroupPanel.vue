<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GridColumn, GridMessages } from '../types'
import { DEFAULT_MESSAGES } from '../messages'
import { DND_CHIP, DND_FIELD } from '../utils/dnd'

const props = withDefaults(
  defineProps<{
    groupBy: string[]
    columns: GridColumn[]
    messages?: GridMessages
    /** 모두 펼치기 버튼 표시 여부 */
    canExpandAll?: boolean
  }>(),
  { messages: () => DEFAULT_MESSAGES, canExpandAll: true },
)

const emit = defineEmits<{
  'update:groupBy': [fields: string[]]
  'expand-all': []
  'collapse-all': []
}>()

const dragOver = ref(false)

const labelOf = (field: string) => props.columns.find((c) => c.field === field)?.label ?? field
const available = computed(() =>
  props.columns.filter((c) => c.groupable !== false && !props.groupBy.includes(c.field)),
)

function hasType(e: DragEvent, type: string): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes(type)
}

function onDragOver(e: DragEvent) {
  if (!hasType(e, DND_FIELD) && !hasType(e, DND_CHIP)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = hasType(e, DND_CHIP) ? 'move' : 'copy'
  dragOver.value = true
}

/** at: 삽입 위치 (생략 시 맨 뒤) */
function onDrop(e: DragEvent, at?: number) {
  dragOver.value = false
  const dt = e.dataTransfer
  if (!dt) return
  const next = props.groupBy.slice()
  const chip = dt.getData(DND_CHIP)
  const field = dt.getData(DND_FIELD)
  let pos = at ?? next.length
  if (chip !== '') {
    const from = Number(chip)
    const [moved] = next.splice(from, 1)
    if (from < pos) pos--
    next.splice(pos, 0, moved)
  } else if (field) {
    if (props.columns.find((c) => c.field === field)?.groupable === false) return
    const existing = next.indexOf(field)
    if (existing >= 0) {
      next.splice(existing, 1)
      if (existing < pos) pos--
    }
    next.splice(pos, 0, field)
  } else return
  e.preventDefault()
  e.stopPropagation()
  emit('update:groupBy', next)
}

function onChipDragStart(e: DragEvent, index: number) {
  e.dataTransfer?.setData(DND_CHIP, String(index))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function remove(index: number) {
  const next = props.groupBy.slice()
  next.splice(index, 1)
  emit('update:groupBy', next)
}

function onSelect(e: Event) {
  const el = e.target as HTMLSelectElement
  if (el.value) emit('update:groupBy', [...props.groupBy, el.value])
  el.value = ''
}
</script>

<template>
  <div
    class="csg-groupbar"
    :class="{ 'csg-groupbar--over': dragOver }"
    role="toolbar"
    @dragover="onDragOver"
    @dragleave="dragOver = false"
    @drop="onDrop($event)"
  >
    <svg class="csg-groupbar__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16M7 12h13M10 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
    </svg>
    <span v-if="!groupBy.length" class="csg-groupbar__hint">{{ messages.groupHint }}</span>
    <template v-for="(field, i) in groupBy" :key="field">
      <span v-if="i > 0" class="csg-groupbar__sep" aria-hidden="true">›</span>
      <span
        class="csg-chip"
        draggable="true"
        @dragstart="onChipDragStart($event, i)"
        @drop="onDrop($event, i)"
      >
        {{ labelOf(field) }}
        <button type="button" class="csg-chip__x" :aria-label="`${messages.groupRemove}: ${labelOf(field)}`" @click="remove(i)">
          ×
        </button>
      </span>
    </template>
    <select v-if="available.length" class="csg-groupbar__select" :aria-label="messages.groupAdd" @change="onSelect">
      <option value="">{{ messages.groupAdd }}</option>
      <option v-for="c in available" :key="c.field" :value="c.field">{{ c.label ?? c.field }}</option>
    </select>
    <span class="csg-groupbar__spacer" />
    <slot name="actions" />
    <template v-if="groupBy.length">
      <button v-if="canExpandAll" type="button" class="csg-link-btn" @click="emit('expand-all')">{{ messages.expandAll }}</button>
      <button type="button" class="csg-link-btn" @click="emit('collapse-all')">{{ messages.collapseAll }}</button>
    </template>
  </div>
</template>

<style>
.csg-groupbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--csg-border);
  background: var(--csg-bg-alt);
  font-size: 12px;
  transition: background 0.1s;
}
.csg-groupbar--over {
  background: var(--csg-bg-hover);
  outline: 2px dashed var(--csg-accent);
  outline-offset: -4px;
}
.csg-groupbar__icon {
  width: 14px;
  height: 14px;
  color: var(--csg-text-muted);
}
.csg-groupbar__hint {
  color: var(--csg-text-muted);
}
.csg-groupbar__sep {
  color: var(--csg-text-muted);
}
.csg-groupbar__spacer {
  flex: 1;
}
.csg-groupbar__select {
  height: 24px;
  border: 1px dashed var(--csg-border);
  border-radius: 12px;
  padding: 0 6px;
  background: transparent;
  color: var(--csg-text-muted);
  font: inherit;
  cursor: pointer;
}
.csg-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 4px 0 10px;
  border: 1px solid var(--csg-accent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--csg-accent) 12%, var(--csg-bg));
  color: var(--csg-text);
  cursor: grab;
  user-select: none;
}
.csg-chip__x {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--csg-text-muted);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.csg-chip__x:hover {
  background: var(--csg-accent);
  color: var(--csg-accent-text);
}
.csg-link-btn {
  padding: 2px 4px;
  border: 0;
  background: none;
  color: var(--csg-accent);
  font: inherit;
  cursor: pointer;
}
.csg-link-btn:hover {
  text-decoration: underline;
}
</style>
