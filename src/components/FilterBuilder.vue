<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GridMessages } from '../types'
import { DEFAULT_MESSAGES } from '../messages'
import { conditionsToQuery, queryToConditions, type ConditionOp } from '../utils/query'

interface Row {
  id: number
  field: string
  op: ConditionOp
  value: string
}

const props = withDefaults(
  defineProps<{
    query: string
    fields: { field: string; label?: string }[]
    messages?: GridMessages
    suggestValues?: (field: string, prefix: string) => Promise<string[]> | string[]
  }>(),
  { messages: () => DEFAULT_MESSAGES, suggestValues: undefined },
)
const emit = defineEmits<{ apply: [query: string]; close: [] }>()

let nextId = 1
const rows = ref<Row[]>([])
const valueOptions = ref<Record<string, string[]>>({})
const uid = Math.random().toString(36).slice(2, 8)

function init(q: string) {
  const conds = queryToConditions(q)
  rows.value = conds.length ? conds.map((c) => ({ id: nextId++, ...c })) : [blank()]
  rows.value.forEach((r) => loadValues(r.field))
}
function blank(): Row {
  return { id: nextId++, field: props.fields[0]?.field ?? '', op: '=', value: '' }
}
watch(() => props.query, init, { immediate: true })

const fieldOps = computed<{ op: ConditionOp; label: string }[]>(() => [
  { op: '=', label: '=' },
  { op: '!=', label: '≠' },
  { op: 'contains', label: props.messages.opContains },
  { op: 'not_contains', label: props.messages.opNotContains },
  { op: '>', label: '>' },
  { op: '>=', label: '≥' },
  { op: '<', label: '<' },
  { op: '<=', label: '≤' },
  { op: 'exists', label: props.messages.opExists },
  { op: 'not_exists', label: props.messages.opNotExists },
])
const textOps = computed<{ op: ConditionOp; label: string }[]>(() => [
  { op: 'text', label: props.messages.opText },
  { op: 'not_text', label: props.messages.opNotText },
])

function onFieldChange(r: Row) {
  if (!r.field && r.op !== 'text' && r.op !== 'not_text') r.op = 'text'
  else if (r.field && (r.op === 'text' || r.op === 'not_text')) r.op = r.op === 'text' ? '=' : '!='
  loadValues(r.field)
}

async function loadValues(field: string) {
  if (!field || !props.suggestValues || valueOptions.value[field]) return
  try {
    const vals = await props.suggestValues(field, '')
    valueOptions.value = { ...valueOptions.value, [field]: vals.slice(0, 50) }
  } catch {
    /* 무시 */
  }
}

const needsValue = (op: ConditionOp) => op !== 'exists' && op !== 'not_exists'
const preview = computed(() => conditionsToQuery(rows.value))

function remove(id: number) {
  rows.value = rows.value.filter((r) => r.id !== id)
  if (!rows.value.length) rows.value = [blank()]
}
</script>

<template>
  <form class="csg-fb" :aria-label="messages.filterTitle" @submit.prevent="emit('apply', preview)">
    <div class="csg-fb__head">
      <strong>{{ messages.filterTitle }}</strong>
      <code class="csg-fb__preview" :title="preview">{{ preview || '—' }}</code>
      <button type="button" class="csg-icon-btn" :aria-label="messages.close" @click="emit('close')">✕</button>
    </div>
    <div v-for="r in rows" :key="r.id" class="csg-fb__row">
      <select v-model="r.field" class="csg-input" :aria-label="messages.columns" @change="onFieldChange(r)">
        <option value="">{{ messages.anyField }}</option>
        <option v-for="f in fields" :key="f.field" :value="f.field">{{ f.label ?? f.field }}</option>
      </select>
      <select v-model="r.op" class="csg-input csg-fb__op" aria-label="operator">
        <option v-for="o in r.field ? fieldOps : textOps" :key="o.op" :value="o.op">{{ o.label }}</option>
      </select>
      <template v-if="needsValue(r.op)">
        <input
          v-model="r.value"
          class="csg-input csg-fb__value"
          :placeholder="messages.value"
          :aria-label="messages.value"
          :list="r.field ? `csg-fb-${uid}-${r.field}` : undefined"
          @focus="loadValues(r.field)"
        />
        <datalist v-if="r.field" :id="`csg-fb-${uid}-${r.field}`">
          <option v-for="v in valueOptions[r.field] ?? []" :key="v" :value="v" />
        </datalist>
      </template>
      <span v-else class="csg-fb__value" />
      <button type="button" class="csg-icon-btn" :aria-label="`${messages.close}`" @click="remove(r.id)">−</button>
    </div>
    <div class="csg-fb__foot">
      <button type="button" class="csg-link-btn" @click="rows.push(blank())">{{ messages.addCondition }}</button>
      <span class="csg-status__spacer" />
      <button type="button" class="csg-btn csg-btn--sm" @click="rows = [blank()]">{{ messages.clear }}</button>
      <button type="submit" class="csg-btn csg-btn--sm csg-btn--primary">{{ messages.apply }}</button>
    </div>
  </form>
</template>
