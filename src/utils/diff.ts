/**
 * 줄 단위 diff (LCS) + 좌우 정렬(side-by-side) + 줄 내부 변경 구간 계산.
 */

/** PayloadDiff 입력 (한쪽 payload) */
export interface DiffInput {
  value: unknown
  encoding?: string | null
  label: string
}

export interface DiffOp {
  type: 'equal' | 'add' | 'del'
  /** 왼쪽(a) 줄 인덱스 */
  a?: number
  /** 오른쪽(b) 줄 인덱스 */
  b?: number
}

export interface DiffSide {
  /** 1-based 줄 번호 */
  no: number
  text: string
}

export interface DiffRow {
  type: 'equal' | 'add' | 'del' | 'change'
  left?: DiffSide
  right?: DiffSide
}

export interface DiffResult {
  rows: DiffRow[]
  added: number
  removed: number
  changed: number
  /** 너무 커서 LCS 대신 단순 비교를 사용했는지 */
  simplified: boolean
}

/**
 * @param maxCells LCS 테이블 최대 셀 수 (초과 시 공통 앞/뒤만 맞추고 나머지는 삭제+추가로 처리)
 * @param normalize 비교용 정규화 (예: 공백 무시)
 */
export function diffLines(
  a: readonly string[],
  b: readonly string[],
  opts: { maxCells?: number; normalize?: (s: string) => string } = {},
): { ops: DiffOp[]; simplified: boolean } {
  const { maxCells = 4_000_000, normalize = (s: string) => s } = opts
  const na = a.map(normalize)
  const nb = b.map(normalize)
  const ops: DiffOp[] = []

  // 공통 prefix / suffix
  let start = 0
  while (start < na.length && start < nb.length && na[start] === nb[start]) {
    ops.push({ type: 'equal', a: start, b: start })
    start++
  }
  let endA = na.length
  let endB = nb.length
  const tail: DiffOp[] = []
  while (endA > start && endB > start && na[endA - 1] === nb[endB - 1]) {
    endA--
    endB--
    tail.unshift({ type: 'equal', a: endA, b: endB })
  }

  const n = endA - start
  const m = endB - start
  let simplified = false
  if (n && m && (n + 1) * (m + 1) <= maxCells) {
    // LCS 길이 테이블 (뒤에서부터)
    const w = m + 1
    const t = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i * w + j] = na[start + i] === nb[start + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (na[start + i] === nb[start + j]) {
        ops.push({ type: 'equal', a: start + i, b: start + j })
        i++
        j++
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) {
        ops.push({ type: 'del', a: start + i })
        i++
      } else {
        ops.push({ type: 'add', b: start + j })
        j++
      }
    }
    for (; i < n; i++) ops.push({ type: 'del', a: start + i })
    for (; j < m; j++) ops.push({ type: 'add', b: start + j })
  } else {
    simplified = n > 0 && m > 0
    for (let i = 0; i < n; i++) ops.push({ type: 'del', a: start + i })
    for (let j = 0; j < m; j++) ops.push({ type: 'add', b: start + j })
  }
  return { ops: ops.concat(tail), simplified }
}

/** diff 연산 → 좌우 정렬 행. 연속된 삭제/추가는 'change' 로 짝지어진다. */
export function toSideBySide(a: readonly string[], b: readonly string[], ops: readonly DiffOp[]): DiffRow[] {
  const rows: DiffRow[] = []
  let i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op.type === 'equal') {
      rows.push({ type: 'equal', left: { no: op.a! + 1, text: a[op.a!] }, right: { no: op.b! + 1, text: b[op.b!] } })
      i++
      continue
    }
    const dels: number[] = []
    const adds: number[] = []
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'del') dels.push(ops[i].a!)
      else adds.push(ops[i].b!)
      i++
    }
    const len = Math.max(dels.length, adds.length)
    for (let k = 0; k < len; k++) {
      const l = dels[k]
      const r = adds[k]
      if (l !== undefined && r !== undefined)
        rows.push({ type: 'change', left: { no: l + 1, text: a[l] }, right: { no: r + 1, text: b[r] } })
      else if (l !== undefined) rows.push({ type: 'del', left: { no: l + 1, text: a[l] } })
      else rows.push({ type: 'add', right: { no: r + 1, text: b[r] } })
    }
  }
  return rows
}

export function diffTexts(
  a: readonly string[],
  b: readonly string[],
  opts?: { maxCells?: number; normalize?: (s: string) => string },
): DiffResult {
  const { ops, simplified } = diffLines(a, b, opts)
  const rows = toSideBySide(a, b, ops)
  let added = 0
  let removed = 0
  let changed = 0
  for (const r of rows) {
    if (r.type === 'add') added++
    else if (r.type === 'del') removed++
    else if (r.type === 'change') changed++
  }
  return { rows, added, removed, changed, simplified }
}

export interface InlineSegment {
  t: string
  changed: boolean
}

/** 두 줄의 공통 앞/뒤를 제외한 가운데를 변경 구간으로 표시 */
export function inlineDiff(a: string, b: string): { left: InlineSegment[]; right: InlineSegment[] } {
  let p = 0
  const max = Math.min(a.length, b.length)
  while (p < max && a[p] === b[p]) p++
  let s = 0
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const seg = (str: string): InlineSegment[] =>
    [
      { t: str.slice(0, p), changed: false },
      { t: str.slice(p, str.length - s), changed: true },
      { t: str.slice(str.length - s), changed: false },
    ].filter((x) => x.t !== '')
  return { left: seg(a), right: seg(b) }
}

/** 키를 정렬한 pretty JSON (객체 키 순서 차이를 diff 에서 제외하기 위함) */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      )
    return v
  }
  return JSON.stringify(sort(value), null, 2)
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}
