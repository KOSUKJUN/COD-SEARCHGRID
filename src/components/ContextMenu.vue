<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { MenuItem } from '../types'
import { useDismiss } from '../composables/useDismiss'

const props = defineProps<{ items: MenuItem[]; x: number; y: number }>()
const emit = defineEmits<{ close: [] }>()

const el = ref<HTMLElement | null>(null)
const pos = ref({ left: props.x, top: props.y })
const open = ref(true)

// 연속 separator / 앞뒤 separator 정리
const items = computed(() => {
  const out: MenuItem[] = []
  for (const it of props.items) {
    if (it.separator && (!out.length || out[out.length - 1].separator)) continue
    out.push(it)
  }
  while (out.length && out[out.length - 1].separator) out.pop()
  return out
})

function buttons(): HTMLButtonElement[] {
  return Array.from(el.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
}

function onKey(e: KeyboardEvent) {
  const list = buttons()
  const idx = list.indexOf(document.activeElement as HTMLButtonElement)
  if (e.key === 'ArrowDown') list[(idx + 1) % list.length]?.focus()
  else if (e.key === 'ArrowUp') list[(idx - 1 + list.length) % list.length]?.focus()
  else if (e.key === 'Home') list[0]?.focus()
  else if (e.key === 'End') list[list.length - 1]?.focus()
  else if (e.key === 'Tab') emit('close')
  else return
  e.preventDefault()
}

function run(it: MenuItem) {
  if (it.disabled) return
  emit('close')
  it.action?.()
}

const close = () => emit('close')
useDismiss(open, () => [el.value], close)

onMounted(() => {
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
  nextTick(() => {
    const r = el.value?.getBoundingClientRect()
    if (r) {
      const left = Math.min(props.x, window.innerWidth - r.width - 8)
      const top = props.y + r.height > window.innerHeight - 8 ? Math.max(8, props.y - r.height) : props.y
      pos.value = { left: Math.max(8, left), top }
    }
    buttons()[0]?.focus()
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
})
</script>

<template>
  <div
    ref="el"
    class="csg-menu"
    role="menu"
    :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
    @keydown="onKey"
    @contextmenu.prevent
  >
    <template v-for="(it, i) in items" :key="i">
      <div v-if="it.separator" class="csg-menu__sep" role="separator" />
      <button
        v-else
        type="button"
        class="csg-menu__item"
        :class="{ 'csg-menu__item--danger': it.danger }"
        role="menuitem"
        :disabled="it.disabled"
        @click="run(it)"
      >
        <span class="csg-menu__label">{{ it.label }}</span>
        <span v-if="it.shortcut" class="csg-menu__shortcut">{{ it.shortcut }}</span>
      </button>
    </template>
  </div>
</template>
