import { getValueByPath } from './query'

/** 커서 위치의 토큰 범위 (따옴표 안의 공백은 토큰에 포함) */
export function tokenAt(value: string, caret: number): { start: number; end: number; token: string } {
  let inQuote = false
  let start = 0
  for (let i = 0; i < caret; i++) {
    const ch = value[i]
    if (ch === '"') inQuote = !inQuote
    else if (!inQuote && /\s/.test(ch)) start = i + 1
  }
  let end = caret
  while (end < value.length && (inQuote || !/\s/.test(value[end]))) {
    if (value[end] === '"') inQuote = !inQuote
    end++
  }
  return { start, end, token: value.slice(start, end) }
}

export const FIELD_TOKEN_RE = /^([A-Za-z_@][\w.@-]*)(!=|>=|<=|=|>|<)(.*)$/

/** 값 정렬: prefix 로 시작하는 것 우선, 그 다음 포함 */
export function rankByPrefix(values: Iterable<string>, prefix: string, limit = 10): string[] {
  const p = prefix.toLowerCase()
  const starts: string[] = []
  const contains: string[] = []
  for (const v of values) {
    const lv = v.toLowerCase()
    if (!p || lv.startsWith(p)) starts.push(v)
    else if (lv.includes(p)) contains.push(v)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains].slice(0, limit)
}

/** 레코드 샘플에서 필드 값 빈도 상위 목록 */
export function topValues(records: readonly unknown[], field: string, limit = 50, sample = 5000): string[] {
  const counts = new Map<string, number>()
  const n = Math.min(records.length, sample)
  for (let i = 0; i < n; i++) {
    const v = getValueByPath(records[i], field)
    if (v == null || typeof v === 'object') continue
    const s = String(v)
    if (s.length > 120) continue
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v)
}

/** 레코드 샘플에서 dot path 필드 목록 수집 */
export function collectFieldPaths(records: readonly unknown[], sample = 100, exclude: readonly string[] = []): string[] {
  const set = new Set<string>()
  const walk = (obj: unknown, prefix: string) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k
      if (exclude.includes(path)) continue
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path)
      else set.add(path)
    }
  }
  for (let i = 0; i < Math.min(records.length, sample); i++) walk(records[i], '')
  return [...set]
}
