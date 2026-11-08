<script setup lang="ts">
import { computed } from 'vue'
import type { DetailMode, DetailTab, GridMessages, LogRecord } from '../types'
import { DEFAULT_MESSAGES } from '../messages'
import { getValueByPath, type FilterOp } from '../utils/query'
import { HighlightText } from '../utils/highlight'
import PayloadViewer from './PayloadViewer.vue'

const props = withDefaults(
  defineProps<{
    row: LogRecord
    /** payload 후보 필드 (먼저 존재하는 필드 사용) */
    payloadField?: string | string[]
    /** payload 인코딩이 들어있는 필드 (base64 / hex / text) */
    payloadEncodingField?: string
    highlight?: RegExp | null
    messages?: GridMessages
    /** v-model:tab */
    tab?: DetailTab
    /** 표시 모드 (팝업 전환 버튼 아이콘 결정) — 미지정 시 버튼 숨김 */
    mode?: DetailMode
  }>(),
  {
    payloadField: () => ['payload', '_raw'],
    payloadEncodingField: 'payload_encoding',
    highlight: null,
    messages: () => DEFAULT_MESSAGES,
    tab: 'fields',
    mode: undefined,
  },
)

const emit = defineEmits<{
  close: []
  filter: [field: string, op: FilterOp, value: unknown]
  'update:tab': [tab: DetailTab]
  'toggle-mode': []
}>()

const MAX_CELL = 400

const payloadKey = computed(() => {
  const list = Array.isArray(props.payloadField) ? props.payloadField : [props.payloadField]
  return list.find((f) => {
    const v = getValueByPath(props.row, f)
    return v != null && v !== ''
  })
})
const payloadValue = computed(() => (payloadKey.value ? getValueByPath(props.row, payloadKey.value) : undefined))
const payloadEncoding = computed(() => {
  const v = getValueByPath(props.row, props.payloadEncodingField)
  return v == null ? null : String(v)
})

const activeTab = computed<DetailTab>(() => (props.tab === 'payload' && !payloadKey.value ? 'fields' : props.tab))

function flatten(obj: unknown, prefix = '', out: [string, unknown][] = []): [string, unknown][] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v) && path !== payloadKey.value) flatten(v, path, out)
      else out.push([path, v])
    }
  }
  return out
}
const fields = computed(() => flatten(props.row))
const json = computed(() => JSON.stringify(props.row, null, 2))

function toText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
function display(v: unknown): string {
  const t = toText(v)
  return t.length > MAX_CELL ? `${t.slice(0, MAX_CELL)}…` : t
}

const tabs = computed(() => {
  const out: { id: DetailTab; label: string }[] = [{ id: 'fields', label: props.messages.fields }]
  if (payloadKey.value) out.push({ id: 'payload', label: props.messages.payload })
  out.push({ id: 'json', label: props.messages.raw })
  return out
})
</script>

<template>
  <div class="csg-detail">
    <header class="csg-detail__header">
      <strong class="csg-detail__title">{{ messages.detail }}</strong>
      <div class="csg-tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="tab"
          class="csg-tabs__btn"
          :class="{ 'csg-tabs__btn--on': activeTab === t.id }"
          :aria-selected="activeTab === t.id"
          @click="emit('update:tab', t.id)"
        >
          {{ t.label }}
        </button>
      </div>
      <span class="csg-detail__spacer" />
      <button
        v-if="mode"
        type="button"
        class="csg-icon-btn csg-detail__mode"
        :aria-label="mode === 'side' ? messages.popout : messages.dock"
        :title="mode === 'side' ? messages.popout : messages.dock"
        @click="emit('toggle-mode')"
      >
        {{ mode === 'side' ? '⤢' : '⇥' }}
      </button>
      <button type="button" class="csg-icon-btn" :aria-label="messages.close" :title="messages.close" @click="emit('close')">
        ✕
      </button>
    </header>

    <div v-if="activeTab === 'fields'" class="csg-detail__scroll">
      <table class="csg-detail__table">
        <tbody>
          <tr v-for="[path, value] in fields" :key="path">
            <th scope="row">{{ path }}</th>
            <td>
              <template v-if="path === payloadKey">
                <span class="csg-detail__muted">{{ display(value).slice(0, 80) }}…</span>
                <button type="button" class="csg-link-btn" @click="emit('update:tab', 'payload')">
                  {{ messages.viewPayload }}
                </button>
              </template>
              <HighlightText v-else :text="display(value)" :re="highlight" />
            </td>
            <td class="csg-detail__actions">
              <template v-if="path !== payloadKey">
                <button type="button" class="csg-icon-btn" :title="messages.include" @click="emit('filter', path, '=', value)">+</button>
                <button type="button" class="csg-icon-btn" :title="messages.exclude" @click="emit('filter', path, '!=', value)">−</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PayloadViewer
      v-else-if="activeTab === 'payload'"
      :value="payloadValue"
      :encoding="payloadEncoding"
      :messages="messages"
    />

    <pre v-else class="csg-detail__raw">{{ json }}</pre>
  </div>
</template>

<style>
.csg-detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--csg-bg);
}
.csg-detail__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--csg-border);
  background: var(--csg-header-bg);
}
.csg-detail__title {
  white-space: nowrap;
}
.csg-detail__spacer {
  flex: 1;
}
.csg-tabs {
  display: inline-flex;
  gap: 2px;
}
.csg-tabs__btn {
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--csg-text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.csg-tabs__btn:hover {
  color: var(--csg-text);
}
.csg-tabs__btn--on {
  border-bottom-color: var(--csg-accent);
  color: var(--csg-accent);
  font-weight: 600;
}
.csg-detail__scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.csg-detail__raw {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: var(--csg-font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.csg-detail__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.csg-detail__table th,
.csg-detail__table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--csg-border);
  text-align: left;
  vertical-align: top;
}
.csg-detail__table th {
  width: 32%;
  color: var(--csg-text-muted);
  font-weight: 500;
  word-break: break-all;
}
.csg-detail__table td {
  font-family: var(--csg-font-mono);
  word-break: break-all;
}
.csg-detail__muted {
  color: var(--csg-text-muted);
}
.csg-detail__actions {
  width: 56px;
  white-space: nowrap;
}
</style>
