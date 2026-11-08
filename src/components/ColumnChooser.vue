<script setup lang="ts">
import { ref } from 'vue'
import type { GridColumn, GridMessages } from '../types'
import { DEFAULT_MESSAGES } from '../messages'

const props = withDefaults(
  defineProps<{
    columns: GridColumn[]
    hidden: Set<string>
    frozen: Set<string>
    messages?: GridMessages
  }>(),
  { messages: () => DEFAULT_MESSAGES },
)
const emit = defineEmits<{
  'set-hidden': [field: string, hidden: boolean]
  'set-frozen': [field: string, frozen: boolean]
  move: [field: string, before?: string]
  'show-all': []
  reset: []
}>()

const dragField = ref<string | null>(null)
const overField = ref<string | null>(null)

function onDrop(target: string) {
  if (dragField.value && dragField.value !== target) emit('move', dragField.value, target)
  dragField.value = overField.value = null
}

function moveBy(field: string, delta: number) {
  const idx = props.columns.findIndex((c) => c.field === field)
  const to = idx + delta
  if (to < 0 || to >= props.columns.length) return
  // 아래로 이동: 한 칸 아래 컬럼의 다음 컬럼 앞
  const before = delta > 0 ? props.columns[to + 1]?.field : props.columns[to].field
  emit('move', field, before)
}
</script>

<template>
  <div class="csg-cc">
    <div class="csg-cc__head">
      <button type="button" class="csg-link-btn" @click="emit('show-all')">{{ messages.showAll }}</button>
      <button type="button" class="csg-link-btn" @click="emit('reset')">{{ messages.resetColumns }}</button>
    </div>
    <ul class="csg-cc__list">
      <li
        v-for="c in columns"
        :key="c.field"
        class="csg-cc__item"
        :class="{ 'csg-cc__item--over': overField === c.field }"
        draggable="true"
        @dragstart="dragField = c.field"
        @dragover.prevent="overField = c.field"
        @dragleave="overField = null"
        @drop.prevent="onDrop(c.field)"
        @dragend="dragField = overField = null"
      >
        <span class="csg-cc__grip" aria-hidden="true">⋮⋮</span>
        <label class="csg-cc__label">
          <input type="checkbox" :checked="!hidden.has(c.field)" @change="emit('set-hidden', c.field, !($event.target as HTMLInputElement).checked)" />
          {{ c.label ?? c.field }}
        </label>
        <button
          type="button"
          class="csg-cc__pin"
          :class="{ 'csg-cc__pin--on': frozen.has(c.field) }"
          :title="frozen.has(c.field) ? messages.unfreeze : messages.freeze"
          :aria-pressed="frozen.has(c.field)"
          @click="emit('set-frozen', c.field, !frozen.has(c.field))"
        >
          📌
        </button>
        <button type="button" class="csg-cc__mv" aria-label="up" @click="moveBy(c.field, -1)">↑</button>
        <button type="button" class="csg-cc__mv" aria-label="down" @click="moveBy(c.field, 1)">↓</button>
      </li>
    </ul>
  </div>
</template>
