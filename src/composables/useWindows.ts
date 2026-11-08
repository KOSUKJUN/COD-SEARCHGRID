import { computed, ref } from 'vue'
import type { LogRecord } from '../types'

export type FloatWinKind = 'payload' | 'diff'

export interface FloatWin {
  id: number
  kind: FloatWinKind
  rows: LogRecord[]
  title: string
  x: number
  y: number
  w: number
  h: number
  /** 쌓임 순서 (1 = 맨 아래) */
  order: number
  minimized: boolean
  maximized: boolean
}

export type WinGeometry = Partial<Pick<FloatWin, 'x' | 'y' | 'w' | 'h'>>

const vw = () => (typeof window === 'undefined' ? 1280 : window.innerWidth)
const vh = () => (typeof window === 'undefined' ? 800 : window.innerHeight)

/** 그리드 내부 플로팅 창(브라우저 새 창 아님) 관리 */
export function useWindows(maxWindows: () => number) {
  const list = ref<FloatWin[]>([])
  let seq = 0

  const activeId = computed(() => {
    const visible = list.value.filter((w) => !w.minimized)
    return visible.length ? visible.reduce((a, b) => (a.order > b.order ? a : b)).id : -1
  })

  function reorder(topId: number) {
    const sorted = [...list.value].sort((a, b) => a.order - b.order)
    const top = sorted.find((w) => w.id === topId)
    const rest = sorted.filter((w) => w.id !== topId)
    ;[...rest, ...(top ? [top] : [])].forEach((w, i) => (w.order = i + 1))
  }

  function find(kind: FloatWinKind, rows: readonly LogRecord[]) {
    return list.value.find((w) => w.kind === kind && w.rows.length === rows.length && w.rows.every((r, i) => r === rows[i]))
  }

  function open(kind: FloatWinKind, rows: LogRecord[], title: string, size?: { w: number; h: number }): FloatWin {
    const existing = find(kind, rows)
    if (existing) {
      existing.minimized = false
      reorder(existing.id)
      return existing
    }
    if (list.value.length >= maxWindows()) {
      // 가장 오래된(맨 아래) 창을 닫는다
      const oldest = [...list.value].sort((a, b) => a.order - b.order)[0]
      close(oldest.id)
    }
    const n = list.value.length
    const w = Math.min(size?.w ?? 640, vw() - 32)
    const h = Math.min(size?.h ?? 480, vh() - 64)
    const step = (n % 8) * 28
    const win: FloatWin = {
      id: ++seq,
      kind,
      rows,
      title,
      x: Math.max(8, Math.min(vw() - w - 8, 120 + step)),
      y: Math.max(8, Math.min(vh() - h - 56, 72 + step)),
      w,
      h,
      order: n + 1,
      minimized: false,
      maximized: false,
    }
    list.value.push(win)
    reorder(win.id)
    return list.value[list.value.length - 1]
  }

  function get(id: number) {
    return list.value.find((w) => w.id === id)
  }

  function focus(id: number) {
    const w = get(id)
    if (!w) return
    w.minimized = false
    reorder(id)
  }

  function close(id: number) {
    list.value = list.value.filter((w) => w.id !== id)
  }

  function closeAll() {
    list.value = []
  }

  function update(id: number, g: WinGeometry) {
    const w = get(id)
    if (w) Object.assign(w, g)
  }

  function toggleMin(id: number) {
    const w = get(id)
    if (!w) return
    w.minimized = !w.minimized
    if (!w.minimized) reorder(id)
  }

  function toggleMax(id: number) {
    const w = get(id)
    if (!w) return
    w.maximized = !w.maximized
    reorder(id)
  }

  /** 보이는 창들을 화면에 격자로 나란히 배치 (작업표시줄 높이 제외) */
  function tile() {
    const wins = [...list.value].filter((w) => !w.minimized).sort((a, b) => a.order - b.order)
    if (!wins.length) return
    const gap = 8
    const top = 8
    const bottom = 56
    const cols = Math.ceil(Math.sqrt(wins.length))
    const rows = Math.ceil(wins.length / cols)
    const cw = (vw() - gap * (cols + 1)) / cols
    const ch = (vh() - top - bottom - gap * (rows - 1)) / rows
    wins.forEach((w, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      Object.assign(w, {
        x: Math.round(gap + c * (cw + gap)),
        y: Math.round(top + r * (ch + gap)),
        w: Math.round(cw),
        h: Math.round(ch),
        maximized: false,
      })
    })
  }

  function cascade() {
    const wins = [...list.value].sort((a, b) => a.order - b.order)
    wins.forEach((w, i) => {
      const step = (i % 10) * 28
      Object.assign(w, {
        x: 80 + step,
        y: 56 + step,
        w: Math.min(640, vw() - 32),
        h: Math.min(480, vh() - 64),
        minimized: false,
        maximized: false,
      })
    })
  }

  return { list, activeId, open, focus, close, closeAll, update, toggleMin, toggleMax, tile, cascade }
}
