/**
 * Trello REST API 클라이언트 + 순수 유틸 (의존성 없음).
 * Node >= 22.18 의 type stripping 으로 직접 실행되므로 erasable 한 TS 문법만 사용한다.
 */

export interface TrelloConfig {
  /** 보드 URL, shortLink 또는 id */
  board: string
  /** 작업 대상 리스트 이름 (비우면 보드 전체) */
  sourceLists: string[]
  /** 대상 라벨 이름 (하나라도 일치, 비우면 라벨 무관) */
  labels: string[]
  /** 작업 시작 시 이동할 리스트 */
  inProgressList: string
  /** PR 생성 후 이동할 리스트 */
  reviewList: string
  /** PR 머지 후 이동할 리스트 */
  doneList: string
  branchPrefix: string
  /** 카드에 진행 상황 댓글 남기기 */
  comment: boolean
  /** 카드를 리스트 간 이동 */
  moveCards: boolean
}

export const DEFAULT_CONFIG: TrelloConfig = {
  board: '',
  sourceLists: ['To Do', 'Bugs', 'Backlog', '할 일', '버그'],
  labels: [],
  inProgressList: 'In Progress',
  reviewList: 'Review',
  doneList: 'Done',
  branchPrefix: 'trello/',
  comment: true,
  moveCards: true,
}

export interface TrelloLabel {
  id: string
  name: string
  color: string | null
}

export interface TrelloList {
  id: string
  name: string
  closed: boolean
  pos: number
}

export interface TrelloCheckItem {
  id: string
  name: string
  state: 'complete' | 'incomplete'
}

export interface TrelloChecklist {
  id: string
  name: string
  checkItems: TrelloCheckItem[]
}

export interface TrelloAttachment {
  id: string
  name: string
  url: string
  mimeType?: string | null
}

export interface TrelloAction {
  id: string
  type: string
  date: string
  data: { text?: string }
  memberCreator?: { fullName?: string; username?: string }
}

export interface TrelloCard {
  id: string
  idShort: number
  shortLink: string
  name: string
  desc: string
  url: string
  shortUrl: string
  idList: string
  idBoard: string
  closed: boolean
  due: string | null
  dueComplete: boolean
  pos: number
  dateLastActivity: string
  labels: TrelloLabel[]
  checklists?: TrelloChecklist[]
  attachments?: TrelloAttachment[]
  actions?: TrelloAction[]
}

export interface TrelloBoard {
  id: string
  name: string
  shortLink: string
  url: string
}

// ------------------------------------------------------------------ pure utils

/** 카드 참조 (URL / shortLink / id) → API 에서 쓸 수 있는 id 또는 shortLink */
export function parseCardRef(ref: string): string {
  const m = /trello\.com\/c\/([A-Za-z0-9]+)/.exec(ref)
  return (m ? m[1] : ref).trim()
}

export function parseBoardRef(ref: string): string {
  const m = /trello\.com\/b\/([A-Za-z0-9]+)/.exec(ref)
  return (m ? m[1] : ref).trim()
}

/** shortLink 형식 검증 (GitHub Actions 등에서 외부 입력 검증용) */
export function isShortLink(s: string): boolean {
  return /^[A-Za-z0-9]{8}$/.test(s)
}

/** 브랜치용 slug (영문/숫자만, 한글 등은 제거) */
export function slugify(name: string, max = 40): string {
  const s = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return s || 'card'
}

/** trello/<shortLink>-<slug> */
export function branchName(card: Pick<TrelloCard, 'shortLink' | 'name'>, prefix = 'trello/'): string {
  return `${prefix}${card.shortLink}-${slugify(card.name)}`
}

/** 브랜치명에서 카드 shortLink 추출 */
export function shortLinkFromBranch(branch: string, prefix = 'trello/'): string | null {
  if (!branch.startsWith(prefix)) return null
  const s = branch.slice(prefix.length).split('-')[0]
  return isShortLink(s) ? s : null
}

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** 작업 대상 카드: 대상 리스트 + 라벨 조건, 마감일 → 리스트 순서 → 카드 순서로 정렬 */
export function filterCandidates(
  cards: readonly TrelloCard[],
  lists: readonly TrelloList[],
  cfg: Pick<TrelloConfig, 'sourceLists' | 'labels'>,
): TrelloCard[] {
  const listById = new Map(lists.map((l) => [l.id, l]))
  const listOrder = new Map(lists.map((l, i) => [l.id, i]))
  return cards
    .filter((c) => !c.closed)
    .filter((c) => {
      if (!cfg.sourceLists.length) return true
      const l = listById.get(c.idList)
      return !!l && cfg.sourceLists.some((n) => eq(n, l.name))
    })
    .filter((c) => !cfg.labels.length || c.labels.some((lb) => cfg.labels.some((n) => eq(n, lb.name || lb.color || ''))))
    .sort((a, b) => {
      const da = a.due ? Date.parse(a.due) : Infinity
      const db = b.due ? Date.parse(b.due) : Infinity
      if (da !== db) return da - db
      const la = listOrder.get(a.idList) ?? 0
      const lb = listOrder.get(b.idList) ?? 0
      return la - lb || a.pos - b.pos
    })
}

export function findList(lists: readonly TrelloList[], name: string): TrelloList | undefined {
  return lists.find((l) => !l.closed && eq(l.name, name))
}

/** 카드 → 작업 지시용 Markdown (설명, 체크리스트, 첨부, 최근 댓글) */
export function cardToMarkdown(card: TrelloCard, listName = ''): string {
  const out: string[] = []
  out.push(`# ${card.name}`)
  out.push('')
  out.push(`- 카드: ${card.shortUrl || card.url} (shortLink: ${card.shortLink})`)
  if (listName) out.push(`- 리스트: ${listName}`)
  if (card.labels.length) out.push(`- 라벨: ${card.labels.map((l) => l.name || l.color).join(', ')}`)
  if (card.due) out.push(`- 마감: ${card.due}${card.dueComplete ? ' (완료)' : ''}`)
  out.push(`- 최근 활동: ${card.dateLastActivity}`)
  out.push('')
  out.push('## 설명')
  out.push(card.desc.trim() || '(설명 없음)')
  for (const cl of card.checklists ?? []) {
    out.push('')
    out.push(`## 체크리스트: ${cl.name}`)
    for (const it of cl.checkItems) out.push(`- [${it.state === 'complete' ? 'x' : ' '}] ${it.name}`)
  }
  if (card.attachments?.length) {
    out.push('')
    out.push('## 첨부')
    for (const a of card.attachments) out.push(`- ${a.name}: ${a.url}`)
  }
  const comments = (card.actions ?? []).filter((a) => a.type === 'commentCard' && a.data.text)
  if (comments.length) {
    out.push('')
    out.push('## 댓글 (최신순)')
    for (const c of comments) {
      const who = c.memberCreator?.fullName || c.memberCreator?.username || 'unknown'
      out.push(`- ${c.date.slice(0, 16).replace('T', ' ')} ${who}: ${c.data.text!.replace(/\n+/g, ' ')}`)
    }
  }
  return out.join('\n')
}

/** KEY=VALUE 형식 env 파일 파서 (따옴표, 주석, export 지원) */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, '')
    out[m[1]] = v
  }
  return out
}

/** 오류 메시지에서 자격 증명 제거 */
export function redact(text: string, secrets: readonly string[]): string {
  let t = text
  for (const s of secrets) if (s && s.length >= 6) t = t.split(s).join('***')
  return t
}

// ------------------------------------------------------------------ API client

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

export class TrelloClient {
  private key: string
  private token: string
  private fetchImpl: FetchLike
  private base: string

  constructor(key: string, token: string, fetchImpl?: FetchLike, base = 'https://api.trello.com/1') {
    if (!key || !token) throw new Error('TRELLO_API_KEY / TRELLO_TOKEN 이 설정되지 않았습니다 (.env.local 참고)')
    this.key = key
    this.token = token
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    this.base = base
  }

  /** 자격 증명은 URL 이 아닌 Authorization 헤더로 전달 (로그/에러에 노출 방지) */
  async request<T>(method: string, path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `OAuth oauth_consumer_key="${this.key}", oauth_token="${this.token}"`,
      },
    })
    const body = await res.text()
    if (!res.ok) {
      throw new Error(redact(`Trello API ${method} ${path} → HTTP ${res.status}: ${body.slice(0, 300)}`, [this.key, this.token]))
    }
    return (body ? JSON.parse(body) : null) as T
  }

  getMe() {
    return this.request<{ id: string; username: string; fullName: string }>('GET', '/members/me', { fields: 'username,fullName' })
  }

  getBoard(ref: string) {
    return this.request<TrelloBoard>('GET', `/boards/${encodeURIComponent(parseBoardRef(ref))}`, { fields: 'name,shortLink,url' })
  }

  getLists(boardId: string) {
    return this.request<TrelloList[]>('GET', `/boards/${boardId}/lists`, { filter: 'open', fields: 'name,closed,pos' })
  }

  getLabels(boardId: string) {
    return this.request<TrelloLabel[]>('GET', `/boards/${boardId}/labels`, { fields: 'name,color', limit: 1000 })
  }

  getCards(boardId: string) {
    return this.request<TrelloCard[]>('GET', `/boards/${boardId}/cards/open`, {
      fields: 'idShort,shortLink,name,desc,url,shortUrl,idList,idBoard,closed,due,dueComplete,pos,dateLastActivity,labels',
    })
  }

  getCard(ref: string) {
    return this.request<TrelloCard>('GET', `/cards/${encodeURIComponent(parseCardRef(ref))}`, {
      fields: 'idShort,shortLink,name,desc,url,shortUrl,idList,idBoard,closed,due,dueComplete,pos,dateLastActivity,labels',
      checklists: 'all',
      attachments: true,
      attachment_fields: 'name,url,mimeType',
      actions: 'commentCard',
      actions_limit: 20,
      action_memberCreator_fields: 'fullName,username',
    })
  }

  async search(boardId: string, query: string) {
    const r = await this.request<{ cards: TrelloCard[] }>('GET', '/search', {
      query,
      idBoards: boardId,
      modelTypes: 'cards',
      cards_limit: 50,
      card_fields: 'idShort,shortLink,name,desc,url,shortUrl,idList,idBoard,closed,due,dueComplete,pos,dateLastActivity,labels',
      partial: true,
    })
    return r.cards
  }

  addComment(cardId: string, text: string) {
    return this.request('POST', `/cards/${cardId}/actions/comments`, { text })
  }

  moveCard(cardId: string, listId: string) {
    return this.request('PUT', `/cards/${cardId}`, { idList: listId, pos: 'top' })
  }

  attachUrl(cardId: string, url: string, name?: string) {
    return this.request('POST', `/cards/${cardId}/attachments`, { url, ...(name ? { name } : {}) })
  }
}
