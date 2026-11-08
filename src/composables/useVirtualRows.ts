import { computed, ref, type Ref } from 'vue'

/**
 * 가상 스크롤 (고정 높이 + 가변 높이 모드).
 * 가변 모드에서는 렌더링된 행([data-vkey])의 실제 높이를 측정해 key 별로 캐시하고
 * prefix-sum offset 으로 위치를 계산한다.
 */
export function useVirtualRows(opts: {
  count: () => number
  keyAt: (i: number) => string
  variable: () => boolean
  rowHeight: () => number
  overscan: () => number
  scrollTop: Ref<number>
  viewportH: Ref<number>
}) {
  const cache = new Map<string, number>()
  const version = ref(0)

  const offsets = computed<Float64Array | null>(() => {
    if (!opts.variable()) return null
    void version.value
    const n = opts.count()
    const rh = opts.rowHeight()
    const arr = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) arr[i + 1] = arr[i] + (cache.get(opts.keyAt(i)) ?? rh)
    return arr
  })

  function offsetOf(i: number): number {
    const o = offsets.value
    return o ? o[Math.min(i, o.length - 1)] : i * opts.rowHeight()
  }

  function heightOf(i: number): number {
    return offsetOf(i + 1) - offsetOf(i)
  }

  const totalHeight = computed(() => {
    const o = offsets.value
    return o ? o[o.length - 1] : opts.count() * opts.rowHeight()
  })

  /** offset 이 y 이하인 마지막 인덱스 */
  function indexAt(y: number): number {
    const o = offsets.value
    const n = opts.count()
    if (!o) return Math.min(n, Math.max(0, Math.floor(y / opts.rowHeight())))
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (o[mid] <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  const range = computed(() => {
    const n = opts.count()
    const top = opts.scrollTop.value
    const ov = opts.overscan()
    const start = Math.max(0, indexAt(top) - ov)
    const end = Math.min(n, indexAt(top + opts.viewportH.value) + 1 + ov)
    return { start, end }
  })

  /** 렌더링된 행 높이 측정 → 변경 시 offset 재계산 */
  function measure(container: HTMLElement | null) {
    if (!container || !opts.variable()) return
    let changed = false
    container.querySelectorAll<HTMLElement>('[data-vkey]').forEach((el) => {
      const h = el.offsetHeight
      const k = el.dataset.vkey as string
      if (h > 0 && cache.get(k) !== h) {
        cache.set(k, h)
        changed = true
      }
    })
    if (changed) version.value++
  }

  function reset() {
    cache.clear()
    version.value++
  }

  return { offsetOf, heightOf, totalHeight, range, indexAt, measure, reset }
}
