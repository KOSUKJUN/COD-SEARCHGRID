import { describe, expect, it } from 'vitest'
import { diffTexts, inlineDiff, stableJson } from '../src/utils/diff'

describe('diffTexts', () => {
  it('동일', () => {
    const r = diffTexts(['a', 'b'], ['a', 'b'])
    expect([r.added, r.removed, r.changed]).toEqual([0, 0, 0])
    expect(r.rows.every((x) => x.type === 'equal')).toBe(true)
  })

  it('추가 / 삭제 / 변경 좌우 정렬', () => {
    const a = ['GET / HTTP/1.1', 'Host: a', 'User-Agent: curl', 'Accept: */*']
    const b = ['GET / HTTP/1.1', 'Host: b', 'Accept: */*', 'X-Forwarded-For: 1.2.3.4']
    const r = diffTexts(a, b)
    expect(r.rows.map((x) => x.type)).toEqual(['equal', 'change', 'del', 'equal', 'add'])
    expect(r.rows[1]).toMatchObject({ left: { no: 2, text: 'Host: a' }, right: { no: 2, text: 'Host: b' } })
    expect(r.rows[4]).toMatchObject({ right: { no: 4, text: 'X-Forwarded-For: 1.2.3.4' } })
    expect([r.added, r.removed, r.changed]).toEqual([1, 1, 1])
  })

  it('공백 무시 normalize', () => {
    const r = diffTexts(['a  b', 'c'], ['a b', 'c'], { normalize: (s) => s.replace(/\s+/g, ' ') })
    expect(r.changed).toBe(0)
  })

  it('너무 크면 단순 비교', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`)
    const r = diffTexts(a, b, { maxCells: 100 })
    expect(r.simplified).toBe(true)
    expect(r.changed).toBe(50)
  })
})

describe('inlineDiff / stableJson', () => {
  it('공통 앞뒤를 제외한 변경 구간', () => {
    const { left, right } = inlineDiff('user=admin ok', 'user=root ok')
    expect(left).toEqual([
      { t: 'user=', changed: false },
      { t: 'admin', changed: true },
      { t: ' ok', changed: false },
    ])
    expect(right.find((s) => s.changed)?.t).toBe('root')
  })
  it('키 순서와 무관한 JSON', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }))
  })
})
