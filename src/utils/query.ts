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
