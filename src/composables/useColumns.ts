import { computed, ref, watch } from 'vue'
import type { ColumnState, GridColumn } from '../types'

export interface ColumnLayout {
  col: GridColumn
  width: number
  frozen: boolean
  /** sticky left offset (frozen 일 때) */
  left?: number
  lastFrozen: boolean
}

/**
 * 컬럼 순서 / 표시 여부 / 폭 / 좌측 고정 상태 관리.
 * @param leadWidth 체크박스·행번호 등 항상 고정되는 앞쪽 컬럼 폭 합
 */
export function useColumns(columns: () => GridColumn[], leadWidth: () => number) {
  const order = ref<string[]>([])
  const hidden = ref<Set<string>>(new Set())
  const frozen = ref<Set<string>>(new Set())
  const widths = ref<Record<string, number>>({})
  const known = new Set<string>()

  const defs = computed(() => new Map(columns().map((c) => [c.field, c])))

  watch(
    columns,
    (cols) => {
      const fields = cols.map((c) => c.field)
      const nextHidden = new Set([...hidden.value].filter((f) => fields.includes(f)))
      const nextFrozen = new Set([...frozen.value].filter((f) => fields.includes(f)))
      const nextWidths: Record<string, number> = {}
      for (const c of cols) {
        nextWidths[c.field] = widths.value[c.field] ?? c.width ?? 160
        if (!known.has(c.field)) {
          known.add(c.field)
          if (c.hidden) nextHidden.add(c.field)
          if (c.frozen) nextFrozen.add(c.field)
        }
      }
      order.value = [...order.value.filter((f) => fields.includes(f)), ...fields.filter((f) => !order.value.includes(f))]
      hidden.value = nextHidden
      frozen.value = nextFrozen
      widths.value = nextWidths
    },
    { immediate: true, deep: true },
  )

  /** 화면에 표시되는 컬럼 (고정 컬럼이 앞) */
  const visible = computed<GridColumn[]>(() => {
    const list = order.value.map((f) => defs.value.get(f)).filter((c): c is GridColumn => !!c && !hidden.value.has(c.field))
    return [...list.filter((c) => frozen.value.has(c.field)), ...list.filter((c) => !frozen.value.has(c.field))]
  })

  /** 설정 메뉴용: 전체 컬럼 (현재 순서) */
  const ordered = computed<GridColumn[]>(() =>
    order.value.map((f) => defs.value.get(f)).filter((c): c is GridColumn => !!c),
  )

  const layout = computed<ColumnLayout[]>(() => {
    let left = leadWidth()
    const out = visible.value.map((col) => {
      const width = widths.value[col.field] ?? 160
      const isFrozen = frozen.value.has(col.field)
      const item: ColumnLayout = { col, width, frozen: isFrozen, left: isFrozen ? left : undefined, lastFrozen: false }
      if (isFrozen) left += width
      return item
    })
    const lastIdx = out.map((c) => c.frozen).lastIndexOf(true)
    if (lastIdx >= 0) out[lastIdx].lastFrozen = true
    return out
  })

  const dataWidth = computed(() => layout.value.reduce((a, c) => a + c.width, 0))

  function setWidth(field: string, w: number) {
    widths.value = { ...widths.value, [field]: w }
  }

  /** field 를 before 앞으로 이동 (before 가 없으면 맨 뒤) */
  function move(field: string, before?: string) {
    if (field === before) return
    const next = order.value.filter((f) => f !== field)
    const idx = before ? next.indexOf(before) : -1
    next.splice(idx < 0 ? next.length : idx, 0, field)
    order.value = next
  }

  function setHidden(field: string, h: boolean) {
    const next = new Set(hidden.value)
    if (h) next.add(field)
    else next.delete(field)
    // 최소 1개 컬럼은 표시
    if (next.size >= order.value.length) return
    hidden.value = next
  }

  function showAll() {
    hidden.value = new Set()
  }

  function setFrozen(field: string, f: boolean) {
    const next = new Set(frozen.value)
    if (f) next.add(field)
    else next.delete(field)
    frozen.value = next
  }

  function getState(): ColumnState {
    return {
      order: [...order.value],
      hidden: [...hidden.value],
      frozen: [...frozen.value],
      widths: { ...widths.value },
    }
  }

  function applyState(s: Partial<ColumnState> | undefined) {
    if (!s) return
    const fields = columns().map((c) => c.field)
    if (s.order) order.value = [...s.order.filter((f) => fields.includes(f)), ...fields.filter((f) => !s.order!.includes(f))]
    if (s.hidden) hidden.value = new Set(s.hidden.filter((f) => fields.includes(f)))
    if (s.frozen) frozen.value = new Set(s.frozen.filter((f) => fields.includes(f)))
    if (s.widths) widths.value = { ...widths.value, ...s.widths }
  }

  function reset() {
    const cols = columns()
    order.value = cols.map((c) => c.field)
    hidden.value = new Set(cols.filter((c) => c.hidden).map((c) => c.field))
    frozen.value = new Set(cols.filter((c) => c.frozen).map((c) => c.field))
    widths.value = Object.fromEntries(cols.map((c) => [c.field, c.width ?? 160]))
  }

  return {
    order,
    hidden,
    frozen,
    widths,
    visible,
    ordered,
    layout,
    dataWidth,
    setWidth,
    move,
    setHidden,
    showAll,
    setFrozen,
    getState,
    applyState,
    reset,
  }
}
