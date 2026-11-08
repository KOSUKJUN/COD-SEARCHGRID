<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useDismiss } from '../composables/useDismiss'

const props = withDefaults(
  defineProps<{
    label: string
    title?: string
    /** 버튼 강조 (필터 적용 중 등) */
    active?: boolean
    align?: 'left' | 'right'
    panelClass?: string
  }>(),
  { title: undefined, active: false, align: 'right', panelClass: '' },
)
const emit = defineEmits<{ open: []; close: [] }>()

const open = ref(false)
const btn = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const pos = ref<Record<string, string>>({})

function show() {
  const r = btn.value?.getBoundingClientRect()
  const top = `${(r?.bottom ?? 0) + 4}px`
  pos.value =
    props.align === 'left'
      ? { top, left: `${r?.left ?? 0}px` }
      : { top, right: `${Math.max(8, window.innerWidth - (r?.right ?? 0))}px` }
  open.value = true
  emit('open')
  nextTick(() => panel.value?.querySelector<HTMLElement>('input, button, [tabindex]')?.focus())
}
function close() {
  if (!open.value) return
  open.value = false
  emit('close')
}
function toggle() {
  if (open.value) close()
  else show()
}

useDismiss(open, () => [btn.value, panel.value], close)
defineExpose({ close, show })
</script>

<template>
  <div class="csg-dd">
    <button
      ref="btn"
      type="button"
      class="csg-btn"
      :class="{ 'csg-btn--active': open || active }"
      aria-haspopup="true"
      :aria-expanded="open"
      :title="title"
      @click="toggle"
    >
      <slot name="label">{{ label }}</slot>
      <span class="csg-dd__caret" aria-hidden="true">▾</span>
    </button>
    <div v-if="open" ref="panel" class="csg-dd__panel" :class="panelClass" :style="pos" role="dialog" :aria-label="label">
      <slot :close="close" />
    </div>
  </div>
</template>
