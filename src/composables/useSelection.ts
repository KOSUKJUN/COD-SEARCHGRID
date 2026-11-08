import { computed, shallowRef } from 'vue'
import type { LogRecord } from '../types'

/** 다중 행 선택 (체크박스 / Ctrl+클릭 / Shift+범위) */
export function useSelection(identity: (row: LogRecord) => unknown) {
  const map = shallowRef(new Map<unknown, LogRecord>())

  const size = computed(() => map.value.size)
  const rows = computed(() => [...map.value.values()])

  const isSelected = (row: LogRecord) => map.value.has(identity(row))

  function commit(next: Map<unknown, LogRecord>) {
    map.value = next
  }

  function toggle(row: LogRecord, on?: boolean) {
    const next = new Map(map.value)
    const k = identity(row)
    const want = on ?? !next.has(k)
    if (want) next.set(k, row)
    else next.delete(k)
    commit(next)
  }

  /** additive=false 면 기존 선택을 대체 */
  function setRows(list: readonly LogRecord[], additive = false) {
    const next = additive ? new Map(map.value) : new Map<unknown, LogRecord>()
    for (const r of list) next.set(identity(r), r)
    commit(next)
  }

  function removeRows(list: readonly LogRecord[]) {
    const next = new Map(map.value)
    for (const r of list) next.delete(identity(r))
    commit(next)
  }

  function clear() {
    if (map.value.size) commit(new Map())
  }

  return { size, rows, isSelected, toggle, setRows, removeRows, clear }
}
