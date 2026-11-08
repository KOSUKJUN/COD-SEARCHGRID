import { describe, expect, it } from 'vitest'
import {
  buildFilterToken,
  conditionsToQuery,
  filterRecords,
  highlightTerms,
  parseQuery,
  queryToConditions,
  tokenize,
} from '../src/utils/query'
import { tokenAt } from '../src/utils/suggest'
import { toCSV, toTSV } from '../src/utils/export'

const rows = [
  { host: 'web-01', severity: 'high', dest_port: 443, message: 'Connection refused by upstream', geo: { country: 'KR' } },
  { host: 'web-02', severity: 'info', dest_port: 80, message: 'GET /index.html 200', geo: { country: 'US' } },
  { host: 'db-01', severity: 'critical', dest_port: 5432, message: 'Too many connections', geo: { country: 'KR' } },
]

describe('tokenize / parseQuery', () => {
  it('quoted phrase 는 하나의 토큰', () => {
    expect(tokenize('a "b c" d')).toEqual(['a', '"b c"', 'd'])
  })

  it('필드 필터, 자유 텍스트, NOT 분리', () => {
    const p = parseQuery('host=web-* error NOT timeout severity!=info msg="a b"')
    expect(p.terms).toEqual(['error'])
    expect(p.excludedTerms).toEqual(['timeout'])
    expect(p.filters).toEqual([
      { field: 'host', op: '=', value: 'web-*' },
      { field: 'severity', op: '!=', value: 'info' },
      { field: 'msg', op: '=', value: 'a b' },
    ])
  })

  it('NOT 은 필드 연산자를 반전', () => {
    expect(parseQuery('NOT port>=1024').filters[0]).toEqual({ field: 'port', op: '<', value: '1024' })
  })
})

describe('filterRecords', () => {
  it('자유 텍스트 (대소문자 무시)', () => {
    expect(filterRecords(rows, 'connection').map((r) => r.host)).toEqual(['web-01', 'db-01'])
  })
  it('구문 검색', () => {
    expect(filterRecords(rows, '"too many"').map((r) => r.host)).toEqual(['db-01'])
  })
  it('와일드카드 필드', () => {
    expect(filterRecords(rows, 'host=web-*')).toHaveLength(2)
  })
  it('숫자 비교', () => {
    expect(filterRecords(rows, 'dest_port>443').map((r) => r.host)).toEqual(['db-01'])
    expect(filterRecords(rows, 'dest_port<=443')).toHaveLength(2)
  })
  it('중첩 필드 + 제외', () => {
    expect(filterRecords(rows, 'geo.country=KR NOT critical').map((r) => r.host)).toEqual(['web-01'])
  })
  it('빈 쿼리는 전체', () => {
    expect(filterRecords(rows, '  ')).toHaveLength(3)
  })
})

describe('conditions (고급 필터)', () => {
  it('쿼리 ↔ 조건 왕복 변환', () => {
    const q = 'host=*web* severity!=info port>=1024 user=* geo!=* "a b" NOT blocked'
    const conds = queryToConditions(q)
    expect(conds).toEqual([
      { field: 'host', op: 'contains', value: 'web' },
      { field: 'severity', op: '!=', value: 'info' },
      { field: 'port', op: '>=', value: '1024' },
      { field: 'user', op: 'exists', value: '' },
      { field: 'geo', op: 'not_exists', value: '' },
      { field: '', op: 'text', value: 'a b' },
      { field: '', op: 'not_text', value: 'blocked' },
    ])
    expect(conditionsToQuery(conds)).toBe(q)
  })
  it('값이 빈 조건은 무시, 연산자가 있는 텍스트는 따옴표', () => {
    expect(
      conditionsToQuery([
        { field: 'host', op: '=', value: '' },
        { field: '', op: 'text', value: 'a=b' },
      ]),
    ).toBe('"a=b"')
  })
})

describe('tokenAt', () => {
  it('커서 위치 토큰 (따옴표 내부 공백 포함)', () => {
    expect(tokenAt('a host=we b', 8)).toEqual({ start: 2, end: 9, token: 'host=we' })
    expect(tokenAt('msg="a b" x', 6)).toEqual({ start: 0, end: 9, token: 'msg="a b"' })
  })
})

describe('export', () => {
  it('CSV 는 BOM + 이스케이프', () => {
    const csv = toCSV([{ a: 'x,y', b: 'say "hi"' }], [{ field: 'a', label: 'A' }, { field: 'b' }])
    expect(csv).toBe('﻿A,b\r\n"x,y","say ""hi"""')
  })
  it('TSV 는 탭/개행 제거', () => {
    expect(toTSV([{ a: 'x\ty\nz' }], [{ field: 'a' }])).toBe('a\nx y z')
  })
})

describe('helpers', () => {
  it('highlightTerms 는 와일드카드를 제거', () => {
    expect(highlightTerms(parseQuery('host=web-* error'))).toEqual(['error', 'web-'])
  })
  it('buildFilterToken 은 공백 값을 따옴표로', () => {
    expect(buildFilterToken('msg', '=', 'a b')).toBe('msg="a b"')
    expect(buildFilterToken('port', '!=', 22)).toBe('port!=22')
  })
})
