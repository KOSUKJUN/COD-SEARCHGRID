<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { GridMessages } from '../types'
import { DEFAULT_MESSAGES } from '../messages'
import { analyzePayload, formatBytes, hexDump, type PayloadView } from '../utils/payload'

const props = withDefaults(
  defineProps<{
    value: unknown
    /** 'base64' | 'hex' | 'text' — 미지정 시 자동 판별 */
    encoding?: string | null
    messages?: GridMessages
    /** hex dump 최대 바이트 */
    maxHexBytes?: number
  }>(),
  { encoding: null, messages: () => DEFAULT_MESSAGES, maxHexBytes: 64 * 1024 },
)

const info = computed(() => analyzePayload(props.value, props.encoding))
const view = ref<PayloadView>('text')
const wrap = ref(true)
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

watch(
  info,
  (i) => {
    if (i) view.value = i.defaultView
  },
  { immediate: true },
)

const views = computed(() => {
  const i = info.value
  if (!i) return []
  const out: { id: PayloadView; label: string }[] = [{ id: 'text', label: 'Text' }]
  if (i.json) out.push({ id: 'json', label: 'JSON' })
  out.push({ id: 'hex', label: 'Hex' })
  return out
})

const hex = computed(() => (info.value && view.value === 'hex' ? hexDump(info.value.bytes, props.maxHexBytes) : null))
const content = computed(() => {
  const i = info.value
  if (!i) return ''
  if (view.value === 'json') return i.json ?? i.text
  if (view.value === 'hex') return hex.value?.text ?? ''
  return i.text
})

async function copy() {
  try {
    await navigator.clipboard?.writeText(content.value)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* clipboard 권한 없음 */
  }
}
onBeforeUnmount(() => clearTimeout(copiedTimer))
</script>

<template>
  <div class="csg-payload">
    <div v-if="!info" class="csg-payload__empty">{{ messages.noPayload }}</div>
    <template v-else>
      <div class="csg-payload__bar">
        <div class="csg-seg" role="tablist">
          <button
            v-for="v in views"
            :key="v.id"
            type="button"
            role="tab"
            class="csg-seg__btn"
            :class="{ 'csg-seg__btn--on': view === v.id }"
            :aria-selected="view === v.id"
            @click="view = v.id"
          >
            {{ v.label }}
          </button>
        </div>
        <span class="csg-payload__meta">{{ info.encoding }} · {{ formatBytes(info.size) }}</span>
        <span class="csg-payload__spacer" />
        <label v-if="view !== 'hex'" class="csg-payload__wrap">
          <input v-model="wrap" type="checkbox" />
          {{ messages.wrap }}
        </label>
        <slot name="actions" />
        <button type="button" class="csg-btn csg-btn--sm" @click="copy">
          {{ copied ? messages.copied : messages.copy }}
        </button>
      </div>
      <div v-if="hex?.truncated" class="csg-payload__note">{{ messages.truncated }}</div>
      <pre
        class="csg-payload__body"
        :class="{ 'csg-payload__body--nowrap': !wrap || view === 'hex', [`csg-payload__body--${view}`]: true }"
        >{{ content }}</pre
      >
    </template>
  </div>
</template>

<style>
.csg-payload {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.csg-payload__empty {
  padding: 24px 12px;
  color: var(--csg-text-muted);
  text-align: center;
}
.csg-payload__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--csg-border);
  font-size: 12px;
}
.csg-payload__meta {
  color: var(--csg-text-muted);
  white-space: nowrap;
}
.csg-payload__bar > * {
  flex: none;
}
.csg-payload__bar > .csg-payload__spacer {
  flex: 1;
}
.csg-payload__spacer {
  flex: 1;
}
.csg-payload__wrap {
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--csg-text-muted);
  cursor: pointer;
}
.csg-payload__note {
  padding: 4px 10px;
  color: var(--csg-sev-high);
  font-size: 11px;
}
.csg-payload__body {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: var(--csg-font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  tab-size: 2;
}
.csg-payload__body--nowrap {
  white-space: pre;
  word-break: normal;
}
.csg-payload__body--hex {
  font-size: 11.5px;
}
.csg-seg {
  display: inline-flex;
  border: 1px solid var(--csg-border);
  border-radius: 4px;
  overflow: hidden;
}
.csg-seg__btn {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-right: 1px solid var(--csg-border);
  background: var(--csg-bg);
  color: var(--csg-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.csg-seg__btn:last-child {
  border-right: 0;
}
.csg-seg__btn--on {
  background: var(--csg-accent);
  color: var(--csg-accent-text);
}
.csg-btn--sm {
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
}
</style>
