import { describe, expect, it } from 'vitest'
import {
  TrelloClient,
  branchName,
  cardToMarkdown,
  filterCandidates,
  parseBoardRef,
  parseCardRef,
  parseEnvFile,
  shortLinkFromBranch,
  slugify,
  type TrelloCard,
  type TrelloList,
} from '../scripts/trello/lib.ts'

const lists: TrelloList[] = [
  { id: 'L1', name: 'To Do', closed: false, pos: 1 },
  { id: 'L2', name: 'In Progress', closed: false, pos: 2 },
  { id: 'L3', name: 'Bugs', closed: false, pos: 3 },
]
const card = (p: Partial<TrelloCard>): TrelloCard => ({
  id: p.shortLink ?? 'x',
  idShort: 1,
  shortLink: 'AbCd1234',
  name: 'card',
  desc: '',
  url: 'https://trello.com/c/AbCd1234/1-card',
  shortUrl: 'https://trello.com/c/AbCd1234',
  idList: 'L1',
  idBoard: 'B1',
  closed: false,
  due: null,
  dueComplete: false,
  pos: 1,
  dateLastActivity: '2026-11-09T00:00:00.000Z',
  labels: [],
  ...p,
})

describe('parse / slug / branch', () => {
  it('카드·보드 URL 에서 shortLink 추출', () => {
    expect(parseCardRef('https://trello.com/c/AbCd1234/12-grid-scroll-bug')).toBe('AbCd1234')
    expect(parseCardRef('AbCd1234')).toBe('AbCd1234')
    expect(parseBoardRef('https://trello.com/b/Zz99Yy88/cod-searchgrid')).toBe('Zz99Yy88')
  })
  it('브랜치명: 영문 slug, 한글은 제거, 왕복 추출', () => {
    expect(slugify('Grid 스크롤 시 Header 깨짐 #12')).toBe('grid-header-12')
    expect(slugify('한글만 있는 제목')).toBe('card')
    const b = branchName(card({ name: 'Fix: wrap mode height' }))
    expect(b).toBe('trello/AbCd1234-fix-wrap-mode-height')
    expect(shortLinkFromBranch(b)).toBe('AbCd1234')
    expect(shortLinkFromBranch('feature/x')).toBeNull()
  })
})

describe('filterCandidates', () => {
  const cards = [
    card({ shortLink: 'a', idList: 'L2', name: 'in progress' }),
    card({ shortLink: 'b', idList: 'L3', name: 'bug later', labels: [{ id: '1', name: 'bug', color: 'red' }] }),
    card({ shortLink: 'c', idList: 'L1', name: 'todo due', due: '2026-11-10T00:00:00Z' }),
    card({ shortLink: 'd', idList: 'L1', name: 'todo', pos: 5 }),
    card({ shortLink: 'e', idList: 'L1', name: 'closed', closed: true }),
  ]
  it('대상 리스트만, 마감일 → 리스트 순 → pos', () => {
    expect(filterCandidates(cards, lists, { sourceLists: ['to do', 'Bugs'], labels: [] }).map((c) => c.shortLink)).toEqual(['c', 'd', 'b'])
  })
  it('라벨 조건', () => {
    expect(filterCandidates(cards, lists, { sourceLists: [], labels: ['BUG'] }).map((c) => c.shortLink)).toEqual(['b'])
  })
})

describe('cardToMarkdown / env', () => {
  it('설명·체크리스트·댓글 포함', () => {
    const md = cardToMarkdown(
      card({
        name: '검색 하이라이트 오류',
        desc: '특수문자 검색 시 하이라이트가 안 됨',
        labels: [{ id: '1', name: 'bug', color: 'red' }],
        checklists: [{ id: 'c', name: '재현', checkItems: [{ id: 'i', name: '"a.b" 검색', state: 'complete' }] }],
        actions: [{ id: 'x', type: 'commentCard', date: '2026-11-09T10:20:00Z', data: { text: 'IE 아님' }, memberCreator: { fullName: '김민수' } }],
      }),
      'Bugs',
    )
    expect(md).toContain('# 검색 하이라이트 오류')
    expect(md).toContain('- 리스트: Bugs')
    expect(md).toContain('- [x] "a.b" 검색')
    expect(md).toContain('2026-11-09 10:20 김민수: IE 아님')
  })
  it('.env 파싱', () => {
    expect(parseEnvFile('# c\nTRELLO_API_KEY=abc\nexport TRELLO_TOKEN="t k" \nX=1 # note\n')).toEqual({
      TRELLO_API_KEY: 'abc',
      TRELLO_TOKEN: 't k',
      X: '1',
    })
  })
})

describe('TrelloClient', () => {
  it('자격 증명은 헤더로만 전달하고, 오류 메시지에서 가린다', async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = []
    const fake = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers })
      return { ok: false, status: 401, text: async () => 'invalid token secret-token-123' }
    }
    const api = new TrelloClient('key-abcdef', 'secret-token-123', fake)
    await expect(api.getCard('https://trello.com/c/AbCd1234/x')).rejects.toThrow(/HTTP 401: invalid token \*\*\*/)
    expect(calls[0].url).toMatch(/^https:\/\/api\.trello\.com\/1\/cards\/AbCd1234\?/)
    expect(calls[0].url).not.toContain('secret-token-123')
    expect(calls[0].headers?.Authorization).toContain('oauth_token="secret-token-123"')
  })
  it('자격 증명이 없으면 안내 오류', () => {
    expect(() => new TrelloClient('', '')).toThrow(/\.env\.local/)
  })
})
