/**
 * COD-SEARCHGRID 매뉴얼(.docx) 생성 스크립트
 *   node docs/manual/build-manual.cjs
 * 스크린샷: docs/manual/images/*.png (playground 기준)
 */
const fs = require('fs')
const path = require('path')
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} = require('docx')

const IMG_DIR = path.join(__dirname, 'images')
const OUT = path.join(__dirname, 'COD-SEARCHGRID-Manual-ko.docx')
const VERSION = require('../../package.json').version
const TODAY = '2026-11-09'

const FONT = 'Malgun Gothic'
const MONO = 'Consolas'
const ACCENT = '2F6FDE'
const MUTED = '5E6670'
const CONTENT_W = 9638 // A4(11906) - 좌우 여백 1134*2
const IMG_MAX_PX = 640

// ------------------------------------------------------------------ helpers
const font = (name) => ({ ascii: name, hAnsi: name, eastAsia: FONT, cs: name })

/** `code` 와 **굵게** 를 지원하는 인라인 파서 */
function runs(text, base = {}) {
  return String(text)
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('`'))
        return new TextRun({ ...base, text: part.slice(1, -1), font: font(MONO), size: 19, color: 'B42318', shading: { type: ShadingType.CLEAR, fill: 'F2F4F7', color: 'auto' } })
      if (part.startsWith('**')) return new TextRun({ ...base, text: part.slice(2, -2), bold: true })
      return new TextRun({ ...base, text: part })
    })
}

const P = (text, opts = {}) => new Paragraph({ children: runs(text, opts.run), spacing: { after: 120, line: 300 }, ...opts.para })
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)], pageBreakBefore: true })
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] })
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] })

let listInstance = 0
const bullets = (items, level = 0) =>
  items.map((t) => new Paragraph({ children: runs(t), numbering: { reference: 'bullets', level }, spacing: { after: 60, line: 288 } }))
const steps = (items) => {
  const instance = ++listInstance
  return items.map((t) => new Paragraph({ children: runs(t), numbering: { reference: 'steps', level: 0, instance }, spacing: { after: 60, line: 288 } }))
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD' }
const cellBorders = { top: border, bottom: border, left: border, right: border }

function table(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0)
  if (total !== CONTENT_W) widths = widths.map((w) => Math.round((w / total) * CONTENT_W))
  widths[widths.length - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0)
  const cell = (text, i, head) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      borders: cellBorders,
      shading: head ? { type: ShadingType.CLEAR, fill: 'EEF2F7', color: 'auto' } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: String(text)
        .split('\n')
        .map((line) => new Paragraph({ children: runs(line, { size: 18, bold: head || undefined }), spacing: { after: 0, line: 260 } })),
    })
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
    ],
  })
}
const gap = () => new Paragraph({ children: [], spacing: { after: 120 } })

function code(text) {
  const lines = text.replace(/^\n/, '').replace(/\s+$/, '').split('\n')
  return lines.map(
    (line, i) =>
      new Paragraph({
        children: [new TextRun({ text: line || ' ', font: font(MONO), size: 17 })],
        shading: { type: ShadingType.CLEAR, fill: 'F5F7FA', color: 'auto' },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: 'C9D3E0', space: 6 },
          ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 4, color: 'F5F7FA', space: 2 } } : {}),
          ...(i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'F5F7FA', space: 2 } } : {}),
        },
        spacing: { after: i === lines.length - 1 ? 160 : 0, line: 252 },
        indent: { left: 120 },
        keepLines: true,
        keepNext: i < lines.length - 1,
      }),
  )
}

function note(text, kind = 'tip') {
  const color = kind === 'warn' ? 'B54708' : ACCENT
  const fill = kind === 'warn' ? 'FFF6E5' : 'EEF4FF'
  const label = kind === 'warn' ? '주의  ' : '참고  '
  return new Paragraph({
    children: [new TextRun({ text: label, bold: true, color }), ...runs(text)],
    shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color, space: 8 } },
    indent: { left: 160 },
    spacing: { before: 80, after: 160, line: 288 },
  })
}

function pngSize(file) {
  const b = fs.readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), data: b }
}

let figNo = 0
function figure(name, caption, maxPx = IMG_MAX_PX) {
  const { w, h, data } = pngSize(path.join(IMG_DIR, `${name}.png`))
  // 스크린샷은 1.5배율로 캡처 → 화면 픽셀 기준으로 환산
  const cssW = w / 1.5
  const width = Math.min(maxPx, cssW)
  const height = Math.round((h / w) * width)
  figNo++
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({ type: 'png', data, transformation: { width, height }, altText: { title: caption, description: caption, name } })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: `그림 ${figNo}. ${caption}`, size: 17, color: MUTED })],
    }),
  ]
}

// ------------------------------------------------------------------ content
const cover = [
  new Paragraph({ spacing: { before: 2600 }, children: [] }),
  new Paragraph({ children: [new TextRun({ text: 'COD-SEARCHGRID', bold: true, size: 64, color: ACCENT })], spacing: { after: 120 } }),
  new Paragraph({ children: [new TextRun({ text: '로그 검색 그리드 사용자 · 개발자 매뉴얼', size: 36, bold: true })], spacing: { after: 360 } }),
  new Paragraph({
    children: [new TextRun({ text: 'SIEM / Splunk 스타일 로그 검색 그리드 — Vue 3 컴포넌트 라이브러리', size: 24, color: MUTED })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 12 } },
    spacing: { after: 600 },
  }),
  table(
    ['항목', '내용'],
    [
      ['문서 버전', `${VERSION} (라이브러리 버전 기준)`],
      ['작성일', TODAY],
      ['저장소', 'https://github.com/KOSUKJUN/COD-SEARCHGRID (Private)'],
      ['대상 독자', '1부: 그리드를 사용하는 보안 분석가 · 운영자\n2부: 그리드를 프로젝트에 적용하는 개발자'],
    ],
    [2200, 7438],
  ),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ children: [new TextRun({ text: '목차', bold: true, size: 32 })], spacing: { after: 200 } }),
  new TableOfContents('목차', { hyperlink: true, headingStyleRange: '1-2' }),
]

const overview = [
  H1('1. 개요'),
  H2('1.1 COD-SEARCHGRID 란'),
  P('COD-SEARCHGRID 는 SIEM·Splunk 처럼 대량의 보안 로그를 검색하고 분석하기 위한 **검색 그리드 컴포넌트**입니다. Vue 3 라이브러리 형태로 제공되어 각 프로젝트에서 가져가 화면에 배치하고, 검색 API 만 연결하면 바로 사용할 수 있습니다.'),
  P('수십만 건의 이벤트를 끊김 없이 스크롤하는 가상 스크롤, Splunk 와 비슷한 검색 문법, 그룹핑·차트, payload 분석 및 비교 기능을 하나의 컴포넌트에서 제공합니다.'),
  H2('1.2 주요 기능 한눈에 보기'),
  table(
    ['분류', '기능'],
    [
      ['검색', 'SPL 스타일 검색 문법, 검색어 하이라이트, 자동완성(필드·값), 고급 필터 UI, 검색 기록, 즐겨찾기'],
      ['표시', '가상 스크롤(대용량), 무한 스크롤(원격), 정렬, 컬럼 폭 조절·자동 맞춤, 줄바꿈(행 높이 자동), 행 번호, 라이트/다크 테마'],
      ['컬럼', '숨김/표시, 드래그 재배치, 좌측 고정(frozen), 설정 자동 저장·복원'],
      ['그룹', '다단계 Group by(헤더 드래그), 그룹별 건수·비율, 그룹 분포 차트(누적 막대)'],
      ['선택·작업', '체크박스·전체·Shift 범위·Ctrl 토글 선택, 행/값/JSON 복사, CSV·JSON 내보내기, 사용자 정의 일괄 작업'],
      ['상세·Payload', '필드 목록에서 바로 검색 조건 추가/제외, Payload 뷰어(Text/JSON/Hex, base64·hex 디코딩), 팝업 보기'],
      ['Payload 창·비교', '그리드 내부 플로팅 창(여러 개 동시), 나란히 보기, 두 payload Diff 비교'],
      ['편의', '우클릭 컨텍스트 메뉴, 키보드 단축키, 셀 편집, 진행률 표시, 접근성(ARIA)'],
    ],
    [1900, 7738],
  ),
  H2('1.3 화면 구성'),
  ...figure('00-layout', '화면 구성 (playground — 번호는 아래 표 참고)'),
  table(
    ['영역', '설명'],
    [
      ['① 툴바', '검색창, 검색 버튼, ★ 즐겨찾기/최근 검색, 필터, 컬럼, 내보내기, 줄바꿈'],
      ['② Group by 패널', '컬럼 헤더를 끌어다 놓아 그룹핑. 그룹이 있으면 차트·모두 펼치기/접기 버튼 표시'],
      ['③ 상태 표시줄', '검색 결과 건수, 처리 시간, 로드 진행률(원격), 오류, 키보드 단축키 안내(⌨ 아이콘에 마우스 올림)'],
      ['④ 선택 바', '행을 선택하면 나타남. 복사·CSV·JSON·Payload 새 창/비교·사용자 정의 작업'],
      ['⑤ 그리드', '체크박스, 행 번호, 데이터 컬럼. 헤더 클릭=정렬, 우클릭=메뉴'],
      ['⑥ 상세 패널', '행 클릭 시 오른쪽에 열림. 필드 / Payload / JSON 탭'],
      ['⑦ 창 작업표시줄', 'Payload 창을 열면 화면 아래에 나타남. 창 전환·나란히 보기·모두 닫기'],
    ],
    [2000, 7638],
  ),
]

const userGuide = [
  H1('2. 사용자 가이드'),
  P('이 장은 그리드를 사용해 로그를 검색·분석하는 사용자를 위한 안내입니다. 화면은 개발용 playground 기준이며, 실제 적용 화면은 프로젝트마다 컬럼과 버튼 구성이 다를 수 있습니다.'),

  H2('2.1 검색하기'),
  P('검색창에 검색어를 입력하고 **Enter** 또는 **검색** 버튼을 누릅니다. 공백으로 구분한 조건은 모두 만족(AND)해야 합니다. 검색어와 일치하는 부분은 그리드와 상세 패널에서 노란색으로 강조됩니다.'),
  table(
    ['문법', '예시', '의미'],
    [
      ['단어', '`error`', '모든 필드에서 포함 여부 검색 (대소문자 무시)'],
      ['"구문"', '`"connection refused"`', '띄어쓰기를 포함한 구문 그대로 검색'],
      ['필드=값', '`host=web-01`', '필드 값이 일치 (대소문자 무시)'],
      ['와일드카드', '`host=web-*`', '`*` 는 임의의 문자열'],
      ['필드!=값', '`severity!=info`', '필드 값이 일치하지 않음'],
      ['비교', '`dest_port>=1024`', '>, >=, <, <= 사용 (숫자면 숫자로, 아니면 문자열로 비교)'],
      ['NOT', '`NOT blocked`', '다음 조건을 제외. `NOT port>=1024` 처럼 필드 조건은 연산자가 반전됨'],
      ['값 있음/없음', '`user=*` / `user!=*`', '필드에 값이 있는/없는 이벤트'],
      ['중첩 필드', '`geo.country=KR`', '점(.)으로 하위 필드 지정'],
    ],
    [1700, 2600, 5338],
  ),
  gap(),
  ...figure('03-search-highlight', '구문 + 필드 조건 검색과 검색어 하이라이트 ("Failed password" geo.country=CN)'),
  note('OR 조건과 괄호는 현재 지원하지 않습니다. 여러 값을 보려면 그룹핑이나 와일드카드를 활용하세요.'),

  H2('2.2 검색 자동완성'),
  P('검색창에 입력하는 동안 커서 위치의 단어를 기준으로 제안 목록이 나타납니다.'),
  ...bullets([
    '필드명 일부를 입력하면 **필드** 제안이 나타납니다. 선택하면 `필드=` 까지 입력됩니다.',
    '`필드=` 다음에는 해당 필드의 **값** 제안이 나타납니다. 값은 데이터에서 많이 나오는 순서입니다.',
    '검색창이 비어 있으면 **즐겨찾기**와 **최근 검색**이 제안됩니다.',
    '↑/↓ 로 이동, **Enter** 또는 **Tab** 으로 적용, **Esc** 로 닫습니다.',
  ]),
  ...figure('02a-autocomplete-field', '필드명 제안', 560),
  ...figure('02b-autocomplete-value', '필드 값 제안 (sourcetype 선택 후)', 560),

  H2('2.3 고급 필터'),
  P('검색 문법을 몰라도 조건을 만들 수 있는 화면입니다. 툴바의 **필터** 버튼을 누르면 열리며, 현재 검색어가 조건 목록으로 자동 변환되어 표시됩니다. 적용된 조건 수는 버튼 옆 숫자로 표시됩니다.'),
  ...steps([
    '**필터** 버튼을 누릅니다.',
    '**+ 조건 추가** 로 줄을 추가하고 필드 · 연산자 · 값을 선택합니다. 값 입력란은 자주 나오는 값을 제안합니다.',
    '위쪽에 미리보기로 만들어질 검색어가 표시됩니다.',
    '**적용** 을 누르면 검색어로 변환되어 검색됩니다.',
  ]),
  table(
    ['연산자', '설명'],
    [
      ['= / ≠', '일치 / 불일치'],
      ['포함 / 미포함', '값의 일부 포함 (`host=*web*` 로 변환)'],
      ['> ≥ < ≤', '크기 비교'],
      ['값 있음 / 값 없음', '필드 존재 여부'],
      ['(전체 텍스트) 텍스트 포함/제외', '필드를 지정하지 않고 모든 필드에서 검색'],
    ],
    [3200, 6438],
  ),
  gap(),
  ...figure('04-filter-builder', '고급 필터 — 현재 검색어를 조건으로 불러와 수정'),

  H2('2.4 검색 기록과 즐겨찾기'),
  P('툴바의 **★** 버튼을 누르면 즐겨찾기와 최근 검색이 표시됩니다.'),
  ...bullets([
    '**저장**: 현재 검색어(그룹핑 설정 포함)를 이름을 붙여 즐겨찾기에 저장합니다. 이름을 비우면 검색어가 이름이 됩니다.',
    '**적용**: 즐겨찾기를 누르면 검색어와 그룹핑이 함께 적용됩니다. × 로 삭제합니다.',
    '**최근 검색**: 실행한 검색어가 최근 30개까지 자동 기록됩니다. **기록 지우기** 로 삭제할 수 있습니다.',
  ]),
  ...figure('15-bookmarks', '즐겨찾기 · 최근 검색', 560),
  note('기록·즐겨찾기·컬럼 설정은 브라우저(localStorage)에 저장됩니다. 다른 PC나 브라우저와는 공유되지 않습니다. (개발자가 서버 저장으로 확장 가능)'),

  H2('2.5 정렬과 컬럼 관리'),
  H3('정렬'),
  P('컬럼 헤더를 클릭하면 **오름차순 → 내림차순 → 해제** 순으로 바뀝니다. 헤더에 ▲/▼ 가 표시됩니다.'),
  H3('폭 조절과 자동 맞춤'),
  P('헤더 오른쪽 경계를 드래그해 폭을 조절합니다. 경계를 **더블클릭**하거나 헤더 메뉴의 **폭 자동 맞춤**을 누르면 내용에 맞게 폭이 조정됩니다.'),
  H3('숨기기 · 순서 변경 · 좌측 고정'),
  ...bullets([
    '툴바 **컬럼** 메뉴: 체크박스로 표시/숨김, ⋮⋮ 를 끌거나 ↑↓ 로 순서 변경, 📌 로 좌측 고정. **모두 표시** / **컬럼 초기화** 제공.',
    '헤더를 다른 헤더 위로 끌어다 놓으면 순서가 바뀝니다 (파란 세로선이 놓일 위치).',
    '헤더 **우클릭** 메뉴: 정렬, 그룹핑, 좌측 고정/해제, 컬럼 숨기기, 폭 자동 맞춤, 컬럼 초기화.',
    '**좌측 고정** 컬럼은 가로로 스크롤해도 체크박스·행 번호와 함께 왼쪽에 고정됩니다.',
  ]),
  ...figure('06-column-chooser', '컬럼 메뉴 — 표시/숨김, 고정, 순서', 560),
  ...figure('07-header-menu', '헤더 우클릭 메뉴', 560),
  ...figure('17-frozen', '좌측 고정된 Host 컬럼 (가로 스크롤 상태)'),

  H2('2.6 그룹핑과 그룹 분포 차트'),
  P('특정 필드의 값별로 이벤트를 묶어 건수와 비율을 확인합니다. Splunk 의 `stats count by` 와 같은 용도입니다.'),
  ...steps([
    '컬럼 헤더를 **Group by 패널**(검색창 아래)로 끌어다 놓습니다. 또는 패널의 **+ 그룹 추가** 목록에서 선택하거나, 헤더 우클릭 → **이 컬럼으로 그룹핑**.',
    '여러 컬럼을 추가하면 다단계로 묶입니다 (예: Sourcetype › Severity). 칩을 끌어 순서를 바꾸고 × 로 해제합니다.',
    '그룹 행을 클릭(또는 → / ← 키)하면 펼치거나 접습니다. 그룹 행에는 값, 건수, 상위 그룹 대비 비율 막대가 표시됩니다.',
    '패널 오른쪽 **▸ 차트** 를 누르면 그룹 분포 차트가 열립니다. 2단계 그룹이면 누적 막대로 표시되며, 막대에 마우스를 올리면 건수·비율, 막대를 클릭하면 해당 그룹으로 이동합니다.',
  ]),
  ...figure('05-group-chart', 'Sourcetype › Severity 2단계 그룹과 분포 차트'),
  note('원격(서버) 검색에서는 그룹을 펼칠 때 해당 그룹 조건으로 서버에 다시 요청합니다. 대량 요청을 막기 위해 원격 모드에서는 "모두 펼치기"가 제공되지 않습니다.'),

  H2('2.7 행 선택 · 복사 · 내보내기'),
  table(
    ['동작', '방법'],
    [
      ['한 행 선택/해제', '행 앞 체크박스 클릭, Ctrl+클릭, Space 키'],
      ['범위 선택', '첫 행 선택 후 Shift+클릭 (또는 Shift+↑/↓)'],
      ['전체 선택', '헤더 체크박스, Ctrl+A'],
      ['복사', 'Ctrl+C 또는 선택 바의 행 복사 — 엑셀에 바로 붙여넣을 수 있는 형식(TSV)'],
      ['내보내기', '선택 바의 CSV/JSON 또는 툴바 내보내기 메뉴(전체/선택). CSV 는 엑셀에서 한글이 깨지지 않도록 저장'],
    ],
    [2400, 7238],
  ),
  gap(),
  ...figure('09-selection', '다중 선택과 선택 바'),
  note('원격(서버) 검색에서 "전체" 내보내기는 현재까지 화면에 불러온 행만 포함합니다. 스크롤해서 더 불러오면 함께 내보내집니다.', 'warn'),

  H2('2.8 우클릭 메뉴'),
  P('셀을 우클릭하면 해당 값과 행에 대한 작업 메뉴가 나타납니다. 키보드에서는 **Shift+F10** 또는 메뉴 키를 사용합니다.'),
  ...bullets([
    '값 복사 / 행 복사 / JSON 으로 복사 (여러 행이 선택된 상태면 선택 행 전체)',
    '이 값으로 검색 / 이 값 제외 — 검색어에 조건이 바로 추가되어 재검색',
    '이 컬럼으로 그룹핑, 셀 편집(편집 가능한 컬럼)',
    '선택, 상세 보기, Payload 보기, 팝업으로 보기, Payload 새 창으로 열기, Payload 비교(2건 선택 시)',
    '프로젝트에 따라 "티켓 생성" 같은 사용자 정의 메뉴가 추가될 수 있습니다.',
  ]),
  ...figure('08-cell-menu', '셀 우클릭 메뉴', 560),

  H2('2.9 이벤트 상세 보기'),
  P('행을 클릭하면 오른쪽에 상세 패널이 열립니다. 같은 행을 다시 클릭하거나 ✕ 로 닫습니다. 패널 왼쪽 경계를 드래그해 폭을 조절할 수 있습니다.'),
  ...bullets([
    '**필드** 탭: 모든 필드와 값. 값 옆 **+** 는 이 값으로 검색, **−** 는 이 값 제외.',
    '**Payload** 탭: 원본 payload (2.10 참고). payload 가 없는 이벤트는 탭이 표시되지 않습니다.',
    '**JSON** 탭: 이벤트 전체를 JSON 으로 표시.',
    '**⤢** 버튼: 큰 팝업(모달)으로 전환. 팝업에서 ⇥ 로 다시 패널로 돌아옵니다. 마지막 방식이 기억됩니다.',
    '상세가 열린 상태에서 ↑/↓ 로 행을 이동하면 상세 내용도 따라 바뀝니다.',
  ]),
  ...figure('10-detail-fields', '상세 패널 — 필드 탭'),
  ...figure('12-detail-modal', '상세 팝업(모달) 보기'),

  H2('2.10 Payload 보기'),
  P('행을 **더블클릭**하면 상세 패널의 Payload 탭이 바로 열립니다. payload 형식은 자동으로 판별됩니다.'),
  table(
    ['보기', '설명'],
    [
      ['Text', '원문 그대로. HTTP 요청, Windows 이벤트 XML 등. 줄바꿈 on/off 가능'],
      ['JSON', 'JSON 이면 들여쓰기 정리하여 표시 (JSON 일 때만 표시)'],
      ['Hex', '오프셋 · 16진수 · ASCII 형식의 hex dump. 바이너리(패킷 등)는 기본으로 Hex 로 열림'],
    ],
    [1600, 8038],
  ),
  gap(),
  P('base64·hex 로 인코딩된 payload 는 자동으로 디코딩합니다. 상단에 인코딩과 크기가 표시되며 **복사** 버튼으로 현재 보기 내용을 복사합니다.'),
  ...figure('11-detail-payload', 'Payload 탭 — POST 요청 JSON', 420),

  H2('2.11 Payload 새 창과 비교'),
  P('여러 이벤트의 payload 를 동시에 띄워 비교할 수 있습니다. 브라우저 새 창이 아니라 **그리드 화면 안에 떠 있는 창**이며, 자유롭게 이동·크기 조절할 수 있습니다.'),
  H3('창 열기'),
  ...bullets([
    '상세 패널 Payload 탭의 **⧉ 새 창** 버튼',
    '행 우클릭 → **Payload 새 창으로 열기**, 또는 행에서 **Shift+Enter**',
    '여러 행 선택 → 선택 바의 **선택 n건 Payload 새 창으로** (자동으로 나란히 배치)',
  ]),
  H3('창 다루기'),
  table(
    ['동작', '방법'],
    [
      ['이동', '제목줄 드래그 (키보드: Alt+방향키)'],
      ['크기 조절', '창 가장자리/모서리 드래그 (키보드: Alt+Shift+방향키)'],
      ['최대화 / 복원', '□ 버튼 또는 제목줄 더블클릭'],
      ['최소화', '– 버튼. 작업표시줄에서 다시 열기'],
      ['닫기', '✕ 버튼 또는 창 안에서 Esc'],
      ['정렬', '작업표시줄의 나란히 보기 / 계단식 / 모두 닫기'],
    ],
    [2400, 7238],
  ),
  gap(),
  ...figure('13-windows-tiled', '두 Payload 창을 나란히 보기'),
  H3('두 Payload 비교 (Diff)'),
  P('두 payload 의 차이를 좌우로 정렬해 보여줍니다. 비교 창을 여는 방법은 다음과 같습니다.'),
  ...bullets([
    '두 창의 제목줄 **⇄** 버튼을 차례로 누름',
    '2건 선택 → 선택 바 또는 우클릭 메뉴의 **Payload 비교**',
    '작업표시줄의 **⇄ 비교** (가장 최근에 본 두 창)',
  ]),
  table(
    ['표시 / 옵션', '설명'],
    [
      ['색상', '빨강=삭제, 초록=추가, 노랑=변경. 변경된 줄 안에서 실제로 달라진 부분은 진하게 강조'],
      ['+n −n ~n', '추가 / 삭제 / 변경된 줄 수'],
      ['↑ ↓', '이전 / 다음 변경 위치로 이동'],
      ['변경만', '같은 줄을 접어서 변경 부분만 표시 (접힌 줄 클릭 시 펼침)'],
      ['공백 무시', '공백 차이를 무시하고 비교'],
      ['Auto / Text / Hex', 'Auto: JSON 은 키 순서를 정렬한 뒤 비교, 바이너리는 Hex 로 비교'],
      ['⇆', '좌우 바꾸기'],
    ],
    [2400, 7238],
  ),
  gap(),
  ...figure('14-diff', 'Payload 비교 — User-Agent, X-Forwarded-For 차이 강조'),
  note('창은 동시에 최대 12개까지 열리며, 넘으면 가장 오래된 창이 닫힙니다. 열린 창이 그리드를 가리면 최소화하거나 옮겨 주세요. 키보드 이동은 창이 떠 있어도 동작합니다.'),

  H2('2.12 줄바꿈 (행 높이 자동)'),
  P('툴바의 **↵ 줄바꿈** 을 켜면 긴 값이 셀 안에서 줄바꿈되고 행 높이가 내용에 맞게 늘어납니다. 메시지가 긴 로그를 훑어볼 때 유용합니다. 끄면 한 줄로 표시되고 잘린 내용은 마우스를 올리면 툴팁으로 보입니다.'),
  ...figure('16-wrap', '줄바꿈 모드 — 긴 메시지가 여러 줄로 표시됨'),

  H2('2.13 셀 편집'),
  P('편집이 허용된 컬럼(예: Triage)은 셀을 **더블클릭**하거나 행에 포커스를 두고 **F2** 를 눌러 편집합니다. **Enter** 로 저장, **Esc** 로 취소합니다. 편집 가능한 셀은 클릭해도 상세 패널이 열리지 않습니다.'),
  ...figure('18-cell-edit', '셀 편집', 560),
  note('편집 내용을 서버에 저장하는 방식은 적용 프로젝트에 따라 다릅니다.'),

  H2('2.14 진행률 표시와 테마'),
  ...bullets([
    '원격 검색 시 상태 표시줄에 `로드 200 / 50,000` 처럼 불러온 건수와 진행 막대가 표시되고, 스크롤하면 다음 페이지를 자동으로 불러옵니다.',
    '불러오는 동안 상태 표시줄 아래에 파란 진행선이 움직입니다. 그룹을 펼칠 때는 그룹 아래에 불러온 건수가 표시됩니다.',
    '라이트/다크 테마를 지원합니다 (적용 프로젝트의 설정을 따름).',
  ]),
  ...figure('19-dark', '다크 테마'),

  H2('2.15 키보드 단축키'),
  P('그리드를 한 번 클릭해 포커스를 둔 뒤 사용합니다. 상태 표시줄의 ⌨ 아이콘에 마우스를 올려도 요약을 볼 수 있습니다.'),
  table(
    ['키', '동작'],
    [
      ['↑ / ↓', '행 이동 (상세가 열려 있으면 상세도 함께 이동)'],
      ['PageUp / PageDown, Home / End', '한 화면 / 처음·끝으로 이동'],
      ['Shift + ↑ / ↓ / PageUp / PageDown', '범위 선택'],
      ['→ / ←', '그룹 행 펼치기 / 접기'],
      ['Enter', '상세 보기 (그룹 행: 펼치기/접기)'],
      ['Shift + Enter', 'Payload 새 창으로 열기'],
      ['Space', '행 선택 / 해제'],
      ['Ctrl + A', '전체 선택'],
      ['Ctrl + C', '선택한 행 복사 (선택이 없으면 현재 행)'],
      ['F2', '셀 편집'],
      ['Esc', '상세 닫기 → 선택 해제 / 팝업·창·메뉴 닫기'],
      ['Shift + F10, 메뉴 키', '우클릭 메뉴 열기'],
      ['/', '검색창으로 이동'],
      ['검색창: ↓, Enter/Tab, Esc', '자동완성 열기, 적용, 닫기'],
      ['Payload 창: Alt + 방향키 / Alt + Shift + 방향키', '창 이동 / 크기 조절'],
    ],
    [4000, 5638],
  ),
  gap(),
  table(
    ['마우스', '동작'],
    [
      ['클릭', '상세 보기 (같은 행 다시 클릭 시 닫힘)'],
      ['Ctrl + 클릭 / Shift + 클릭', '선택 토글 / 범위 선택'],
      ['더블클릭', 'Payload 탭 열기 (편집 가능한 셀은 편집)'],
      ['헤더 클릭 / 헤더 드래그', '정렬 / 순서 변경 또는 Group by 패널에 놓아 그룹핑'],
      ['헤더 경계 드래그 / 더블클릭', '폭 조절 / 폭 자동 맞춤'],
      ['우클릭', '셀·헤더 메뉴'],
    ],
    [4000, 5638],
  ),
]

const devGuide = [
  H1('3. 개발자 가이드'),
  P('이 장은 COD-SEARCHGRID 를 다른 Vue 3 프로젝트에 적용하는 개발자를 위한 안내입니다.'),

  H2('3.1 설치'),
  P('현재 npm 레지스트리 배포 방식은 확정 전입니다. 그 전까지는 저장소에서 패키지 파일을 만들어 설치합니다.'),
  ...code(`
# 1) 라이브러리 저장소에서 빌드 후 패키지 파일 생성
git clone https://github.com/KOSUKJUN/COD-SEARCHGRID.git
cd COD-SEARCHGRID
npm ci
npm run build
npm pack                       # cod-searchgrid-${VERSION}.tgz 생성

# 2) 적용할 프로젝트에서 설치
npm install ../COD-SEARCHGRID/cod-searchgrid-${VERSION}.tgz
`),
  P('요구 사항: Vue `^3.4`, 최신 Chromium/Edge/Firefox/Safari. 스타일 파일은 별도로 import 해야 합니다.'),
  ...code(`
// main.ts
import { createApp } from 'vue'
import CodSearchGrid from 'cod-searchgrid'
import 'cod-searchgrid/style.css'

createApp(App).use(CodSearchGrid).mount('#app')   // 전역 <CodSearchGrid>, <CodPayloadViewer>, <CodPayloadDiff>
`),

  H2('3.2 기본 사용 — 로컬 데이터'),
  P('이미 메모리에 있는 배열을 `rows` 로 넘기면 검색·정렬·그룹핑을 브라우저에서 처리합니다. 그리드는 부모 요소의 높이를 채우므로(`height: 100%`) 부모에 높이를 지정하세요.'),
  ...code(`
<script setup lang="ts">
import { SearchGrid, type GridColumn } from 'cod-searchgrid'

const columns: GridColumn[] = [
  { field: '_time', label: 'Time', width: 190 },
  { field: 'severity', label: 'Severity', width: 100 },
  { field: 'host', label: 'Host' },
  { field: 'message', label: 'Message', width: 600 },
]
const rows = await loadEvents()      // LogRecord[]
</script>

<template>
  <div style="height: 600px">
    <SearchGrid :columns="columns" :rows="rows" row-key="event_id" />
  </div>
</template>
`),

  H2('3.3 원격 데이터 소스 (DataSource)'),
  P('대용량 검색은 `dataSource` 함수를 넘깁니다. 그리드가 검색·스크롤·정렬·그룹 펼침 때마다 이 함수를 호출하며, 새 검색이 시작되면 이전 요청은 `signal` 로 취소됩니다.'),
  ...code(`
import type { DataSource } from 'cod-searchgrid'

const dataSource: DataSource = async ({ query, offset, limit, sort, groupBy, signal }) => {
  const p = new URLSearchParams({ q: query, offset: String(offset), limit: String(limit) })
  if (groupBy) p.set('groupBy', groupBy)
  if (sort) { p.set('sort', sort.field); p.set('order', sort.order) }
  const res = await fetch(\`/api/search?\${p}\`, { signal })
  if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
  return res.json()            // { rows, total, took?, groups? }
}
`),
  table(
    ['요청 (SearchRequest)', '설명'],
    [
      ['`query`', '검색어 문자열 (2.1 문법). 그룹 drill-down 시 상위 그룹 조건이 토큰으로 덧붙음'],
      ['`offset`, `limit`', '페이지 (무한 스크롤 시 offset 증가). groupBy 요청이면 그룹 목록에 적용'],
      ['`sort`', '`{ field, order: "asc" | "desc" }` 또는 undefined'],
      ['`groupBy`', '지정되면 rows 대신 해당 필드의 값별 건수(groups)를 반환해야 함'],
      ['`signal`', 'AbortSignal — fetch 에 그대로 전달'],
    ],
    [2600, 7038],
  ),
  gap(),
  table(
    ['응답 (SearchResult)', '설명'],
    [
      ['`rows`', '이벤트 배열 (groupBy 요청이면 빈 배열)'],
      ['`total`', '조건에 맞는 전체 이벤트 수'],
      ['`groups`', 'groupBy 요청 시 `[{ value, count }]` — 값이 없는 그룹은 `value: null`'],
      ['`took`', '(선택) 서버 처리 시간 ms — 상태 표시줄에 표시'],
    ],
    [2600, 7038],
  ),
  H3('그룹핑 요청 흐름'),
  table(
    ['단계', '그리드가 보내는 요청'],
    [
      ['1레벨 그룹', '`{ query: "error", groupBy: "severity", limit: groupLimit }`'],
      ['하위 그룹 펼침', '`{ query: "error severity=high", groupBy: "host" }`'],
      ['마지막 레벨 펼침', '`{ query: "error severity=high host=web-01", offset, limit }` → 일반 행 응답'],
      ['값 없는 그룹', '조건 토큰으로 `field!=*` 사용'],
    ],
    [2400, 7238],
  ),
  note('검색 문법 파서와 집계 함수(`parseQuery`, `filterRecords`, `groupCounts`)가 함께 export 됩니다. Node 백엔드에서 그대로 사용할 수 있으며, 저장소의 `mock-server/server.mjs` 가 그 예입니다.'),

  H2('3.4 컬럼 정의 (GridColumn)'),
  table(
    ['속성', '타입', '설명'],
    [
      ['`field`', 'string', '필드명. 중첩 필드는 dot path (예: `geo.country`)'],
      ['`label`', 'string', '헤더 표시명 (기본: field)'],
      ['`width` / `minWidth`', 'number', '초기 폭(기본 160) / 최소 폭(기본 60)'],
      ['`sortable` / `resizable`', 'boolean', '정렬 / 폭 조절 허용 (기본 true)'],
      ['`groupable`', 'boolean', 'Group by 허용 (기본 true)'],
      ['`hidden` / `frozen`', 'boolean', '초기 숨김 / 초기 좌측 고정'],
      ['`editable`', 'boolean | (row) => boolean', '셀 편집 허용'],
      ['`align`', "'left' | 'center' | 'right'", '정렬'],
      ['`formatter`', '(value, row) => string', '표시 문자열 변환'],
      ['`cellClass`', 'string | (value, row) => string', '셀 CSS 클래스'],
      ['`highlight`', 'boolean', '검색어 하이라이트 (기본 true)'],
    ],
    [2400, 2700, 4538],
  ),

  H2('3.5 Props'),
  table(
    ['Prop', '기본값', '설명'],
    [
      ['`columns`', '(필수)', '컬럼 정의 배열'],
      ['`rows`', '`[]`', '로컬 데이터 (dataSource 미지정 시)'],
      ['`dataSource`', '–', '원격 검색 함수 (3.3)'],
      ['`query` (v-model:query)', '–', '검색어'],
      ['`groupBy` (v-model:groupBy)', '`[]`', '그룹 필드 목록 (순서 = 레벨)'],
      ['`groupable` / `groupLimit`', '`true` / `500`', 'Group by 패널 표시 / 원격 그룹 최대 수'],
      ['`rowKey`', 'index', '행 고유 키 필드명 또는 함수 (선택·창 유지에 권장)'],
      ['`rowHeight` / `pageSize` / `overscan`', '`28` / `200` / `10`', '행 높이(px) / 원격 페이지 크기 / 가상 스크롤 여유 행'],
      ['`height`', '`100%`', '컴포넌트 높이'],
      ['`theme`', '`light`', '`light` 또는 `dark`'],
      ['`severityBar` / `severityField`', '`false` / `severity`', '행 맨 앞 심각도 색상 막대 표시 여부 / 기준 필드'],
      ['`showDetail` / `detailWidth`', '`true` / `440`', '상세 패널 사용 / 초기 폭'],
      ['`payloadField`', "`['payload','_raw']`", 'payload 필드 후보 (먼저 값이 있는 필드 사용)'],
      ['`payloadEncodingField`', '`payload_encoding`', 'base64 / hex / text 인코딩 필드 (없으면 자동 판별)'],
      ['`immediate`', '`true`', '마운트 시 자동 검색 (원격)'],
      ['`defaultSort`', '`null`', '초기 정렬 `{ field, order }`'],
      ['`selectable` / `showRowNumber`', '`true` / `false`', '체크박스 컬럼 / 행 번호 컬럼'],
      ['`defaultWrap`', '`false`', '초기 줄바꿈 모드'],
      ['`storageKey`', '–', '지정 시 설정·기록·즐겨찾기를 localStorage 에 저장'],
      ['`suggest`', '–', '자동완성 값 제안 함수 `(field, prefix, query) => string[]`'],
      ['`contextMenu`', '`true`', 'false 로 끄거나 함수로 메뉴 커스터마이징 (3.9)'],
      ['`exportFileName`', '`events`', '내보내기 파일명 접두어 (타임스탬프 자동 추가)'],
      ['`windowFields` / `windowTitle` / `maxWindows`', '앞 4개 컬럼 / 앞 2개 값 / `12`', 'Payload 창 상단 필드 / 제목 / 최대 창 수'],
      ['`features`', '모두 `true`', '`filterBuilder`, `columnChooser`, `export`, `wrapToggle`, `bookmarks`, `history`, `autocomplete`, `contextMenu`, `keyboard`, `groupChart`, `payloadWindows`'],
      ['`messages`', '한국어', 'UI 문구 (3.11)'],
    ],
    [3300, 1900, 4438],
  ),

  H2('3.6 Events'),
  table(
    ['이벤트', '인자', '발생 시점'],
    [
      ['`search`', 'SearchRequest', '검색 실행'],
      ['`update:query` / `update:groupBy`', 'string / string[]', '검색어 / 그룹 변경 (v-model)'],
      ['`row-click` / `row-dblclick`', 'row, index', '행 클릭 / 더블클릭'],
      ['`sort-change`', 'SortState | null', '정렬 변경'],
      ['`column-resize`', 'field, width', '컬럼 폭 조절 완료'],
      ['`group-toggle`', 'node, expanded', '그룹 펼침/접힘'],
      ['`selection-change`', 'rows[]', '선택 변경'],
      ['`cell-edit`', '{ row, field, value, oldValue }', '셀 편집 저장 — 서버 저장은 여기서 처리'],
      ['`export`', "format, rows", 'CSV/JSON 내보내기'],
      ['`state-change`', 'GridState', '컬럼·정렬·그룹·줄바꿈 등 설정 변경 — 서버에 사용자 설정 저장 시 사용'],
      ['`loaded`', 'rows, total', '원격 데이터 로드 완료'],
      ['`error`', 'error', '원격 요청 오류'],
    ],
    [2900, 2600, 4138],
  ),

  H2('3.7 Slots'),
  table(
    ['슬롯', 'props', '용도'],
    [
      ['`toolbar`', '–', '툴바 오른쪽에 버튼 추가'],
      ['`status`', '{ total, loading }', '상태 표시줄 오른쪽 내용'],
      ['`empty`', '–', '결과 없음 표시'],
      ['`cell-<field>`', '{ row, value, column }', '특정 컬럼 셀을 직접 렌더링 (예: `cell-severity`)'],
      ['`selection-actions`', '{ rows, clear }', '선택 바에 사용자 정의 버튼 (예: 티켓 생성, 삭제)'],
    ],
    [2400, 2600, 4638],
  ),
  ...code(`
<SearchGrid ...>
  <template #selection-actions="{ rows, clear }">
    <button class="csg-link-btn" @click="createTicket(rows); clear()">티켓 생성</button>
  </template>
</SearchGrid>
`),

  H2('3.8 Methods (ref 로 호출)'),
  table(
    ['메서드', '설명'],
    [
      ['`search(query?)` / `refresh()`', '검색 실행 / 현재 조건으로 다시 조회'],
      ['`addFilter(field, op, value)`', '검색어에 조건 추가 후 검색'],
      ['`setSort(sort | null)` / `setGroupBy(fields)`', '정렬 / 그룹 변경'],
      ['`expandAll()` / `collapseAll()`', '그룹 모두 펼치기(로컬) / 접기'],
      ['`getSelection()` / `selectAll()` / `clearSelection()`', '선택 조회 / 전체 선택 / 해제'],
      ['`copySelection()` / `exportData(format, scope)`', "선택 복사 / 내보내기 ('csv'|'json', 'all'|'selected')"],
      ['`openPayloadWindow(row)` / `openPayloadWindows(rows)`', 'Payload 창 열기'],
      ['`comparePayloads(a, b)`', '두 이벤트 Payload 비교 창 열기'],
      ['`tileWindows()` / `closeAllWindows()`', '창 나란히 / 모두 닫기'],
      ['`getState()` / `applyState(state)` / `resetState()`', '설정 조회 / 적용 / 초기화'],
      ['`scrollToIndex(i)` / `focus()`', '스크롤 이동 / 그리드 포커스'],
    ],
    [4600, 5038],
  ),

  H2('3.9 컨텍스트 메뉴 확장'),
  P('`contextMenu` 에 함수를 넘기면 기본 메뉴(`defaults`)를 받아 항목을 추가·제거·변경할 수 있습니다. 헤더 메뉴에서는 `row` 가 undefined 입니다.'),
  ...code(`
const contextMenu = (ctx: ContextMenuContext): MenuItem[] =>
  ctx.row
    ? [...ctx.defaults, { separator: true },
       { label: '티켓 생성', action: () => openTicket(ctx.row!, ctx.selection) }]
    : ctx.defaults
`),

  H2('3.10 테마 · 스타일'),
  P('모든 색상과 글꼴은 CSS 변수로 정의되어 있어 프로젝트의 디자인에 맞게 덮어쓸 수 있습니다. 다크 테마는 `theme="dark"` (루트에 `.csg--dark` 클래스)로 전환됩니다.'),
  ...code(`
.csg {
  --csg-accent: #7c3aed;          /* 강조색 (버튼, 선택, 포커스) */
  --csg-font-size: 14px;
  --csg-font-mono: 'D2Coding', monospace;
}
.csg--dark { --csg-bg: #0b0f14; }
`),
  table(
    ['변수', '용도'],
    [
      ['`--csg-bg`, `--csg-bg-alt`, `--csg-header-bg`', '배경 / 줄무늬 / 헤더'],
      ['`--csg-text`, `--csg-text-muted`, `--csg-border`', '글자 / 보조 글자 / 테두리'],
      ['`--csg-accent`, `--csg-focus`', '강조색 / 키보드 포커스'],
      ['`--csg-bg-selected`, `--csg-bg-checked`, `--csg-hl-bg`', '상세 행 / 체크 행 / 검색어 하이라이트'],
      ['`--csg-font`, `--csg-font-mono`, `--csg-font-size`', '글꼴'],
      ['`--csg-series-1` ~ `--csg-series-7`', '그룹 차트 색상 (색각 이상 검증된 순서)'],
      ['`--csg-diff-add`, `--csg-diff-del`, `--csg-diff-chg`', 'Payload 비교 색상'],
    ],
    [4600, 5038],
  ),

  H2('3.11 문구 변경 (다국어)'),
  P('`messages` prop 으로 일부 또는 전체 문구를 바꿀 수 있습니다. 기본값은 `DEFAULT_MESSAGES` 로 export 됩니다. `{n}` 은 숫자로 치환됩니다.'),
  ...code(`
<SearchGrid :messages="{ search: 'Search', events: 'events', selected: '{n} selected' }" ... />
`),

  H2('3.12 함께 제공되는 컴포넌트 · 유틸리티'),
  table(
    ['export', '설명'],
    [
      ['`PayloadViewer`, `PayloadDiff`', 'Payload 뷰어 / 비교를 단독으로 사용'],
      ['`EventDetail`, `GroupPanel`, `GroupChart`, `FilterBuilder`, `ContextMenu`, `FloatingWindow`', '그리드 구성 요소 단독 사용'],
      ['`parseQuery`, `filterRecords`, `matchRecord`', '검색 문법 파싱 / 필터링 (서버에서도 사용 가능)'],
      ['`groupCounts`, `buildGroupTree`', '그룹 집계'],
      ['`queryToConditions`, `conditionsToQuery`', '검색어 ↔ 고급 필터 조건 변환'],
      ['`analyzePayload`, `hexDump`, `decodeBase64`', 'Payload 분석'],
      ['`diffTexts`, `inlineDiff`, `stableJson`', '텍스트 비교'],
      ['`toCSV`, `toTSV`, `toJSON`, `copyText`', '내보내기 / 클립보드'],
    ],
    [5200, 4438],
  ),
]

const devEnv = [
  H1('4. 개발 · 테스트 환경'),
  H2('4.1 프로젝트 구조'),
  table(
    ['경로', '내용'],
    [
      ['`src/components/`', 'SearchGrid 및 하위 컴포넌트 (SearchBox, GroupPanel, GroupChart, EventDetail, PayloadViewer, PayloadDiff, FloatingWindow 등)'],
      ['`src/composables/`', '컬럼·선택·가상 스크롤·플로팅 창 상태 관리'],
      ['`src/utils/`', '검색 파서, 그룹, payload, diff, 내보내기, 자동완성, 저장소'],
      ['`src/styles/searchgrid.css`', '스타일 (CSS 변수)'],
      ['`playground/`', '개발용 데모 앱'],
      ['`mock-server/`', '가짜 SIEM 로그 API (이벤트 5만 건 생성)'],
      ['`tests/`', 'Vitest 단위 테스트'],
      ['`docs/manual/`', '이 매뉴얼과 생성 스크립트, 스크린샷'],
    ],
    [3200, 6438],
  ),
  H2('4.2 Docker 테스트 환경'),
  P('Docker Desktop 에서 mock API 와 playground 를 함께 실행합니다. 소스를 수정하면 화면에 바로 반영됩니다(HMR).'),
  ...code(`
npm run docker:up      # 실행 (mock-api :3001, playground :5173)
npm run docker:logs    # 로그
npm run docker:down    # 종료
`),
  table(
    ['주소', '설명'],
    [
      ['http://localhost:5173', 'Playground (Remote API 5만 건 / Local 2만 건 전환, 다크 모드, 예시 검색·그룹)'],
      ['http://localhost:3001/api/search?q=...&offset=&limit=&sort=&order=', '검색 API'],
      ['http://localhost:3001/api/search?q=...&groupBy=field', '그룹 집계 API'],
      ['http://localhost:3001/api/health', '상태 확인'],
    ],
    [5200, 4438],
  ),
  note('package.json 의 의존성을 바꾼 경우 `docker compose up -d --build -V` 로 이미지를 다시 빌드하세요.'),
  H2('4.3 npm 스크립트'),
  table(
    ['명령', '설명'],
    [
      ['`npm run dev` / `npm run mock`', '로컬 playground / mock API 실행 (Docker 없이)'],
      ['`npm test`', '단위 테스트 (Vitest)'],
      ['`npm run typecheck`', '타입 검사 (vue-tsc)'],
      ['`npm run build`', '라이브러리 빌드 → `dist/` (ESM, UMD, 타입 선언, style.css)'],
      ['`npm run manual`', '이 매뉴얼(.docx) 다시 생성 (Windows + Word 에서 목차까지 자동 갱신)'],
      ['`npm run manual:shots`', '매뉴얼 스크린샷 다시 캡처 (playground 실행 중, Edge 필요)'],
    ],
    [3600, 6038],
  ),
  H2('4.4 CI'),
  P('GitHub 에 push 하거나 Pull Request 를 만들면 GitHub Actions 가 타입 검사, 테스트, 빌드를 자동 실행합니다 (`.github/workflows/ci.yml`).'),

  H2('4.5 알려진 제약 사항'),
  table(
    ['항목', '내용'],
    [
      ['검색 문법', 'OR 와 괄호 미지원 (모든 조건 AND)'],
      ['원격 내보내기', '"전체" 내보내기는 현재까지 불러온 행만 포함'],
      ['원격 모두 펼치기', '대량 요청 방지를 위해 원격 모드에서는 미지원'],
      ['원격 그룹 대소문자', '그룹은 값의 대소문자를 구분하지만 펼칠 때의 검색 조건은 대소문자를 무시하므로, `Admin` / `admin` 처럼 대소문자만 다른 값은 펼친 결과가 합쳐져 보일 수 있음'],
      ['플로팅 창', '한 화면에 그리드를 여러 개 두면 작업표시줄 위치가 겹침'],
      ['설정 저장', 'localStorage 기반 — 사용자·기기 간 공유가 필요하면 `state-change` 이벤트로 서버 저장 구현'],
      ['배포', 'npm 레지스트리 배포 방식 확정 전 (3.1 의 패키지 파일 방식 사용)'],
    ],
    [2600, 7038],
  ),
]

// ------------------------------------------------------------------ document
const doc = new Document({
  creator: 'COD-SEARCHGRID',
  title: 'COD-SEARCHGRID 사용자 · 개발자 매뉴얼',
  description: 'SIEM / Splunk 스타일 로그 검색 그리드 매뉴얼',
  styles: {
    default: {
      document: { run: { font: font(FONT), size: 20 }, paragraph: { spacing: { line: 288 } } },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: font(FONT), size: 34, bold: true, color: '1F2328' },
        paragraph: {
          spacing: { before: 120, after: 240 },
          keepNext: true,
          outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 6 } },
        },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: font(FONT), size: 27, bold: true, color: ACCENT },
        paragraph: { spacing: { before: 360, after: 140 }, keepNext: true, outlineLevel: 1 },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: font(FONT), size: 22, bold: true, color: '1F2328' },
        paragraph: { spacing: { before: 220, after: 100 }, keepNext: true, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 440, hanging: 260 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 880, hanging: 260 } } } },
        ],
      },
      {
        reference: 'steps',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 440, hanging: 300 } } } }],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, header: 600, footer: 600 },
        },
        titlePage: true,
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: 'COD-SEARCHGRID 사용자 · 개발자 매뉴얼', size: 16, color: MUTED })],
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D5DD', space: 4 } },
            }),
          ],
        }),
        first: new Header({ children: [new Paragraph({ children: [] })] }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ children: ['- ', PageNumber.CURRENT, ' -'], size: 16, color: MUTED })],
            }),
          ],
        }),
        first: new Footer({ children: [new Paragraph({ children: [] })] }),
      },
      children: [...cover, ...overview, ...userGuide, ...devGuide, ...devEnv],
    },
  ],
})

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf)
  console.log(`written: ${OUT} (${(buf.length / 1024).toFixed(0)} KB, ${figNo} figures)`)
})
