// 매뉴얼용 스크린샷 캡처 (Edge headless, playground 가 http://localhost:5173 에서 실행 중이어야 함)
//   npm run manual:shots
const { chromium } = require('playwright-core')
const path = require('path')
const out = process.argv[2]
const URL = 'http://localhost:5173/'

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1.5, colorScheme: 'light' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const shot = (name, clip) => page.screenshot({ path: path.join(out, `${name}.png`), ...(clip ? { clip } : {}) })
  const box = async (sel) => page.locator(sel).first().boundingBox()
  /** 여러 요소를 감싸는 영역 + 여백 */
  const around = async (sels, pad = 8, extra = {}) => {
    const bs = (await Promise.all(sels.map(box))).filter(Boolean)
    const x = Math.max(0, Math.min(...bs.map((b) => b.x)) - pad)
    const y = Math.max(0, Math.min(...bs.map((b) => b.y)) - pad)
    const r = Math.min(1440, Math.max(...bs.map((b) => b.x + b.width)) + pad)
    const btm = Math.min(860, Math.max(...bs.map((b) => b.y + b.height)) + pad)
    return { x, y, width: (extra.width ?? r - x), height: (extra.height ?? btm - y) }
  }
  const wait = (ms) => page.waitForTimeout(ms)
  const input = page.locator('.csg-search__input')
  const rows = page.locator('.csg-body .csg-tr')
  const search = async (q) => {
    await input.fill(q)
    await input.press('Enter')
    await wait(700)
  }

  await page.goto(URL)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.csg-body .csg-tr')
  await wait(600)

  // 00 화면 구성 (번호 표시)
  await search('sourcetype=nginx:access')
  await rows.nth(2).locator('.csg-check').click()
  await rows.nth(3).locator('.csg-check').click()
  await rows.nth(1).click()
  await page.locator('.csg-tabs__btn', { hasText: 'Payload' }).click().catch(() => {})
  await rows.nth(1).click({ button: 'right' })
  await page.locator('.csg-menu__item', { hasText: 'Payload 새 창으로' }).click()
  await page.locator('.csg-win [aria-label="최소화"]').click()
  await wait(300)
  await page.evaluate(() => {
    const marks = [
      ['.csg-toolbar', '1'],
      ['.csg-groupbar', '2'],
      ['.csg-status', '3'],
      ['.csg-selbar', '4'],
      ['.csg-scroll', '5'],
      ['.csg-side', '6'],
      ['.csg-windock', '7'],
    ]
    for (const [sel, n] of marks) {
      const el = document.querySelector(sel)
      if (!el) continue
      const r = el.getBoundingClientRect()
      const box = document.createElement('div')
      Object.assign(box.style, {
        position: 'fixed', left: `${r.left + 1}px`, top: `${r.top + 1}px`, width: `${r.width - 2}px`, height: `${r.height - 2}px`,
        border: '2px dashed #e5484d', borderRadius: '4px', zIndex: 5000, pointerEvents: 'none',
      })
      const badge = document.createElement('div')
      badge.textContent = n
      Object.assign(badge.style, {
        position: 'fixed', left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: '22px', height: '22px', borderRadius: '50%',
        background: '#e5484d', color: '#fff', font: '700 13px/22px sans-serif', textAlign: 'center', zIndex: 5001,
        boxShadow: '0 1px 3px rgba(0,0,0,.35)',
      })
      document.body.append(box, badge)
    }
  })
  await shot('00-layout')
  await page.reload()
  await page.waitForSelector('.csg-body .csg-tr')
  await wait(600)

  // 02 자동완성 (필드 → 값)
  await input.click()
  await input.type('sev', { delay: 30 })
  await page.waitForSelector('.csg-ac')
  await shot('02a-autocomplete-field', await around(['.csg-toolbar', '.csg-ac'], 8, { width: 1000 }))
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await wait(500)
  await shot('02b-autocomplete-value', await around(['.csg-toolbar', '.csg-ac'], 8, { width: 1000 }))
  await page.keyboard.press('Escape')

  // 03 검색 + 하이라이트
  await search('"Failed password" geo.country=CN')
  await shot('03-search-highlight', { x: 0, y: 120, width: 1440, height: 420 })

  // 04 고급 필터
  await page.locator('.csg-toolbar > button', { hasText: '필터' }).click()
  await page.locator('.csg-fb__foot .csg-link-btn').click()
  const last = page.locator('.csg-fb__row').last()
  await last.locator('select').first().selectOption('dest_port')
  await last.locator('select').nth(1).selectOption('>=')
  await last.locator('input').fill('1024')
  await shot('04-filter-builder', await around(['.csg-toolbar', '.csg-fb']))
  await page.locator('.csg-fb [aria-label="닫기"]').first().click()
  await search('')

  // 05 그룹 + 차트
  await page.locator('.chip', { hasText: 'sourcetype › severity' }).click()
  await page.waitForSelector('.csg-group')
  await page.locator('.csg-groupbar .csg-link-btn', { hasText: '차트' }).click()
  await wait(1200)
  await page.locator('.csg-group').first().click()
  await wait(600)
  await page.locator('.csg-group').nth(1).click()
  await wait(800)
  await page.locator('.csg-chart__seg').nth(1).hover()
  await wait(200)
  await shot('05-group-chart', { x: 0, y: 120, width: 1440, height: 740 })
  await page.mouse.move(5, 5)
  await page.locator('.chip', { hasText: '해제' }).click()
  await wait(700)

  // 06 컬럼 메뉴
  await page.locator('.csg-dd > button', { hasText: '컬럼' }).click()
  {
    const pb = await box('.csg-dd__panel')
    const tb = await box('.csg-toolbar')
    const x = Math.max(0, pb.x - 380)
    await shot('06-column-chooser', { x, y: tb.y - 4, width: Math.min(1440 - x, pb.x + pb.width + 12 - x), height: pb.y + pb.height + 10 - tb.y })
  }
  await page.keyboard.press('Escape')

  // 07 헤더 메뉴
  await page.locator('.csg-th:not(.csg-th--lead)').nth(2).click({ button: 'right' })
  {
    const mb2 = await box('.csg-menu')
    const hb = await box('.csg-header')
    const x = Math.max(0, mb2.x - 260)
    await shot('07-header-menu', { x, y: hb.y - 4, width: mb2.width + 520, height: mb2.y + mb2.height + 12 - hb.y })
  }
  await page.keyboard.press('Escape')

  // 08 셀 메뉴
  await rows.nth(3).locator('.csg-td:not(.csg-td--lead)').nth(3).click({ button: 'right' })
  const mb = await box('.csg-menu')
  await shot('08-cell-menu', { x: Math.max(0, mb.x - 420), y: Math.max(0, mb.y - 120), width: mb.width + 600, height: Math.min(860 - Math.max(0, mb.y - 120), mb.height + 140) })
  await page.keyboard.press('Escape')

  // 09 다중 선택
  await rows.nth(1).locator('.csg-check').click()
  await rows.nth(3).locator('.csg-check').click()
  await rows.nth(5).locator('.csg-check').click({ modifiers: ['Shift'] })
  await shot('09-selection', { x: 0, y: 200, width: 1440, height: 360 })
  await page.locator('.csg-selbar .csg-link-btn', { hasText: '선택 해제' }).click()

  // 10 상세 - 필드
  await search('sourcetype=nginx:access "POST /login"')
  await rows.nth(0).click()
  await wait(300)
  await shot('10-detail-fields')
  // 11 상세 - payload
  await page.locator('.csg-tabs__btn', { hasText: 'Payload' }).click()
  await wait(200)
  await shot('11-detail-payload', await around(['.csg-side'], 0))
  // 12 모달
  await page.locator('.csg-detail__mode').click()
  await wait(300)
  await shot('12-detail-modal')
  await page.keyboard.press('Escape')
  await wait(200)
  // 패널 모드 복귀
  await rows.nth(0).click()
  await page.locator('.csg-detail__mode').click()
  await page.locator('.csg-detail [aria-label="닫기"]').click()

  // 13 플로팅 창 + 나란히
  await search('sourcetype=nginx:access "GET /login"')
  await rows.nth(0).locator('.csg-check').click()
  await rows.nth(1).locator('.csg-check').click()
  await page.locator('.csg-selbar .csg-link-btn', { hasText: '새 창으로' }).click()
  await wait(400)
  await shot('13-windows-tiled')
  // 14 비교
  await page.locator('.csg-win__cmp').nth(0).click()
  await page.locator('.csg-win__cmp').nth(1).click()
  await wait(500)
  {
    const db = await box('.csg-win--active')
    await shot('14-diff', { x: db.x, y: db.y, width: db.width, height: Math.min(db.height, 330) })
  }
  await page.locator('.csg-windock .csg-link-btn', { hasText: '모두 닫기' }).click()
  await page.locator('.csg-selbar .csg-link-btn', { hasText: '선택 해제' }).click()

  // 15 즐겨찾기
  await search('severity=critical')
  await search('sourcetype=linux_secure action=failure')
  await page.locator('.csg-dd > button', { hasText: '★' }).click()
  await page.locator('.csg-bm__save input').fill('SSH 로그인 실패')
  await page.locator('.csg-bm__save button').click()
  await wait(200)
  await page.locator('.csg-dd > button', { hasText: '★' }).click()
  await shot('15-bookmarks', await around(['.csg-dd__panel', '.csg-toolbar']))
  await page.keyboard.press('Escape')

  // 16 줄바꿈
  await search('sourcetype=wineventlog')
  await page.locator('.csg-toolbar button', { hasText: '줄바꿈' }).click()
  await page.locator('.csg-scroll').evaluate((el) => (el.scrollLeft = 900))
  await wait(400)
  await shot('16-wrap', { x: 0, y: 200, width: 1440, height: 520 })
  await page.locator('.csg-scroll').evaluate((el) => (el.scrollLeft = 0))
  await page.locator('.csg-toolbar button', { hasText: '줄바꿈' }).click()

  // 17 고정 컬럼
  await page.locator('.csg-th:not(.csg-th--lead)').nth(2).click({ button: 'right' })
  await page.locator('.csg-menu__item', { hasText: '좌측 고정' }).click()
  await page.locator('.csg-scroll').evaluate((el) => (el.scrollLeft = 700))
  await wait(300)
  await shot('17-frozen', { x: 0, y: 200, width: 1440, height: 380 })
  await page.locator('.csg-scroll').evaluate((el) => (el.scrollLeft = 0))
  await page.locator('.csg-th--frozen:not(.csg-th--lead)').click({ button: 'right' })
  await page.locator('.csg-menu__item', { hasText: '고정 해제' }).click()

  // 18 셀 편집
  const triageIdx = await page.$$eval('.csg-th:not(.csg-th--lead) .csg-th__label', (els) => els.findIndex((e) => e.textContent.includes('Triage')))
  await rows.nth(1).locator('.csg-td:not(.csg-td--lead)').nth(triageIdx).scrollIntoViewIfNeeded()
  await rows.nth(1).locator('.csg-td:not(.csg-td--lead)').nth(triageIdx).dblclick()
  await page.locator('.csg-cell-input').fill('조사 중 - 담당 김민수')
  const cb = await box('.csg-cell-input')
  await shot('18-cell-edit', { x: Math.max(0, cb.x - 700), y: Math.max(0, cb.y - 120), width: Math.min(1440, 1000), height: 220 })
  await page.keyboard.press('Enter')

  // 19 다크 모드
  await search('')
  await page.locator('button.ghost').click()
  await wait(500)
  await shot('19-dark')

  console.log('errors:', errors.length ? errors.join('\n') : 'none')
  await browser.close()
})().catch((e) => {
  console.error('FAILED', e.message.split('\n')[0])
  process.exit(1)
})
