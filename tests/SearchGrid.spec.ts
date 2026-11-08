import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { SearchGrid, type DataSource, type GridColumn } from '../src'

const columns: GridColumn[] = [
  { field: 'host', label: 'Host' },
  { field: 'severity', label: 'Severity' },
  { field: 'message', label: 'Message' },
]
const rows = [
  { host: 'web-02', severity: 'info', message: 'ok request' },
  { host: 'web-01', severity: 'high', message: 'error timeout' },
  { host: 'db-01', severity: 'critical', message: 'error disk full' },
]

const hosts = (w: ReturnType<typeof mount>) =>
  w
    .findAll('.csg-tr')
    .filter((r) => r.find('.csg-td:not(.csg-td--lead)').exists())
    .map((r) => r.find('.csg-td:not(.csg-td--lead)').text())

describe('SearchGrid (local mode)', () => {
  it('행을 렌더링하고 심각도 클래스를 붙인다', () => {
    const w = mount(SearchGrid, { props: { columns, rows } })
    expect(hosts(w)).toEqual(['web-02', 'web-01', 'db-01'])
    // 심각도 색상 막대는 기본 꺼짐, severityBar 로 켤 수 있다
    expect(w.find('.csg-sev--critical').exists()).toBe(false)
    const w2 = mount(SearchGrid, { props: { columns, rows, severityBar: true } })
    expect(w2.find('.csg-sev--critical').exists()).toBe(true)
    expect(w2.classes()).toContain('csg--sevbar')
    expect(w.find('.csg-status__count').text()).toContain('3')
  })

  it('검색하면 필터링되고 검색어가 하이라이트된다', async () => {
    const w = mount(SearchGrid, { props: { columns, rows } })
    await w.find('input').setValue('error')
    await w.find('form').trigger('submit')
    expect(hosts(w)).toEqual(['web-01', 'db-01'])
    expect(w.findAll('mark.csg-hl').map((m) => m.text())).toEqual(['error', 'error'])
    expect(w.emitted('update:query')?.at(-1)).toEqual(['error'])
  })

  it('헤더 클릭 시 asc → desc → 해제', async () => {
    const w = mount(SearchGrid, { props: { columns, rows } })
    const th = w.findAll('.csg-th:not(.csg-th--lead)')[0]
    await th.trigger('click')
    expect(hosts(w)).toEqual(['db-01', 'web-01', 'web-02'])
    await th.trigger('click')
    expect(hosts(w)).toEqual(['web-02', 'web-01', 'db-01'])
    await th.trigger('click')
    expect(w.emitted('sort-change')?.at(-1)).toEqual([null])
  })

  it('행 클릭 시 상세 패널, + 버튼으로 필터 추가', async () => {
    const w = mount(SearchGrid, { props: { columns, rows } })
    await w.findAll('.csg-tr')[1].trigger('click')
    expect(w.find('.csg-detail').exists()).toBe(true)
    const hostRow = w.findAll('.csg-detail__table tr').find((tr) => tr.find('th').text() === 'host')!
    await hostRow.find('.csg-icon-btn').trigger('click')
    expect((w.find('input').element as HTMLInputElement).value).toBe('host=web-01')
    expect(hosts(w)).toEqual(['web-01'])
  })
})

describe('SearchGrid (group by, local)', () => {
  it('groupBy 지정 시 그룹 헤더만 보이고, 클릭하면 펼쳐진다', async () => {
    const w = mount(SearchGrid, { props: { columns, rows, groupBy: ['host'] } })
    const groups = w.findAll('.csg-group')
    expect(groups).toHaveLength(3)
    expect(w.findAll('.csg-tr:not(.csg-group)')).toHaveLength(0)
    expect(w.find('.csg-status__groups').text()).toContain('3')
    await groups[0].trigger('click')
    expect(w.findAll('.csg-tr:not(.csg-group)')).toHaveLength(1)
    expect(w.emitted('group-toggle')).toHaveLength(1)
  })

  it('그룹 추가 select 로 다단계 그룹핑 + 모두 펼치기', async () => {
    const w = mount(SearchGrid, { props: { columns, rows } })
    const select = () => w.find('.csg-groupbar__select')
    await select().setValue('severity')
    expect(w.emitted('update:groupBy')?.at(-1)).toEqual([['severity']])
    await select().setValue('host')
    expect(w.emitted('update:groupBy')?.at(-1)).toEqual([['severity', 'host']])
    expect(w.findAll('.csg-chip')).toHaveLength(2)
    await w.findAll('.csg-link-btn').find((b) => b.text() === '모두 펼치기')!.trigger('click')
    // 3 severity + 3 host + 3 rows
    expect(w.findAll('.csg-tr')).toHaveLength(9)
    await w.findAll('.csg-chip__x')[0].trigger('click')
    expect(w.emitted('update:groupBy')?.at(-1)).toEqual([['host']])
  })

  it('검색 후 그룹 건수가 갱신된다', async () => {
    const w = mount(SearchGrid, { props: { columns, rows, groupBy: ['severity'] } })
    await w.find('input').setValue('error')
    await w.find('form').trigger('submit')
    expect(w.findAll('.csg-group')).toHaveLength(2)
  })
})

describe('SearchGrid (payload)', () => {
  it('더블클릭 시 Payload 탭이 열린다', async () => {
    const data = [{ host: 'a', severity: 'info', message: 'x', payload: '{"user":"admin"}' }]
    const w = mount(SearchGrid, { props: { columns, rows: data } })
    await w.find('.csg-tr').trigger('dblclick')
    expect(w.find('.csg-payload__body').text()).toContain('"user": "admin"')
    const tabs = w.findAll('.csg-tabs__btn').map((b) => b.text())
    expect(tabs).toEqual(['필드', 'Payload', 'JSON'])
    await w.findAll('.csg-seg__btn').find((b) => b.text() === 'Hex')!.trigger('click')
    expect(w.find('.csg-payload__body').text()).toContain('00000000  7b 22 75 73')
  })

  it('payload 가 없으면 탭이 숨겨진다', async () => {
    const w = mount(SearchGrid, { props: { columns, rows } })
    await w.find('.csg-tr').trigger('dblclick')
    expect(w.findAll('.csg-tabs__btn').map((b) => b.text())).toEqual(['필드', 'JSON'])
    expect(w.find('.csg-detail__table').exists()).toBe(true)
  })
})

describe('SearchGrid (dataSource mode)', () => {
  it('groupBy 시 groups 를 요청하고, 그룹을 펼치면 필터가 붙은 쿼리로 행을 요청한다', async () => {
    const ds = vi.fn<DataSource>(async (req) => {
      if (req.groupBy) return { rows: [], total: 3, groups: [{ value: 'high', count: 1 }, { value: null, count: 2 }] }
      return { rows: [rows[1]], total: 1 }
    })
    const w = mount(SearchGrid, { props: { columns, dataSource: ds, query: 'error', groupBy: ['severity'] } })
    await flushPromises()
    expect(ds.mock.calls[0][0]).toMatchObject({ query: 'error', groupBy: 'severity' })
    expect(w.findAll('.csg-group')).toHaveLength(2)
    await w.findAll('.csg-group')[0].trigger('click')
    await flushPromises()
    expect(ds.mock.calls[1][0]).toMatchObject({ query: 'error severity=high', offset: 0 })
    expect(ds.mock.calls[1][0].groupBy).toBeUndefined()
    expect(hosts(w)).toEqual(['web-01'])
    await w.findAll('.csg-group')[1].trigger('click')
    await flushPromises()
    expect(ds.mock.calls[2][0].query).toBe('error severity!=*')
  })

  it('마운트 시 dataSource 를 호출하고 결과를 표시한다', async () => {
    const ds = vi.fn<DataSource>(async (req) => ({
      rows: rows.slice(req.offset, req.offset + req.limit),
      total: rows.length,
      took: 5,
    }))
    const w = mount(SearchGrid, { props: { columns, dataSource: ds, query: 'abc', pageSize: 50 } })
    await flushPromises()
    expect(ds).toHaveBeenCalledTimes(1)
    expect(ds.mock.calls[0][0]).toMatchObject({ query: 'abc', offset: 0, limit: 50 })
    expect(hosts(w)).toEqual(['web-02', 'web-01', 'db-01'])
    expect(w.find('.csg-status__took').text()).toContain('5')
  })

  it('오류 시 error 이벤트를 발생시킨다', async () => {
    const ds: DataSource = async () => {
      throw new Error('boom')
    }
    const w = mount(SearchGrid, { props: { columns, dataSource: ds } })
    await flushPromises()
    expect(w.emitted('error')).toHaveLength(1)
    expect(w.find('.csg-status__error').text()).toContain('boom')
  })
})
