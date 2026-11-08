import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { markRaw, nextTick } from 'vue'
import { SearchGrid, type GridColumn, type LogRecord } from '../src'

const columns: GridColumn[] = [
  { field: 'host', label: 'Host' },
  { field: 'severity', label: 'Severity' },
  { field: 'message', label: 'Message' },
  { field: 'note', label: 'Note', editable: true },
]
const makeRows = (): LogRecord[] => [
  { id: 'a', host: 'web-02', severity: 'info', message: 'ok request', note: '' },
  { id: 'b', host: 'web-01', severity: 'high', message: 'error timeout', note: '' },
  { id: 'c', host: 'db-01', severity: 'critical', message: 'error disk full', note: '' },
]

let wrappers: VueWrapper[] = []
function mk(props: Record<string, unknown> = {}) {
  // 실제 사용처처럼 비반응형(raw) 행 배열을 넘긴다
  const w = mount(SearchGrid, {
    props: { columns, rows: markRaw(makeRows()), rowKey: 'id', ...props },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}
const dataRows = (w: VueWrapper) => w.findAll('.csg-tr:not(.csg-group):not(.csg-more)')
const headers = (w: VueWrapper) => w.findAll('.csg-th:not(.csg-th--lead) .csg-th__label').map((h) => h.text())
const menuItem = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.csg-menu__item')).find((b) => b.textContent?.includes(label))

beforeEach(() => localStorage.clear())
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers = []
})

describe('선택 (체크박스 / 전체 / 범위)', () => {
  it('체크박스 선택 시 선택 바와 selection-change', async () => {
    const w = mk()
    await dataRows(w)[1].find('.csg-check').trigger('click')
    expect(w.find('.csg-selbar').text()).toContain('1개 선택됨')
    expect((w.emitted('selection-change')!.at(-1)![0] as LogRecord[]).map((r) => r.id)).toEqual(['b'])
    expect(dataRows(w)[1].classes()).toContain('csg-tr--checked')
  })

  it('헤더 체크박스로 전체 선택/해제', async () => {
    const w = mk()
    await w.find('.csg-th--lead .csg-check').trigger('change')
    expect(w.find('.csg-selbar').text()).toContain('3개 선택됨')
    await w.find('.csg-th--lead .csg-check').trigger('change')
    expect(w.find('.csg-selbar').exists()).toBe(false)
  })

  it('Shift+클릭 범위 선택, Ctrl+클릭 토글', async () => {
    const w = mk()
    await dataRows(w)[0].trigger('click')
    await dataRows(w)[2].trigger('click', { shiftKey: true })
    expect(w.find('.csg-selbar').text()).toContain('3개 선택됨')
    await dataRows(w)[1].trigger('click', { ctrlKey: true })
    expect(w.find('.csg-selbar').text()).toContain('2개 선택됨')
  })
})

describe('행 번호 / 컬럼 숨김 / 고정 / 순서', () => {
  it('행 번호 컬럼', () => {
    const w = mk({ showRowNumber: true })
    expect(w.findAll('.csg-td--num').map((c) => c.text())).toEqual(['1', '2', '3'])
  })

  it('헤더 컨텍스트 메뉴로 숨기기 / 고정', async () => {
    const w = mk()
    await w.findAll('.csg-th:not(.csg-th--lead)')[1].trigger('contextmenu')
    menuItem('컬럼 숨기기')!.click()
    await nextTick()
    expect(headers(w)).toEqual(['Host', 'Message', 'Note'])

    await w.findAll('.csg-th:not(.csg-th--lead)')[1].trigger('contextmenu')
    menuItem('좌측 고정')!.click()
    await nextTick()
    expect(headers(w)).toEqual(['Message', 'Host', 'Note'])
    expect(w.find('.csg-th--frozen .csg-th__label').text()).toBe('Message')
    expect(dataRows(w)[0].find('.csg-td--frozen:not(.csg-td--lead)').exists()).toBe(true)
  })

  it('컬럼 선택 메뉴: 표시 토글과 순서 변경', async () => {
    const w = mk()
    const btn = w.findAll('.csg-dd > button').find((b) => b.text().includes('컬럼'))!
    await btn.trigger('click')
    const items = () => Array.from(document.querySelectorAll('.csg-cc__item'))
    const cb = items()[2].querySelector('input') as HTMLInputElement
    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    await nextTick()
    expect(headers(w)).toEqual(['Host', 'Severity', 'Note'])
    ;(items()[0].querySelector('[aria-label="down"]') as HTMLButtonElement).click()
    await nextTick()
    expect(headers(w)).toEqual(['Severity', 'Host', 'Note'])
  })
})

describe('컨텍스트 메뉴 / 복사', () => {
  it('셀 우클릭 → 이 값으로 검색', async () => {
    const w = mk()
    await dataRows(w)[1].findAll('.csg-td:not(.csg-td--lead)')[1].trigger('contextmenu')
    expect(document.querySelector('.csg-menu')).not.toBeNull()
    menuItem('이 값으로 검색')!.click()
    await nextTick()
    expect((w.find('input.csg-search__input').element as HTMLInputElement).value).toBe('severity=high')
    expect(dataRows(w)).toHaveLength(1)
  })

  it('contextMenu 함수로 항목 커스터마이징', async () => {
    let called = false
    const w = mk({
      contextMenu: ({ defaults }: { defaults: unknown[] }) => [...defaults, { label: '티켓 생성', action: () => (called = true) }],
    })
    await dataRows(w)[0].trigger('contextmenu')
    menuItem('티켓 생성')!.click()
    expect(called).toBe(true)
  })
})

describe('키보드', () => {
  it('↓ 이동, Space 선택, Enter 상세, Esc 닫기, Ctrl+A 전체', async () => {
    const w = mk()
    const grid = w.find('.csg-scroll')
    await grid.trigger('keydown', { key: 'ArrowDown' })
    await grid.trigger('keydown', { key: 'ArrowDown' })
    expect(dataRows(w)[1].classes()).toContain('csg-tr--focus')
    expect(grid.attributes('aria-activedescendant')).toBe(dataRows(w)[1].attributes('id'))
    await grid.trigger('keydown', { key: ' ' })
    expect(w.find('.csg-selbar').text()).toContain('1개')
    await grid.trigger('keydown', { key: 'Enter' })
    expect(w.find('.csg-detail').exists()).toBe(true)
    await grid.trigger('keydown', { key: 'Escape' })
    expect(w.find('.csg-detail').exists()).toBe(false)
    await grid.trigger('keydown', { key: 'a', ctrlKey: true })
    expect(w.find('.csg-selbar').text()).toContain('3개')
  })

  it('그룹 행에서 → / ← 로 펼치기/접기', async () => {
    const w = mk({ groupBy: ['severity'] })
    const grid = w.find('.csg-scroll')
    await grid.trigger('keydown', { key: 'ArrowDown' })
    await grid.trigger('keydown', { key: 'ArrowRight' })
    expect(dataRows(w)).toHaveLength(1)
    await grid.trigger('keydown', { key: 'ArrowLeft' })
    expect(dataRows(w)).toHaveLength(0)
  })
})

describe('셀 편집', () => {
  it('더블클릭 → 입력 → Enter 로 커밋', async () => {
    const w = mk()
    const cell = dataRows(w)[0].findAll('.csg-td:not(.csg-td--lead)')[3]
    expect(cell.classes()).toContain('csg-td--editable')
    // 실제 브라우저처럼 click → dblclick 순서. 편집 셀 클릭은 상세 패널을 열지 않아야 한다
    await cell.trigger('click')
    expect(w.find('.csg-detail').exists()).toBe(false)
    await cell.trigger('dblclick')
    const input = w.find('.csg-cell-input')
    await input.setValue('확인 완료')
    await input.trigger('keydown', { key: 'Enter' })
    const ev = w.emitted('cell-edit')![0][0] as { field: string; value: unknown }
    expect(ev).toMatchObject({ field: 'note', value: '확인 완료' })
    expect(dataRows(w)[0].findAll('.csg-td:not(.csg-td--lead)')[3].text()).toBe('확인 완료')
    // 편집 셀 더블클릭은 상세 패널을 열지 않는다
    expect(w.find('.csg-detail').exists()).toBe(false)
  })
})

describe('고급 필터', () => {
  it('현재 쿼리를 조건으로 불러오고, 수정 후 적용', async () => {
    const w = mk({ query: 'severity!=info error' })
    await w.findAll('.csg-toolbar > button').find((b) => b.text().startsWith('필터'))!.trigger('click')
    const rows = w.findAll('.csg-fb__row')
    expect(rows).toHaveLength(2)
    expect((rows[0].findAll('select')[0].element as HTMLSelectElement).value).toBe('severity')
    expect((rows[0].findAll('select')[1].element as HTMLSelectElement).value).toBe('!=')
    await w.find('.csg-fb__foot .csg-link-btn').trigger('click')
    const last = w.findAll('.csg-fb__row').at(-1)!
    await last.findAll('select')[0].setValue('host')
    await last.findAll('select')[1].setValue('contains')
    await last.find('input').setValue('db')
    expect(w.find('.csg-fb__preview').text()).toBe('severity!=info error host=*db*')
    await w.find('form.csg-fb').trigger('submit')
    expect(dataRows(w).map((r) => r.findAll('.csg-td:not(.csg-td--lead)')[0].text())).toEqual(['db-01'])
    expect(w.find('.csg-fb').exists()).toBe(false)
  })
})

describe('자동완성', () => {
  it('필드명 → 값 제안', async () => {
    const w = mk()
    const input = w.find('input.csg-search__input')
    ;(input.element as HTMLInputElement).focus()
    await input.setValue('sev')
    await flushPromises()
    const labels = () => w.findAll('.csg-ac__label').map((l) => l.text())
    expect(labels()).toContain('severity')
    await w.findAll('.csg-ac__item').find((i) => i.text().includes('severity'))!.trigger('click')
    await flushPromises()
    expect((input.element as HTMLInputElement).value).toBe('severity=')
    expect(labels()).toEqual(expect.arrayContaining(['info', 'high', 'critical']))
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect((input.element as HTMLInputElement).value).toMatch(/^severity=\w+ $/)
  })
})

describe('기록 / 즐겨찾기 / 설정 저장', () => {
  it('검색 기록과 설정이 storageKey 로 저장·복원된다', async () => {
    const w = mk({ storageKey: 't1' })
    await w.find('input.csg-search__input').setValue('error')
    await w.find('form.csg-toolbar').trigger('submit')
    expect(JSON.parse(localStorage.getItem('t1:history')!)).toEqual(['error'])

    await w.findAll('.csg-th:not(.csg-th--lead)')[0].trigger('contextmenu')
    menuItem('컬럼 숨기기')!.click()
    await w.findAll('.csg-toolbar > button').find((b) => b.text().includes('줄바꿈'))!.trigger('click')
    await nextTick()
    const prefs = JSON.parse(localStorage.getItem('t1:prefs')!)
    expect(prefs.columns.hidden).toEqual(['host'])
    expect(prefs.wrap).toBe(true)
    expect(w.emitted('state-change')).toBeTruthy()

    const w2 = mk({ storageKey: 't1' })
    expect(headers(w2)).toEqual(['Severity', 'Message', 'Note'])
    expect(dataRows(w2)[0].classes()).toContain('csg-tr--wrap')
  })

  it('즐겨찾기 저장 후 적용', async () => {
    const w = mk({ storageKey: 't2' })
    await w.find('input.csg-search__input').setValue('severity=critical')
    await w.findAll('.csg-dd > button').find((b) => b.text().startsWith('★'))!.trigger('click')
    const name = document.querySelector('.csg-bm__save input') as HTMLInputElement
    name.value = '치명 이벤트'
    name.dispatchEvent(new Event('input'))
    ;(document.querySelector('.csg-bm__save button') as HTMLButtonElement).click()
    await nextTick()
    const saved = JSON.parse(localStorage.getItem('t2:bookmarks')!)
    expect(saved[0]).toMatchObject({ name: '치명 이벤트', query: 'severity=critical' })

    await w.find('input.csg-search__input').setValue('')
    await w.findAll('.csg-dd > button').find((b) => b.text().startsWith('★'))!.trigger('click')
    ;(document.querySelector('.csg-bm__apply') as HTMLButtonElement).click()
    await nextTick()
    expect(dataRows(w)).toHaveLength(1)
  })
})

describe('Payload 플로팅 창 / 비교', () => {
  const withPayload = (): LogRecord[] => [
    { id: 'a', host: 'web-01', severity: 'info', message: 'm1', note: '', payload: '{"user":"admin","ok":true}' },
    { id: 'b', host: 'web-02', severity: 'high', message: 'm2', note: '', payload: '{"ok":true,"user":"root"}' },
    { id: 'c', host: 'db-01', severity: 'low', message: 'm3', note: '' },
  ]

  it('상세 Payload 탭의 새 창 버튼 → 플로팅 창 + 작업표시줄', async () => {
    const w = mk({ rows: withPayload() })
    await dataRows(w)[0].trigger('dblclick')
    await w.find('.csg-detail__openwin').trigger('click')
    expect(w.findAll('.csg-win')).toHaveLength(1)
    expect(w.find('.csg-win__title').text()).toBe('web-01 · info')
    expect(w.find('.csg-win .csg-payload__body').text()).toContain('"user": "admin"')
    expect(w.find('.csg-windock').text()).toContain('창 1')
    // 같은 행은 중복으로 열지 않고 앞으로 가져온다
    await w.find('.csg-detail__openwin').trigger('click')
    expect(w.findAll('.csg-win')).toHaveLength(1)
  })

  it('Shift+Enter 로 열고, 최소화/최대화/닫기', async () => {
    const w = mk({ rows: withPayload() })
    const grid = w.find('.csg-scroll')
    await grid.trigger('keydown', { key: 'ArrowDown' })
    await grid.trigger('keydown', { key: 'Enter', shiftKey: true })
    const win = () => w.find('.csg-win')
    expect(win().exists()).toBe(true)
    await win().find('[aria-label="최대화"]').trigger('click')
    expect(win().classes()).toContain('csg-win--max')
    await win().find('[aria-label="최소화"]').trigger('click')
    expect((win().element as HTMLElement).style.display).toBe('none')
    await w.find('.csg-windock__item').trigger('click')
    expect((win().element as HTMLElement).style.display).toBe('')
    await win().find('[aria-label="닫기"]').trigger('click')
    expect(w.find('.csg-win').exists()).toBe(false)
    expect(w.find('.csg-windock').exists()).toBe(false)
  })

  it('제목줄 드래그로 이동', async () => {
    const w = mk({ rows: withPayload() })
    ;(w.vm as unknown as { openPayloadWindow: (r: LogRecord) => void }).openPayloadWindow(withPayload()[0])
    await nextTick()
    const el = w.find('.csg-win').element as HTMLElement
    const x0 = parseInt(el.style.left)
    const bar = w.find('.csg-win__bar').element
    bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0, bubbles: true }))
    bar.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 130, bubbles: true }))
    bar.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await nextTick()
    expect(parseInt(el.style.left)).toBe(x0 + 60)
  })

  it('선택 2건 → Payload 비교(diff) 창, 키 순서 무시 후 변경 1줄', async () => {
    const w = mk({ rows: withPayload() })
    await dataRows(w)[0].find('.csg-check').trigger('click')
    await dataRows(w)[1].find('.csg-check').trigger('click')
    await w.findAll('.csg-selbar .csg-link-btn').find((b) => b.text().includes('Payload 비교'))!.trigger('click')
    const diff = w.find('.csg-win .csg-diff')
    expect(diff.exists()).toBe(true)
    expect(diff.findAll('.csg-diff__stats > span').map((s) => s.text())).toEqual(['+0', '−0', '~1'])
    expect(diff.find('.csg-diff__row--change .csg-diff__mark').text()).toBe('admin')
  })

  it('창의 ⇄ 버튼 두 번으로 비교, 작업표시줄 나란히 보기', async () => {
    const w = mk({ rows: withPayload() })
    await dataRows(w)[0].find('.csg-check').trigger('click')
    await dataRows(w)[1].find('.csg-check').trigger('click')
    await w.findAll('.csg-selbar .csg-link-btn').find((b) => b.text().includes('새 창으로'))!.trigger('click')
    expect(w.findAll('.csg-win')).toHaveLength(2)
    const cmp = w.findAll('.csg-win__cmp')
    await cmp[0].trigger('click')
    expect(cmp[0].classes()).toContain('csg-win__cmp--on')
    await cmp[1].trigger('click')
    expect(w.findAll('.csg-win')).toHaveLength(3)
    expect(w.findAll('.csg-diff')).toHaveLength(1)
    await w.findAll('.csg-windock .csg-link-btn').find((b) => b.text() === '모두 닫기')!.trigger('click')
    expect(w.find('.csg-win').exists()).toBe(false)
  })
})

describe('상세 팝업 / 그룹 차트', () => {
  it('상세 패널을 팝업(모달)으로 전환', async () => {
    const w = mk()
    await dataRows(w)[0].trigger('click')
    await w.find('.csg-detail__mode').trigger('click')
    expect(w.find('.csg-modal [role="dialog"]').exists()).toBe(true)
    expect(w.find('.csg-side').exists()).toBe(false)
    await w.find('.csg').trigger('keydown', { key: 'Escape' })
    expect(w.find('.csg-modal').exists()).toBe(false)
  })

  it('2단계 그룹 차트: 누적 막대 + 범례', async () => {
    const w = mk({ groupBy: ['host', 'severity'] })
    await w.findAll('.csg-groupbar .csg-link-btn').find((b) => b.text().includes('차트'))!.trigger('click')
    expect(w.findAll('.csg-chart__row')).toHaveLength(3)
    expect(w.findAll('.csg-chart__legend li').map((l) => l.text()).sort()).toEqual(['critical', 'high', 'info'])
    expect(w.findAll('.csg-chart__seg')).toHaveLength(3)
    await w.findAll('.csg-chart__row')[0].trigger('click')
    expect(w.findAll('.csg-group')).toHaveLength(4)
  })
})
