/**
 * Trello 연동 CLI — Claude Code 스킬(trello-sync)과 GitHub Actions 에서 사용
 *
 *   npm run trello -- <command> [args]
 *
 *   check                         인증 / 보드 / 리스트 / 라벨 확인
 *   list [--all] [--json]         작업 대상 카드 목록 (설정의 리스트·라벨 조건)
 *   search <query> [--json]       보드 내 카드 검색 (Trello 검색 문법)
 *   show <card> [--json]          카드 상세 (설명·체크리스트·첨부·댓글) → Markdown
 *   start <card>                  In Progress 로 이동 + 작업 시작 댓글, 브랜치명 출력
 *   review <card> --pr <url> [--summary <text>]   PR 링크 첨부·댓글 + Review 로 이동
 *   done <card> [--pr <url>]      Done 으로 이동 + 완료 댓글
 *   comment <card> <text>         댓글 작성 (text 가 - 이면 stdin)
 *   move <card> <list name>       리스트 이동
 *   branch <card>                 브랜치명만 출력
 *
 * <card> 는 카드 URL, shortLink(8자) 또는 id.
 * 자격 증명: 환경 변수 또는 저장소 루트의 .env.local / .env
 *   TRELLO_API_KEY, TRELLO_TOKEN, (선택) TRELLO_BOARD
 * 설정: 저장소 루트의 trello.config.json (없으면 기본값)
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  DEFAULT_CONFIG,
  TrelloClient,
  branchName,
  cardToMarkdown,
  filterCandidates,
  findList,
  parseEnvFile,
  type TrelloCard,
  type TrelloConfig,
  type TrelloList,
} from './lib.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function loadEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const f of ['.env', '.env.local']) {
    const p = path.join(ROOT, f)
    if (existsSync(p)) Object.assign(env, parseEnvFile(readFileSync(p, 'utf8')))
  }
  return { ...env, ...process.env }
}

function loadConfig(env: Record<string, string | undefined>): TrelloConfig {
  const p = path.join(ROOT, 'trello.config.json')
  const file = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Partial<TrelloConfig>) : {}
  const cfg = { ...DEFAULT_CONFIG, ...file }
  if (env.TRELLO_BOARD) cfg.board = env.TRELLO_BOARD
  return cfg
}

function parseArgs(argv: string[]) {
  const pos: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--') && ['pr', 'summary', 'list'].includes(k)) {
        flags[k] = next
        i++
      } else flags[k] = true
    } else pos.push(a)
  }
  return { pos, flags }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const fmtCard = (c: TrelloCard, lists: Map<string, TrelloList>) => {
  const labels = c.labels.map((l) => l.name || l.color).filter(Boolean)
  return [
    `[${c.shortLink}]`,
    `(${lists.get(c.idList)?.name ?? '?'})`,
    labels.length ? `{${labels.join(', ')}}` : '',
    c.name,
    c.due ? `· due ${c.due.slice(0, 10)}` : '',
    `· ${c.shortUrl}`,
  ]
    .filter(Boolean)
    .join(' ')
}

async function main() {
  const { pos, flags } = parseArgs(process.argv.slice(2))
  const cmd = pos[0]
  if (!cmd || cmd === 'help' || flags.help) {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, ''))
    return
  }
  const env = loadEnv()
  const cfg = loadConfig(env)
  const api = new TrelloClient(env.TRELLO_API_KEY ?? '', env.TRELLO_TOKEN ?? '')
  const json = !!flags.json

  const needBoard = async () => {
    if (!cfg.board) throw new Error('보드가 설정되지 않았습니다. trello.config.json 의 "board" 또는 TRELLO_BOARD 를 지정하세요.')
    const board = await api.getBoard(cfg.board)
    const lists = await api.getLists(board.id)
    return { board, lists, listMap: new Map(lists.map((l) => [l.id, l])) }
  }
  const listOrFail = (lists: TrelloList[], name: string) => {
    const l = findList(lists, name)
    if (!l) throw new Error(`리스트 "${name}" 를 찾을 수 없습니다. 보드 리스트: ${lists.map((x) => x.name).join(', ')}`)
    return l
  }
  const cardArg = () => {
    if (!pos[1]) throw new Error('카드(URL / shortLink / id)를 지정하세요.')
    return pos[1]
  }
  const say = async (card: TrelloCard, text: string) => {
    if (cfg.comment) await api.addComment(card.id, text)
  }
  const moveTo = async (card: TrelloCard, lists: TrelloList[], name: string) => {
    if (!cfg.moveCards || !name) return false
    const l = findList(lists, name)
    if (!l) {
      console.warn(`! 리스트 "${name}" 가 없어 이동하지 않았습니다.`)
      return false
    }
    if (card.idList !== l.id) await api.moveCard(card.id, l.id)
    return true
  }

  switch (cmd) {
    case 'check': {
      const me = await api.getMe()
      console.log(`인증: ${me.fullName} (@${me.username})`)
      const { board, lists } = await needBoard()
      const labels = await api.getLabels(board.id)
      console.log(`보드: ${board.name} · ${board.url}`)
      console.log(`리스트: ${lists.map((l) => l.name).join(' | ')}`)
      console.log(`라벨: ${labels.map((l) => l.name || `(${l.color})`).join(', ') || '(없음)'}`)
      const missing = [...cfg.sourceLists.filter((n) => !findList(lists, n)).map((n) => `source:${n}`)]
      for (const [k, n] of [['inProgress', cfg.inProgressList], ['review', cfg.reviewList], ['done', cfg.doneList]] as const)
        if (n && !findList(lists, n)) missing.push(`${k}:${n}`)
      console.log(missing.length ? `설정에 있지만 보드에 없는 리스트: ${missing.join(', ')}` : '설정의 리스트가 모두 보드에 있습니다.')
      break
    }
    case 'list': {
      const { board, lists, listMap } = await needBoard()
      const cards = await api.getCards(board.id)
      const result = flags.all ? cards : filterCandidates(cards, lists, cfg)
      if (json) console.log(JSON.stringify(result.map((c) => ({ ...c, list: listMap.get(c.idList)?.name })), null, 2))
      else {
        console.log(`${board.name}: ${result.length}건${flags.all ? ' (전체)' : ` (리스트: ${cfg.sourceLists.join('/') || '전체'}${cfg.labels.length ? `, 라벨: ${cfg.labels.join('/')}` : ''})`}`)
        for (const c of result) console.log(fmtCard(c, listMap))
      }
      break
    }
    case 'search': {
      const q = pos.slice(1).join(' ')
      if (!q) throw new Error('검색어를 입력하세요.')
      const { board, listMap } = await needBoard()
      const cards = await api.search(board.id, q)
      if (json) console.log(JSON.stringify(cards, null, 2))
      else {
        console.log(`"${q}": ${cards.length}건`)
        for (const c of cards) console.log(fmtCard(c, listMap))
      }
      break
    }
    case 'show': {
      const card = await api.getCard(cardArg())
      const lists = await api.getLists(card.idBoard)
      if (json) console.log(JSON.stringify(card, null, 2))
      else {
        console.log(cardToMarkdown(card, lists.find((l) => l.id === card.idList)?.name))
        console.log(`\n브랜치: ${branchName(card, cfg.branchPrefix)}`)
      }
      break
    }
    case 'branch': {
      const card = await api.getCard(cardArg())
      console.log(branchName(card, cfg.branchPrefix))
      break
    }
    case 'start': {
      const card = await api.getCard(cardArg())
      const lists = await api.getLists(card.idBoard)
      const branch = branchName(card, cfg.branchPrefix)
      await moveTo(card, lists, cfg.inProgressList)
      await say(card, `🤖 작업을 시작했습니다. 브랜치: \`${branch}\``)
      console.log(branch)
      break
    }
    case 'review': {
      const card = await api.getCard(cardArg())
      const pr = typeof flags.pr === 'string' ? flags.pr : ''
      if (!pr) throw new Error('--pr <PR URL> 을 지정하세요.')
      const lists = await api.getLists(card.idBoard)
      const already = (card.attachments ?? []).some((a) => a.url === pr)
      if (!already) await api.attachUrl(card.id, pr, 'GitHub Pull Request')
      const summary = typeof flags.summary === 'string' ? `\n\n${flags.summary}` : ''
      await say(card, `🤖 수정 PR 을 올렸습니다: ${pr}${summary}`)
      await moveTo(card, lists, cfg.reviewList)
      console.log(`review: ${card.shortLink} → ${cfg.reviewList} (${pr})`)
      break
    }
    case 'done': {
      const card = await api.getCard(cardArg())
      const lists = await api.getLists(card.idBoard)
      const pr = typeof flags.pr === 'string' ? ` (${flags.pr})` : ''
      await moveTo(card, lists, cfg.doneList)
      await say(card, `✅ PR 이 main 에 반영되었습니다${pr}`)
      console.log(`done: ${card.shortLink} → ${cfg.doneList}`)
      break
    }
    case 'comment': {
      const card = await api.getCard(cardArg())
      const text = pos[2] === '-' ? await readStdin() : pos.slice(2).join(' ')
      if (!text.trim()) throw new Error('댓글 내용을 입력하세요.')
      await api.addComment(card.id, text)
      console.log(`comment: ${card.shortLink}`)
      break
    }
    case 'move': {
      const card = await api.getCard(cardArg())
      const lists = await api.getLists(card.idBoard)
      const l = listOrFail(lists, pos.slice(2).join(' '))
      await api.moveCard(card.id, l.id)
      console.log(`move: ${card.shortLink} → ${l.name}`)
      break
    }
    default:
      throw new Error(`알 수 없는 명령: ${cmd} (help 참고)`)
  }
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
