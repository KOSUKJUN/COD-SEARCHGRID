import type { LogRecord, SortState } from '../types'
import { getValueByPath, groupFilterToken, groupKeyOf, sortBuckets, type GroupBucket } from './query'

export interface GroupNode extends GroupBucket {
  /** 트리 내 고유 키 (부모 경로 포함) */
  key: string
  field: string
  depth: number
  /** 부모 그룹(또는 전체) 건수 — 비율 표시용 */
  parentCount: number
  /** 이 그룹까지의 drill-down 필터 토큰 */
  filters: string[]
  /** 마지막 레벨 여부 (펼치면 이벤트 행이 나온다) */
  leaf: boolean
  /** 로컬 모드: 하위 그룹 */
  children?: GroupNode[]
  /** 로컬 모드: 리프 그룹의 행 */
  rows?: LogRecord[]
}

export function makeGroupNode(
  field: string,
  bucket: GroupBucket,
  depth: number,
  parent: { key: string; filters: string[]; count: number },
  leaf: boolean,
): GroupNode {
  return {
    value: bucket.value,
    count: bucket.count,
    field,
    depth,
    leaf,
    parentCount: parent.count,
    key: `${parent.key}\u0001${field}=${bucket.value === null ? '\u0000' : bucket.value}`,
    filters: [...parent.filters, groupFilterToken(field, bucket.value)],
  }
}

/** 로컬 데이터로 다단계 그룹 트리 생성 (rows 의 순서는 리프 내부에서 유지된다) */
export function buildGroupTree(
  rows: readonly LogRecord[],
  fields: readonly string[],
  sort: SortState | null,
  depth = 0,
  parent: { key: string; filters: string[]; count: number } = { key: '', filters: [], count: rows.length },
): GroupNode[] {
  const field = fields[depth]
  if (!field) return []
  const map = new Map<string | null, LogRecord[]>()
  for (const r of rows) {
    const k = groupKeyOf(getValueByPath(r, field))
    let list = map.get(k)
    if (!list) map.set(k, (list = []))
    list.push(r)
  }
  const leaf = depth === fields.length - 1
  const nodes = [...map].map(([value, list]) => {
    const node = makeGroupNode(field, { value, count: list.length }, depth, parent, leaf)
    if (leaf) node.rows = list
    else node.children = buildGroupTree(list, fields, sort, depth + 1, { key: node.key, filters: node.filters, count: list.length })
    return node
  })
  return sortBuckets(nodes, field, sort)
}

/** 트리의 모든 그룹 키 (모두 펼치기용) */
export function collectGroupKeys(nodes: readonly GroupNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.key)
    if (n.children) collectGroupKeys(n.children, out)
  }
  return out
}
