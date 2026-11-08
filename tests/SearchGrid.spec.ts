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

const hosts = (w: ReturnType<typeof mount>) => w.findAll('.csg-tr').map((r) => r.find('.csg-td').text())

describe('SearchGrid (local mode)', () => {
  it('행을 렌더링하고 심각도 클래스를 붙인다', () => {
    const w = mount(SearchGrid, { props: { columns, rows } })
    expect(hosts(w)).toEqual(['web-02', 'web-01', 'db-01'])
    expect(w.find('.csg-sev--critical').exists()).toBe(true)
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
    const th = w.findAll('.csg-th')[0]
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

describe('SearchGrid (dataSource mode)', () => {
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
