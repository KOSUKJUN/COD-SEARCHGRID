<script setup lang="ts">
import { computed } from 'vue'
import type { GridMessages } from '../types'
import { DEFAULT_MESSAGES } from '../messages'
import type { FloatWin, WinGeometry } from '../composables/useWindows'

/** 그리드 내부 플로팅 창 — 제목줄 드래그 이동, 가장자리 크기 조절, 최소화/최대화 */
const props = withDefaults(
  defineProps<{
    win: FloatWin
    active?: boolean
    messages?: GridMessages
  }>(),
  { active: false, messages: () => DEFAULT_MESSAGES },
)
const emit = defineEmits<{
  focus: []
  close: []
  minimize: []
  maximize: []
  update: [g: WinGeometry]
}>()

const MIN_W = 320
const MIN_H = 200

const style = computed(() =>
  props.win.maximized
    ? { left: '8px', top: '8px', width: 'calc(100vw - 16px)', height: 'calc(100vh - 64px)', zIndex: 940 + props.win.order }
    : {
        left: `${props.win.x}px`,
        top: `${props.win.y}px`,
        width: `${props.win.w}px`,
        height: `${props.win.h}px`,
        zIndex: 940 + props.win.order,
      },
)

type Edge = 'move' | 'e' | 's' | 'se' | 'w' | 'sw'

function onPointerDown(e: PointerEvent, edge: Edge) {
  if (e.button !== 0) return
  if (edge === 'move' && (e.target as HTMLElement).closest('button, input, select')) return
  emit('focus')
  if (props.win.maximized) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture?.(e.pointerId)
  const sx = e.clientX
  const sy = e.clientY
  const { x, y, w, h } = props.win
  const vw = window.innerWidth
  const vh = window.innerHeight
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx
    const dy = ev.clientY - sy
    const g: WinGeometry = {}
    if (edge === 'move') {
      g.x = Math.min(vw - 80, Math.max(80 - w, x + dx))
      g.y = Math.min(vh - 36, Math.max(0, y + dy))
    }
    if (edge === 'e' || edge === 'se') g.w = Math.max(MIN_W, Math.min(vw - x, w + dx))
    if (edge === 's' || edge === 'se' || edge === 'sw') g.h = Math.max(MIN_H, Math.min(vh - y, h + dy))
    if (edge === 'w' || edge === 'sw') {
      const nw = Math.max(MIN_W, w - dx)
      g.w = nw
      g.x = x + (w - nw)
    }
    emit('update', g)
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}

/** 키보드로 이동/크기 조절: Alt+방향키 이동, Alt+Shift+방향키 크기 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (!e.altKey || props.win.maximized) return
  const step = 24
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
  if (!d) return
  e.preventDefault()
  if (e.shiftKey) emit('update', { w: Math.max(MIN_W, props.win.w + d[0]), h: Math.max(MIN_H, props.win.h + d[1]) })
  else emit('update', { x: props.win.x + d[0], y: Math.max(0, props.win.y + d[1]) })
}
</script>

<template>
  <section
    v-show="!win.minimized"
    class="csg-win"
    :class="{ 'csg-win--active': active, 'csg-win--max': win.maximized }"
    :style="style"
    role="dialog"
    aria-modal="false"
    :aria-label="win.title"
    tabindex="-1"
    @pointerdown="emit('focus')"
    @keydown="onKeydown"
  >
    <header class="csg-win__bar" @pointerdown="onPointerDown($event, 'move')" @dblclick="emit('maximize')">
      <span class="csg-win__icon" aria-hidden="true">{{ win.kind === 'diff' ? '⇄' : '⧉' }}</span>
      <strong class="csg-win__title" :title="win.title">{{ win.title }}</strong>
      <slot name="actions" />
      <button type="button" class="csg-win__btn" :aria-label="messages.minimize" :title="messages.minimize" @click="emit('minimize')">
        –
      </button>
      <button
        type="button"
        class="csg-win__btn"
        :aria-label="win.maximized ? messages.restore : messages.maximize"
        :title="win.maximized ? messages.restore : messages.maximize"
        @click="emit('maximize')"
      >
        {{ win.maximized ? '❐' : '□' }}
      </button>
      <button type="button" class="csg-win__btn csg-win__btn--close" :aria-label="messages.close" :title="messages.close" @click="emit('close')">
        ✕
      </button>
    </header>
    <div class="csg-win__body">
      <slot />
    </div>
    <template v-if="!win.maximized">
      <span class="csg-win__rs csg-win__rs--e" aria-hidden="true" @pointerdown="onPointerDown($event, 'e')" />
      <span class="csg-win__rs csg-win__rs--w" aria-hidden="true" @pointerdown="onPointerDown($event, 'w')" />
      <span class="csg-win__rs csg-win__rs--s" aria-hidden="true" @pointerdown="onPointerDown($event, 's')" />
      <span class="csg-win__rs csg-win__rs--se" aria-hidden="true" @pointerdown="onPointerDown($event, 'se')" />
      <span class="csg-win__rs csg-win__rs--sw" aria-hidden="true" @pointerdown="onPointerDown($event, 'sw')" />
    </template>
  </section>
</template>
