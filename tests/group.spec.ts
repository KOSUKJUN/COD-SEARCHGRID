import { describe, expect, it } from 'vitest'
import { buildGroupTree, collectGroupKeys } from '../src/utils/group'
import { filterRecords, groupCounts } from '../src/utils/query'

const rows = [
  { host: 'web-01', severity: 'high' },
  { host: 'web-01', severity: 'info' },
  { host: 'web-02', severity: 'info' },
  { host: 'web-01', severity: 'info' },
  { severity: 'low' },
]

describe('groupCounts', () => {
  it('건수 내림차순, 값 없음은 null', () => {
    expect(groupCounts(rows, 'host')).toEqual([
      { value: 'web-01', count: 3 },
      { value: 'web-02', count: 1 },
      { value: null, count: 1 },
    ])
  })
  it('정렬 필드 == 그룹 필드면 값 기준 정렬 (null 은 마지막)', () => {
    expect(groupCounts(rows, 'host', { field: 'host', order: 'desc' }).map((g) => g.value)).toEqual([
      'web-02',
      'web-01',
      null,
    ])
  })
})

describe('buildGroupTree', () => {
  const tree = buildGroupTree(rows, ['host', 'severity'], null)

  it('다단계 트리와 비율 기준값', () => {
    expect(tree.map((n) => [n.value, n.count, n.leaf])).toEqual([
      ['web-01', 3, false],
      ['web-02', 1, false],
      [null, 1, false],
    ])
    const web01 = tree[0]
    expect(web01.children!.map((n) => [n.value, n.count, n.parentCount, n.leaf])).toEqual([
      ['info', 2, 3, true],
      ['high', 1, 3, true],
    ])
    expect(web01.children![0].rows).toHaveLength(2)
  })

  it('drill-down 필터 토큰이 실제 데이터와 일치', () => {
    for (const key of collectGroupKeys(tree)) expect(key).toBeTruthy()
    const leaf = tree[0].children![0]
    expect(leaf.filters).toEqual(['host=web-01', 'severity=info'])
    expect(filterRecords(rows, leaf.filters.join(' '))).toHaveLength(leaf.count)
    const empty = tree[2]
    expect(empty.filters).toEqual(['host!=*'])
    expect(filterRecords(rows, empty.filters.join(' '))).toHaveLength(1)
  })
})
