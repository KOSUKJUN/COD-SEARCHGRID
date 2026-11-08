// 테스트용 Mock 로그 검색 API (의존성 없음, Node >= 22.18 의 type stripping 사용)
//
//   GET /api/health
//   GET /api/search?q=<query>&offset=0&limit=200&sort=_time&order=desc
//     → { rows, total, took }
//
// 환경 변수: PORT(3001), EVENTS(50000), LATENCY_MS(120)
import { createServer } from 'node:http'
import { generateEvents } from './generate.ts'
import { compareValues, filterRecords, getValueByPath } from '../src/utils/query.ts'

const PORT = Number(process.env.PORT ?? 3001)
const EVENTS = Number(process.env.EVENTS ?? 50000)
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 120)

const started = Date.now()
const events = generateEvents(EVENTS)
console.log(`[mock-api] generated ${events.length} events in ${Date.now() - started}ms`)

// 같은 쿼리/정렬로 페이지만 넘기는 경우를 위한 간단한 캐시
const cache = new Map()
const CACHE_MAX = 20

function search(q, sortField, order) {
  const key = `${q}\u0000${sortField}\u0000${order}`
  const hit = cache.get(key)
  if (hit) return hit
  let rows = filterRecords(events, q)
  if (sortField) {
    const dir = order === 'asc' ? 1 : -1
    rows.sort((a, b) => dir * compareValues(getValueByPath(a, sortField), getValueByPath(b, sortField)))
  }
  cache.set(key, rows)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return rows
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' })
    return res.end()
  }
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, events: events.length })

  if (url.pathname === '/api/search') {
    const t0 = performance.now()
    const q = url.searchParams.get('q') ?? ''
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200))
    const sort = url.searchParams.get('sort') ?? ''
    const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc'
    try {
      const rows = search(q, sort, order)
      const page = rows.slice(offset, offset + limit)
      const took = Math.round(performance.now() - t0)
      setTimeout(() => send(res, 200, { rows: page, total: rows.length, took }), LATENCY_MS)
    } catch (e) {
      send(res, 400, { error: String(e?.message ?? e) })
    }
    return
  }
  send(res, 404, { error: 'not found' })
})

server.listen(PORT, '0.0.0.0', () => console.log(`[mock-api] listening on http://0.0.0.0:${PORT}`))

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)))
