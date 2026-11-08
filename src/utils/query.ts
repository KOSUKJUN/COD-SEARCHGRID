/**
 * SPL(Splunk Processing Language) 스타일의 간단한 검색 쿼리 파서/매처.
 *
 * 지원 문법
 *   error timeout          → 자유 텍스트 AND 검색 (대소문자 무시)
 *   "connection refused"   → 구문(phrase) 검색
 *   host=web-01            → 필드 일치
 *   host=web-*             → 와일드카드
 *   severity!=info         → 불일치
 *   dest_port>=1024        → 숫자/문자열 비교 (>, >=, <, <=)
 *   NOT blocked            → 제외
 *   geo.country=KR         → 중첩 필드 (dot path)
 *
 * 주의: 이 파일은 외부 import 가 없어야 하며, Node 의 type stripping 으로
 *       mock-server 에서도 그대로 import 되므로 enum/namespace 등 erasable 하지 않은 문법을 쓰지 않는다.
 */

export type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<='

export interface FieldFilter {
  field: string
  op: FilterOp
  value: string
}

export interface ParsedQuery {
  /** 포함되어야 하는 자유 텍스트 */
  terms: string[]
  /** 포함되면 안 되는 자유 텍스트 (NOT term) */
  excludedTerms: string[]
  filters: FieldFilter[]
}

const FILTER_RE = /^([A-Za-z_@][\w.@-]*)(!=|>=|<=|=|>|<)([\s\S]*)$/

const NEGATE_OP: Record<FilterOp, FilterOp> = {
  '=': '!=',
  '!=': '=',
  '>': '<=',
  '>=': '<',
  '<': '>=',
  '<=': '>',
}

export function tokenize(query: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let inQuote = false
  for (const ch of query) {
    if (ch === '"') {
      inQuote = !inQuote
      cur += ch
      continue
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) tokens.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1)
  if (s.startsWith('"')) return s.slice(1)
  return s
}

export function parseQuery(query: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], excludedTerms: [], filters: [] }
  let negate = false
  for (const tok of tokenize(query ?? '')) {
    if (tok === 'AND') continue
    if (tok === 'NOT') {
      negate = !negate
      continue
    }
    const m = tok.startsWith('"') ? null : FILTER_RE.exec(tok)
    if (m) {
      const op = m[2] as FilterOp
      out.filters.push({ field: m[1], op: negate ? NEGATE_OP[op] : op, value: unquote(m[3]) })
    } else {
      const term = unquote(tok)
      if (term) (negate ? out.excludedTerms : out.terms).push(term)
    }
    negate = false
  }
  return out
}

export function getValueByPath(record: unknown, path: string): unknown {
  if (record == null || typeof record !== 'object') return undefined
  const obj = record as Record<string, unknown>
  if (path in obj) return obj[path]
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function wildcardToRegExp(pattern: string, anchored = true): RegExp {
  const body = pattern.split('*').map(escapeRegExp).join('.*')
  return new RegExp(anchored ? `^${body}$` : body, 'i')
}

function stringify(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function collectText(v: unknown, out: string[]): void {
  if (v == null) return
  if (Array.isArray(v)) v.forEach((x) => collectText(x, out))
  else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => collectText(x, out))
  else out.push(String(v))
}

function compare(actual: unknown, expected: string): number | null {
  const a = Number(actual)
  const b = Number(expected)
  if (actual !== '' && actual != null && expected !== '' && Number.isFinite(a) && Number.isFinite(b)) return a - b
  if (actual == null) return null
  const as = stringify(actual)
  return as < expected ? -1 : as > expected ? 1 : 0
}

function matchFilter(record: unknown, f: FieldFilter): boolean {
  const actual = getValueByPath(record, f.field)
  switch (f.op) {
    case '=':
    case '!=': {
      let eq: boolean
      if (actual == null) eq = false
      else if (f.value.includes('*')) eq = wildcardToRegExp(f.value).test(stringify(actual))
      else eq = stringify(actual).toLowerCase() === f.value.toLowerCase()
      return f.op === '=' ? eq : !eq
    }
    default: {
      const c = compare(actual, f.value)
      if (c === null) return false
      if (f.op === '>') return c > 0
      if (f.op === '>=') return c >= 0
      if (f.op === '<') return c < 0
      return c <= 0
    }
  }
}

function matchTerm(haystack: string, term: string): boolean {
  if (term.includes('*')) return wildcardToRegExp(term, false).test(haystack)
  return haystack.includes(term.toLowerCase())
}

export function matchRecord(record: unknown, parsed: ParsedQuery): boolean {
  for (const f of parsed.filters) if (!matchFilter(record, f)) return false
  if (parsed.terms.length || parsed.excludedTerms.length) {
    const parts: string[] = []
    collectText(record, parts)
    const haystack = parts.join('\u0000').toLowerCase()
    for (const t of parsed.terms) if (!matchTerm(haystack, t)) return false
    for (const t of parsed.excludedTerms) if (matchTerm(haystack, t)) return false
  }
  return true
}

/** 레코드 배열을 쿼리로 필터링 */
export function filterRecords<T>(records: readonly T[], query: string | ParsedQuery): T[] {
  const parsed = typeof query === 'string' ? parseQuery(query) : query
  if (!parsed.terms.length && !parsed.excludedTerms.length && !parsed.filters.length) return records.slice()
  return records.filter((r) => matchRecord(r, parsed))
}

/** 하이라이트에 사용할 문자열 목록 (자유 텍스트 + '=' 필터 값) */
export function highlightTerms(parsed: ParsedQuery): string[] {
  const set = new Set<string>()
  for (const t of parsed.terms) set.add(t)
  for (const f of parsed.filters) if (f.op === '=') set.add(f.value)
  return [...set]
    .flatMap((t) => t.split('*'))
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/** 필터 토큰 생성: 공백/따옴표가 있으면 따옴표로 감싼다 */
export function buildFilterToken(field: string, op: FilterOp, value: unknown): string {
  const v = stringify(value)
  const needsQuote = /[\s"]/.test(v) || v === ''
  return `${field}${op}${needsQuote ? `"${v.replace(/"/g, '')}"` : v}`
}

export function appendToQuery(query: string, token: string): string {
  const q = (query ?? '').trim()
  return q ? `${q} ${token}` : token
}

// ------------------------------------------------------------------ group by

/** 그룹 집계 결과 (value === null 은 필드가 없는 레코드) */
export interface GroupBucket {
  value: string | null
  count: number
}

export function groupKeyOf(v: unknown): string | null {
  return v == null ? null : stringify(v)
}

/** 그룹 정렬: 정렬 필드가 그룹 필드면 값 기준, 아니면 건수 내림차순 */
export function sortBuckets<B extends GroupBucket>(
  buckets: B[],
  field: string,
  sort?: { field: string; order: 'asc' | 'desc' } | null,
): B[] {
  if (sort && sort.field === field) {
    const dir = sort.order === 'asc' ? 1 : -1
    return buckets.sort((a, b) => {
      if (a.value === null) return 1
      if (b.value === null) return -1
      return dir * compareValues(a.value, b.value)
    })
  }
  return buckets.sort((a, b) => b.count - a.count || compareValues(a.value, b.value))
}

/** 필드 값별 건수 집계 (서버/클라이언트 공용) */
export function groupCounts(
  records: readonly unknown[],
  field: string,
  sort?: { field: string; order: 'asc' | 'desc' } | null,
): GroupBucket[] {
  const map = new Map<string | null, number>()
  for (const r of records) {
    const k = groupKeyOf(getValueByPath(r, field))
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return sortBuckets(
    [...map].map(([value, count]) => ({ value, count })),
    field,
    sort,
  )
}

/** 그룹 drill-down 용 필터 토큰 (값 없음 → field!=*) */
export function groupFilterToken(field: string, value: string | null): string {
  return value === null ? `${field}!=*` : buildFilterToken(field, '=', value)
}

// ------------------------------------------------------------------ filter builder

export type ConditionOp =
  | FilterOp
  | 'contains'
  | 'not_contains'
  | 'exists'
  | 'not_exists'
  /** 필드 무관 자유 텍스트 포함 */
  | 'text'
  | 'not_text'

export interface QueryCondition {
  field: string
  op: ConditionOp
  value: string
}

/** 자유 텍스트 토큰: 공백/연산자/따옴표가 있으면 따옴표로 감싼다 */
export function quoteTerm(v: string): string {
  return /[\s"=<>!]/.test(v) || v === 'NOT' || v === 'AND' ? `"${v.replace(/"/g, '')}"` : v
}

/** 쿼리 문자열 → 조건 목록 (고급 필터 UI 초기화용) */
export function queryToConditions(query: string): QueryCondition[] {
  const p = parseQuery(query)
  const out: QueryCondition[] = []
  for (const f of p.filters) {
    const v = f.value
    const wrapped = v.length > 2 && v.startsWith('*') && v.endsWith('*') && !v.slice(1, -1).includes('*')
    if ((f.op === '=' || f.op === '!=') && v === '*') out.push({ field: f.field, op: f.op === '=' ? 'exists' : 'not_exists', value: '' })
    else if ((f.op === '=' || f.op === '!=') && wrapped)
      out.push({ field: f.field, op: f.op === '=' ? 'contains' : 'not_contains', value: v.slice(1, -1) })
    else out.push({ field: f.field, op: f.op, value: v })
  }
  for (const t of p.terms) out.push({ field: '', op: 'text', value: t })
  for (const t of p.excludedTerms) out.push({ field: '', op: 'not_text', value: t })
  return out
}

/** 조건 목록 → 쿼리 문자열 (값이 비어있는 조건은 무시) */
export function conditionsToQuery(conditions: readonly QueryCondition[]): string {
  const parts: string[] = []
  for (const c of conditions) {
    const v = c.value.trim()
    const field = c.field.trim()
    if (c.op === 'text' || c.op === 'not_text' || !field) {
      if (!v) continue
      const neg = c.op === 'not_text' || c.op === '!=' || c.op === 'not_contains' || c.op === 'not_exists'
      parts.push(neg ? `NOT ${quoteTerm(v)}` : quoteTerm(v))
      continue
    }
    if (c.op === 'exists') parts.push(`${field}=*`)
    else if (c.op === 'not_exists') parts.push(`${field}!=*`)
    else if (!v) continue
    else if (c.op === 'contains') parts.push(buildFilterToken(field, '=', `*${v}*`))
    else if (c.op === 'not_contains') parts.push(buildFilterToken(field, '!=', `*${v}*`))
    else parts.push(buildFilterToken(field, c.op, v))
  }
  return parts.join(' ')
}

/** dot path 로 값 설정 (중간 객체가 없으면 생성) */
export function setValueByPath(record: Record<string, unknown>, path: string, value: unknown): void {
  if (path in record || !path.includes('.')) {
    record[path] = value
    return
  }
  const keys = path.split('.')
  let cur: Record<string, unknown> = record
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]]
    if (next == null || typeof next !== 'object') cur[keys[i]] = {}
    cur = cur[keys[i]] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]] = value
}

/** 정렬 비교 함수 (숫자는 숫자로, 그 외는 문자열로) */
export function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && a !== '' && b !== '') return na - nb
  const sa = stringify(a)
  const sb = stringify(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}
