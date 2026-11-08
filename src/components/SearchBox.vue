<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Bookmark, GridMessages } from '../types'
import { DEFAULT_MESSAGES } from '../messages'
import { FIELD_TOKEN_RE, rankByPrefix, tokenAt } from '../utils/suggest'

interface Suggestion {
  kind: 'field' | 'value' | 'keyword' | 'history' | 'bookmark'
  label: string
  detail?: string
  /** 토큰 치환 텍스트 (history/bookmark 는 전체 치환) */
  text: string
  /** 선택 후 바로 검색 실행 */
  submit?: boolean
  bookmark?: Bookmark
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    fields: { field: string; label?: string }[]
    history?: string[]
    bookmarks?: Bookmark[]
    suggestValues?: (field: string, prefix: string) => Promise<string[]> | string[]
    messages?: GridMessages
    autocomplete?: boolean
  }>(),
  { history: () => [], bookmarks: () => [], suggestValues: undefined, messages: () => DEFAULT_MESSAGES, autocomplete: true },
)

const emit = defineEmits<{
  'update:modelValue': [v: string]
  submit: []
  'apply-bookmark': [b: Bookmark]
}>()

const input = ref<HTMLInputElement | null>(null)
const open = ref(false)
const items = ref<Suggestion[]>([])
const active = ref(-1)
const listId = `csg-ac-${Math.random().toString(36).slice(2, 8)}`
let seq = 0
let range = { start: 0, end: 0 }

const quote = (v: string) => (/[\s"]/.test(v) || v === '' ? `"${v.replace(/"/g, '')}"` : v)

async function compute() {
  if (!props.autocomplete) return
  const el = input.value
  if (!el) return
  const value = props.modelValue
  const caret = el.selectionStart ?? value.length
  const id = ++seq
  const tk = tokenAt(value, caret)
  range = { start: tk.start, end: tk.end }
  const out: Suggestion[] = []

  if (!value.trim()) {
    for (const b of props.bookmarks.slice(0, 5))
      out.push({ kind: 'bookmark', label: b.name, detail: b.query, text: b.query, submit: true, bookmark: b })
    for (const h of props.history.slice(0, 8)) out.push({ kind: 'history', label: h, text: h, submit: true })
  } else {
    const m = FIELD_TOKEN_RE.exec(tk.token)
    if (m && props.suggestValues) {
      const [, field, op, raw] = m
      const prefix = raw.replace(/^"/, '').replace(/"$/, '')
      let values: string[] = []
      try {
        values = await props.suggestValues(field, prefix)
      } catch {
        values = []
      }
      if (id !== seq) return
      for (const v of values) {
        const text = `${field}${op}${quote(v)}`
        if (text !== tk.token) out.push({ kind: 'value', label: v, detail: field, text: `${text} ` })
      }
    } else if (tk.token && !m) {
      const t = tk.token.replace(/^"/, '')
      const names = rankByPrefix(
        props.fields.map((f) => f.field),
        t,
        8,
      )
      for (const f of names) {
        if (f === t) continue
        const label = props.fields.find((x) => x.field === f)?.label
        out.push({ kind: 'field', label: f, detail: label && label !== f ? label : undefined, text: `${f}=` })
      }
      if ('NOT'.startsWith(t.toUpperCase()) && t.toUpperCase() !== 'NOT')
        out.push({ kind: 'keyword', label: 'NOT', detail: 'exclude', text: 'NOT ' })
      for (const h of props.history.filter((h) => h.toLowerCase().includes(value.trim().toLowerCase()) && h !== value).slice(0, 3))
        out.push({ kind: 'history', label: h, text: h, submit: true })
    }
  }
  if (id !== seq) return
  items.value = out
  active.value = -1
  open.value = out.length > 0 && document.activeElement === el
}

function apply(s: Suggestion) {
  if (s.bookmark) {
    emit('apply-bookmark', s.bookmark)
    close()
    return
  }
  let next: string
  let caret: number
  if (s.kind === 'history') {
    next = s.text
    caret = next.length
  } else {
    const v = props.modelValue
    next = v.slice(0, range.start) + s.text + v.slice(range.end)
    caret = range.start + s.text.length
  }
  emit('update:modelValue', next)
  if (s.submit) {
    close()
    nextTick(() => emit('submit'))
    return
  }
  nextTick(() => {
    input.value?.setSelectionRange(caret, caret)
    compute()
  })
}

function close() {
  open.value = false
  active.value = -1
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) {
    if (e.key === 'ArrowDown' && props.autocomplete) {
      compute()
      e.preventDefault()
    }
    return
  }
  const n = items.value.length
  if (e.key === 'ArrowDown') active.value = (active.value + 1) % n
  else if (e.key === 'ArrowUp') active.value = (active.value - 1 + n) % n
  else if ((e.key === 'Enter' || e.key === 'Tab') && active.value >= 0) apply(items.value[active.value])
  else if (e.key === 'Escape') {
    close()
    e.stopPropagation()
  } else return
  e.preventDefault()
}

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
  nextTick(compute)
}

const kindLabel = computed(() => ({
  field: props.messages.suggestFields,
  value: props.messages.suggestValues,
  keyword: 'keyword',
  history: props.messages.recent,
  bookmark: props.messages.bookmarks,
}))

defineExpose({ focus: () => input.value?.focus(), close })
</script>

<template>
  <div class="csg-search">
    <svg class="csg-search__icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    <input
      ref="input"
      :value="modelValue"
      class="csg-search__input"
      type="search"
      :placeholder="messages.placeholder"
      spellcheck="false"
      autocomplete="off"
      role="combobox"
      :aria-label="messages.search"
      :aria-expanded="open"
      :aria-controls="listId"
      aria-autocomplete="list"
      :aria-activedescendant="active >= 0 ? `${listId}-${active}` : undefined"
      @input="onInput"
      @focus="compute"
      @click="compute"
      @blur="close"
      @keydown="onKeydown"
    />
    <ul v-if="open" :id="listId" class="csg-ac" role="listbox" @mousedown.prevent>
      <li
        v-for="(s, i) in items"
        :id="`${listId}-${i}`"
        :key="`${s.kind}:${s.text}`"
        class="csg-ac__item"
        :class="{ 'csg-ac__item--on': i === active }"
        role="option"
        :aria-selected="i === active"
        @click="apply(s)"
        @mouseenter="active = i"
      >
        <span class="csg-ac__kind" :class="`csg-ac__kind--${s.kind}`">{{ kindLabel[s.kind] }}</span>
        <span class="csg-ac__label">{{ s.label }}</span>
        <span v-if="s.detail" class="csg-ac__detail">{{ s.detail }}</span>
      </li>
    </ul>
  </div>
</template>
