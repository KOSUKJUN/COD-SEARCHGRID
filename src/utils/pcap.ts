/**
 * 경량 PCAP 분석기 (Wireshark-lite).
 *
 * - pcap(libpcap, µs/ns, LE/BE) · pcapng(SHB/IDB/EPB/SPB) 캡처 파일 파싱
 * - 캡처 파일이 아니면 단일 raw 패킷(Ethernet / IPv4 / IPv6)으로 간주
 * - Ethernet(+VLAN) · Linux SLL · ARP · IPv4 · IPv6 · ICMP · ICMPv6 · TCP · UDP · DNS · HTTP · TLS 디섹션
 *
 * 각 필드는 frame 내 바이트 범위(start/end)를 가지므로 hex 뷰와 연동해 강조할 수 있다.
 */

/** libpcap LINKTYPE_* */
export const LINKTYPE = {
  NULL: 0,
  ETHERNET: 1,
  RAW: 101,
  LINUX_SLL: 113,
  IPV4: 228,
  IPV6: 229,
} as const

export type CaptureFormat = 'pcap' | 'pcapng' | 'raw'

export interface PcapFrame {
  /** 1부터 시작하는 패킷 번호 */
  no: number
  /** epoch 초 (소수점 포함), raw 패킷이면 null */
  ts: number | null
  linkType: number
  /** 캡처된 길이 */
  capLen: number
  /** 원래 길이 */
  origLen: number
  data: Uint8Array
}

export interface PcapCapture {
  format: CaptureFormat
  frames: PcapFrame[]
  /** 파싱이 중간에 끊겼거나 최대 개수 초과 */
  truncated: boolean
  /** 손상 등 경고 */
  warnings: string[]
}

export interface PcapField {
  name: string
  value: string
  /** frame 내 바이트 오프셋 [start, end) */
  start: number
  end: number
  children?: PcapField[]
}

export interface PcapLayer {
  /** 'Ethernet' | 'IPv4' | 'TCP' ... */
  proto: string
  /** 트리 제목 줄 */
  title: string
  start: number
  end: number
  fields: PcapField[]
}

export interface PcapSummary {
  src: string
  dst: string
  /** 가장 상위 프로토콜 */
  protocol: string
  info: string
}

export interface DissectedFrame {
  frame: PcapFrame
  layers: PcapLayer[]
  summary: PcapSummary
}

const MAX_FRAMES = 10000

// ============================================================ capture parsing

const isPcapMagic = (m: number) => m === 0xa1b2c3d4 || m === 0xd4c3b2a1 || m === 0xa1b23c4d || m === 0x4d3cb2a1

/** 캡처 파일(pcap/pcapng) 여부 */
export function isCaptureFile(bytes: Uint8Array): boolean {
  if (bytes.length < 24) return false
  const dv = view(bytes)
  const m = dv.getUint32(0, false)
  return isPcapMagic(m) || m === 0x0a0d0d0a
}

/** raw 패킷의 링크 타입 추정 (모르면 null) */
export function guessLinkType(bytes: Uint8Array): number | null {
  if (bytes.length >= 20 && bytes[0] >> 4 === 4 && (bytes[0] & 0x0f) >= 5) {
    const total = (bytes[2] << 8) | bytes[3]
    if (total >= 20) return LINKTYPE.RAW
  }
  if (bytes.length >= 40 && bytes[0] >> 4 === 6) {
    const next = bytes[6]
    if ([0, 6, 17, 43, 44, 58, 59, 60].includes(next)) return LINKTYPE.RAW
  }
  if (bytes.length >= 14) {
    const et = (bytes[12] << 8) | bytes[13]
    if (et === 0x0800 || et === 0x86dd || et === 0x0806 || et === 0x8100 || et === 0x88a8) return LINKTYPE.ETHERNET
  }
  return null
}

/** payload 바이트가 PCAP 분석 대상(캡처 파일 또는 raw 패킷)인지 */
export function looksLikePacket(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || !bytes.length) return false
  return isCaptureFile(bytes) || guessLinkType(bytes) != null
}

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength)
}

export function parseCapture(bytes: Uint8Array, maxFrames = MAX_FRAMES): PcapCapture | null {
  if (bytes.length >= 4) {
    const m = view(bytes).getUint32(0, false)
    if (isPcapMagic(m)) return parsePcap(bytes, maxFrames)
    if (m === 0x0a0d0d0a) return parsePcapng(bytes, maxFrames)
  }
  const lt = guessLinkType(bytes)
  if (lt == null) return null
  return {
    format: 'raw',
    frames: [{ no: 1, ts: null, linkType: lt, capLen: bytes.length, origLen: bytes.length, data: bytes }],
    truncated: false,
    warnings: [],
  }
}

function parsePcap(bytes: Uint8Array, maxFrames: number): PcapCapture {
  const dv = view(bytes)
  const m = dv.getUint32(0, false)
  const le = m === 0xd4c3b2a1 || m === 0x4d3cb2a1
  const nano = m === 0xa1b23c4d || m === 0x4d3cb2a1
  const warnings: string[] = []
  if (bytes.length < 24) return { format: 'pcap', frames: [], truncated: true, warnings: ['pcap 헤더가 잘렸습니다'] }
  const linkType = dv.getUint32(20, le) & 0x0fffffff
  const frames: PcapFrame[] = []
  let off = 24
  let truncated = false
  while (off + 16 <= bytes.length) {
    if (frames.length >= maxFrames) {
      truncated = true
      break
    }
    const sec = dv.getUint32(off, le)
    const frac = dv.getUint32(off + 4, le)
    const capLen = dv.getUint32(off + 8, le)
    const origLen = dv.getUint32(off + 12, le)
    off += 16
    if (capLen > 0x40000) {
      warnings.push(`패킷 ${frames.length + 1}: 비정상 길이 ${capLen}`)
      truncated = true
      break
    }
    const end = Math.min(off + capLen, bytes.length)
    if (end < off + capLen) {
      truncated = true
      warnings.push(`패킷 ${frames.length + 1}: 데이터가 잘렸습니다`)
    }
    frames.push({
      no: frames.length + 1,
      ts: sec + frac / (nano ? 1e9 : 1e6),
      linkType,
      capLen: end - off,
      origLen,
      data: bytes.subarray(off, end),
    })
    off = end
  }
  return { format: 'pcap', frames, truncated, warnings }
}

function parsePcapng(bytes: Uint8Array, maxFrames: number): PcapCapture {
  const dv = view(bytes)
  const warnings: string[] = []
  const frames: PcapFrame[] = []
  let le = true
  let ifaces: { linkType: number; tsDiv: number }[] = []
  let off = 0
  let truncated = false
  while (off + 12 <= bytes.length) {
    const typeBE = dv.getUint32(off, false)
    if (typeBE === 0x0a0d0d0a) {
      // Section Header Block: byte-order magic 로 엔디언 결정
      const bom = dv.getUint32(off + 8, false)
      le = bom === 0x4d3c2b1a
      ifaces = []
    }
    const type = dv.getUint32(off, le)
    const len = dv.getUint32(off + 4, le)
    if (len < 12 || len % 4 !== 0 || off + len > bytes.length) {
      truncated = true
      warnings.push('pcapng 블록이 손상되었거나 잘렸습니다')
      break
    }
    const body = off + 8
    if (type === 0x00000001) {
      // Interface Description Block
      const linkType = dv.getUint16(body, le)
      let tsDiv = 1e6
      // options: if_tsresol(9)
      let o = body + 8
      const optEnd = off + len - 4
      while (o + 4 <= optEnd) {
        const code = dv.getUint16(o, le)
        const olen = dv.getUint16(o + 2, le)
        if (code === 0) break
        if (code === 9 && olen >= 1) {
          const v = bytes[o + 4]
          tsDiv = v & 0x80 ? 2 ** (v & 0x7f) : 10 ** v
        }
        o += 4 + Math.ceil(olen / 4) * 4
      }
      ifaces.push({ linkType, tsDiv })
    } else if (type === 0x00000006 || type === 0x00000003) {
      if (frames.length >= maxFrames) {
        truncated = true
        break
      }
      if (type === 0x00000006) {
        // Enhanced Packet Block
        const ifId = dv.getUint32(body, le)
        const hi = dv.getUint32(body + 4, le)
        const lo = dv.getUint32(body + 8, le)
        const capLen = dv.getUint32(body + 12, le)
        const origLen = dv.getUint32(body + 16, le)
        const iface = ifaces[ifId] ?? { linkType: LINKTYPE.ETHERNET, tsDiv: 1e6 }
        const start = body + 20
        const end = Math.min(start + capLen, off + len - 4)
        frames.push({
          no: frames.length + 1,
          ts: (hi * 4294967296 + lo) / iface.tsDiv,
          linkType: iface.linkType,
          capLen: end - start,
          origLen,
          data: bytes.subarray(start, end),
        })
      } else {
        // Simple Packet Block
        const origLen = dv.getUint32(body, le)
        const start = body + 4
        const end = Math.min(start + origLen, off + len - 4)
        frames.push({
          no: frames.length + 1,
          ts: null,
          linkType: ifaces[0]?.linkType ?? LINKTYPE.ETHERNET,
          capLen: end - start,
          origLen,
          data: bytes.subarray(start, end),
        })
      }
    }
    off += len
  }
  return { format: 'pcapng', frames, truncated, warnings }
}

// ============================================================ dissection

const ETHERTYPES: Record<number, string> = {
  0x0800: 'IPv4',
  0x0806: 'ARP',
  0x86dd: 'IPv6',
  0x8100: '802.1Q',
  0x88a8: '802.1ad',
  0x88cc: 'LLDP',
}
const IP_PROTOS: Record<number, string> = {
  0: 'HOPOPT',
  1: 'ICMP',
  2: 'IGMP',
  6: 'TCP',
  17: 'UDP',
  41: 'IPv6',
  47: 'GRE',
  50: 'ESP',
  51: 'AH',
  58: 'ICMPv6',
  89: 'OSPF',
  132: 'SCTP',
}
const PORTS: Record<number, string> = {
  20: 'ftp-data',
  21: 'ftp',
  22: 'ssh',
  23: 'telnet',
  25: 'smtp',
  53: 'dns',
  67: 'dhcp',
  68: 'dhcp',
  80: 'http',
  110: 'pop3',
  123: 'ntp',
  143: 'imap',
  161: 'snmp',
  389: 'ldap',
  443: 'https',
  445: 'smb',
  514: 'syslog',
  636: 'ldaps',
  993: 'imaps',
  1389: 'ldap',
  3306: 'mysql',
  3389: 'rdp',
  5353: 'mdns',
  5432: 'postgres',
  6379: 'redis',
  8080: 'http-alt',
  8443: 'https-alt',
}
const DNS_TYPES: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  65: 'HTTPS',
  255: 'ANY',
}
const DNS_RCODES = ['NoError', 'FormErr', 'ServFail', 'NXDomain', 'NotImp', 'Refused']
const ICMP_TYPES: Record<number, string> = {
  0: 'Echo (ping) reply',
  3: 'Destination unreachable',
  5: 'Redirect',
  8: 'Echo (ping) request',
  11: 'Time-to-live exceeded',
}
const ICMP6_TYPES: Record<number, string> = {
  1: 'Destination unreachable',
  3: 'Time exceeded',
  128: 'Echo request',
  129: 'Echo reply',
  133: 'Router solicitation',
  134: 'Router advertisement',
  135: 'Neighbor solicitation',
  136: 'Neighbor advertisement',
}
const TLS_CONTENT: Record<number, string> = { 20: 'Change Cipher Spec', 21: 'Alert', 22: 'Handshake', 23: 'Application Data' }
const TLS_HS: Record<number, string> = {
  1: 'Client Hello',
  2: 'Server Hello',
  4: 'New Session Ticket',
  11: 'Certificate',
  12: 'Server Key Exchange',
  14: 'Server Hello Done',
  16: 'Client Key Exchange',
  20: 'Finished',
}
const TLS_VERSIONS: Record<number, string> = { 0x0300: 'SSL 3.0', 0x0301: 'TLS 1.0', 0x0302: 'TLS 1.1', 0x0303: 'TLS 1.2', 0x0304: 'TLS 1.3' }
const HTTP_START = /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT|TRACE) \S+ HTTP\/\d|^HTTP\/\d(\.\d)? \d{3}/

const hex2 = (n: number) => n.toString(16).padStart(2, '0')
const hex4 = (n: number) => `0x${n.toString(16).padStart(4, '0')}`

export function formatMac(b: Uint8Array, o: number): string {
  return Array.from(b.subarray(o, o + 6), hex2).join(':')
}
export function formatIPv4(b: Uint8Array, o: number): string {
  return `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`
}
/** RFC 5952 축약 표기 */
export function formatIPv6(b: Uint8Array, o: number): string {
  const g: number[] = []
  for (let i = 0; i < 8; i++) g.push((b[o + i * 2] << 8) | b[o + i * 2 + 1])
  let bestS = -1
  let bestL = 0
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && g[j] === 0) j++
    if (j - i > bestL && j - i >= 2) {
      bestS = i
      bestL = j - i
    }
    i = j
  }
  const s = g.map((x) => x.toString(16))
  if (bestS < 0) return s.join(':')
  return `${s.slice(0, bestS).join(':')}::${s.slice(bestS + bestL).join(':')}`
}

const portName = (p: number) => (PORTS[p] ? `${p} (${PORTS[p]})` : String(p))

/** 인터넷 체크섬 (RFC 1071) */
export function inetChecksum(b: Uint8Array, start: number, end: number, init = 0): number {
  let sum = init
  for (let i = start; i + 1 < end; i += 2) sum += (b[i] << 8) | b[i + 1]
  if ((end - start) % 2) sum += b[end - 1] << 8
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16)
  return ~sum & 0xffff
}

class Ctx {
  layers: PcapLayer[] = []
  summary: PcapSummary = { src: '', dst: '', protocol: '', info: '' }
  constructor(readonly b: Uint8Array) {}
  u8 = (o: number) => this.b[o]
  u16 = (o: number) => (this.b[o] << 8) | this.b[o + 1]
  u32 = (o: number) => ((this.b[o] << 24) | (this.b[o + 1] << 16) | (this.b[o + 2] << 8) | this.b[o + 3]) >>> 0
  has = (o: number, n: number) => o + n <= this.b.length
  layer(proto: string, title: string, start: number, end: number): PcapLayer {
    const l: PcapLayer = { proto, title, start, end: Math.min(end, this.b.length), fields: [] }
    this.layers.push(l)
    this.summary.protocol = proto
    return l
  }
}

const f = (name: string, value: string | number, start: number, len: number, children?: PcapField[]): PcapField => ({
  name,
  value: String(value),
  start,
  end: start + len,
  ...(children ? { children } : {}),
})

export function dissectFrame(frame: PcapFrame): DissectedFrame {
  const c = new Ctx(frame.data)
  const b = frame.data
  try {
    switch (frame.linkType) {
      case LINKTYPE.ETHERNET:
        ethernet(c, 0)
        break
      case LINKTYPE.RAW:
      case LINKTYPE.IPV4:
      case LINKTYPE.IPV6:
        ipAny(c, 0)
        break
      case LINKTYPE.LINUX_SLL:
        sll(c, 0)
        break
      case LINKTYPE.NULL: {
        if (c.has(0, 4)) {
          const fam = b[0] || b[3]
          c.layer('Null', `Null/Loopback, Family: ${fam}`, 0, 4).fields.push(f('Family', fam, 0, 4))
          ipAny(c, 4)
        }
        break
      }
      default:
        data(c, 0, `Link type ${frame.linkType}`)
    }
  } catch {
    /* 잘린 패킷: 지금까지 디섹션한 결과만 사용 */
  }
  if (!c.summary.protocol) c.summary.protocol = 'Data'
  return { frame, layers: c.layers, summary: c.summary }
}

function ethernet(c: Ctx, o: number): void {
  if (!c.has(o, 14)) return data(c, o)
  const dst = formatMac(c.b, o)
  const src = formatMac(c.b, o + 6)
  const l = c.layer('Ethernet', `Ethernet II, Src: ${src}, Dst: ${dst}`, o, o + 14)
  l.fields.push(f('Destination', dst, o, 6), f('Source', src, o + 6, 6))
  c.summary.src = src
  c.summary.dst = dst
  let p = o + 12
  let et = c.u16(p)
  while ((et === 0x8100 || et === 0x88a8) && c.has(p, 6)) {
    const tci = c.u16(p + 2)
    l.fields.push(
      f(et === 0x8100 ? '802.1Q VLAN' : '802.1ad', `ID: ${tci & 0xfff}, PRI: ${tci >> 13}`, p, 4, [
        f('Priority', tci >> 13, p + 2, 2),
        f('VLAN ID', tci & 0xfff, p + 2, 2),
      ]),
    )
    p += 4
    et = c.u16(p)
  }
  l.fields.push(f('Type', `${ETHERTYPES[et] ?? 'Unknown'} (${hex4(et)})`, p, 2))
  l.end = p + 2
  etherPayload(c, et, p + 2)
}

function sll(c: Ctx, o: number): void {
  if (!c.has(o, 16)) return data(c, o)
  const proto = c.u16(o + 14)
  const alen = c.u16(o + 4)
  const addr = Array.from(c.b.subarray(o + 6, o + 6 + Math.min(alen, 8)), hex2).join(':')
  const l = c.layer('SLL', `Linux cooked capture, Src: ${addr}`, o, o + 16)
  l.fields.push(f('Packet type', c.u16(o), o, 2), f('Source', addr, o + 6, 8), f('Protocol', `${ETHERTYPES[proto] ?? 'Unknown'} (${hex4(proto)})`, o + 14, 2))
  c.summary.src = addr
  etherPayload(c, proto, o + 16)
}

function etherPayload(c: Ctx, et: number, o: number): void {
  if (et === 0x0800 || et === 0x86dd) ipAny(c, o)
  else if (et === 0x0806) arp(c, o)
  else data(c, o)
}

function arp(c: Ctx, o: number): void {
  if (!c.has(o, 28)) return data(c, o)
  const op = c.u16(o + 6)
  const sha = formatMac(c.b, o + 8)
  const spa = formatIPv4(c.b, o + 14)
  const tha = formatMac(c.b, o + 18)
  const tpa = formatIPv4(c.b, o + 24)
  const opName = op === 1 ? 'request' : op === 2 ? 'reply' : String(op)
  const l = c.layer('ARP', `Address Resolution Protocol (${opName})`, o, o + 28)
  l.fields.push(
    f('Hardware type', c.u16(o), o, 2),
    f('Protocol type', hex4(c.u16(o + 2)), o + 2, 2),
    f('Opcode', `${opName} (${op})`, o + 6, 2),
    f('Sender MAC', sha, o + 8, 6),
    f('Sender IP', spa, o + 14, 4),
    f('Target MAC', tha, o + 18, 6),
    f('Target IP', tpa, o + 24, 4),
  )
  c.summary.src = sha
  c.summary.dst = op === 1 ? 'Broadcast' : tha
  c.summary.info = op === 1 ? `Who has ${tpa}? Tell ${spa}` : op === 2 ? `${spa} is at ${sha}` : `ARP op ${op}`
}

function ipAny(c: Ctx, o: number): void {
  if (!c.has(o, 1)) return
  const v = c.b[o] >> 4
  if (v === 4) ipv4(c, o)
  else if (v === 6) ipv6(c, o)
  else data(c, o)
}

function ipv4(c: Ctx, o: number): void {
  if (!c.has(o, 20)) return data(c, o)
  const ihl = (c.b[o] & 0x0f) * 4
  const total = c.u16(o + 2)
  const id = c.u16(o + 4)
  const ff = c.u16(o + 6)
  const ttl = c.b[o + 8]
  const proto = c.b[o + 9]
  const csum = c.u16(o + 10)
  const src = formatIPv4(c.b, o + 12)
  const dst = formatIPv4(c.b, o + 16)
  const end = Math.min(o + Math.max(total, ihl), c.b.length)
  const l = c.layer('IPv4', `Internet Protocol Version 4, Src: ${src}, Dst: ${dst}`, o, end)
  const flags: string[] = []
  if (ff & 0x4000) flags.push("Don't fragment")
  if (ff & 0x2000) flags.push('More fragments')
  const calc = c.has(o, ihl) ? inetChecksum(c.b, o, o + ihl, 0) : -1
  // 체크섬 필드 포함 합이 0 이면 정상
  l.fields.push(
    f('Version', 4, o, 1),
    f('Header length', `${ihl} bytes`, o, 1),
    f('DSCP/ECN', hex2(c.b[o + 1]), o + 1, 1),
    f('Total length', total, o + 2, 2),
    f('Identification', `${hex4(id)} (${id})`, o + 4, 2),
    f('Flags', flags.length ? flags.join(', ') : '0', o + 6, 2),
    f('Fragment offset', (ff & 0x1fff) * 8, o + 6, 2),
    f('Time to live', ttl, o + 8, 1),
    f('Protocol', `${IP_PROTOS[proto] ?? 'Unknown'} (${proto})`, o + 9, 1),
    f('Header checksum', `${hex4(csum)}${calc === 0 ? ' [correct]' : calc > 0 ? ' [incorrect]' : ''}`, o + 10, 2),
    f('Source', src, o + 12, 4),
    f('Destination', dst, o + 16, 4),
  )
  if (ihl > 20 && c.has(o, ihl)) l.fields.push(f('Options', `${ihl - 20} bytes`, o + 20, ihl - 20))
  c.summary.src = src
  c.summary.dst = dst
  c.summary.info = ''
  if ((ff & 0x1fff) !== 0) {
    c.summary.info = `Fragmented IP protocol (proto=${IP_PROTOS[proto] ?? proto}, off=${(ff & 0x1fff) * 8})`
    return data(c, o + ihl, undefined, end)
  }
  transport(c, proto, o + ihl, end, { src: c.b.subarray(o + 12, o + 16), dst: c.b.subarray(o + 16, o + 20) })
}

function ipv6(c: Ctx, o: number): void {
  if (!c.has(o, 40)) return data(c, o)
  const plen = c.u16(o + 4)
  let next = c.b[o + 6]
  const hop = c.b[o + 7]
  const src = formatIPv6(c.b, o + 8)
  const dst = formatIPv6(c.b, o + 24)
  const end = Math.min(o + 40 + plen, c.b.length)
  const l = c.layer('IPv6', `Internet Protocol Version 6, Src: ${src}, Dst: ${dst}`, o, end)
  const vtf = c.u32(o)
  l.fields.push(
    f('Version', 6, o, 1),
    f('Traffic class', hex2((vtf >> 20) & 0xff), o, 2),
    f('Flow label', `0x${(vtf & 0xfffff).toString(16).padStart(5, '0')}`, o + 1, 3),
    f('Payload length', plen, o + 4, 2),
    f('Next header', `${IP_PROTOS[next] ?? 'Unknown'} (${next})`, o + 6, 1),
    f('Hop limit', hop, o + 7, 1),
    f('Source', src, o + 8, 16),
    f('Destination', dst, o + 24, 16),
  )
  c.summary.src = src
  c.summary.dst = dst
  let p = o + 40
  // 확장 헤더 건너뛰기 (Hop-by-hop, Routing, Fragment, Dest options)
  while ([0, 43, 44, 60].includes(next) && c.has(p, 8)) {
    const hlen = next === 44 ? 8 : (c.b[p + 1] + 1) * 8
    l.fields.push(f('Extension header', `${IP_PROTOS[next] ?? next} (${hlen} bytes)`, p, hlen))
    next = c.b[p]
    p += hlen
  }
  transport(c, next, p, end, { src: c.b.subarray(o + 8, o + 24), dst: c.b.subarray(o + 24, o + 40) })
}

type Pseudo = { src: Uint8Array; dst: Uint8Array }

function pseudoSum(ps: Pseudo, proto: number, len: number): number {
  let s = 0
  const add = (a: Uint8Array) => {
    for (let i = 0; i < a.length; i += 2) s += (a[i] << 8) | a[i + 1]
  }
  add(ps.src)
  add(ps.dst)
  s += proto
  s += len & 0xffff
  s += len >>> 16
  return s
}

function transport(c: Ctx, proto: number, o: number, end: number, ps: Pseudo): void {
  if (proto === 6) tcp(c, o, end, ps)
  else if (proto === 17) udp(c, o, end, ps)
  else if (proto === 1) icmp(c, o, end, false)
  else if (proto === 58) icmp(c, o, end, true)
  else {
    c.summary.info = `${IP_PROTOS[proto] ?? `Protocol ${proto}`}`
    data(c, o, undefined, end)
  }
}

function icmp(c: Ctx, o: number, end: number, v6: boolean): void {
  if (!c.has(o, 4)) return data(c, o)
  const type = c.b[o]
  const code = c.b[o + 1]
  const names = v6 ? ICMP6_TYPES : ICMP_TYPES
  const name = names[type] ?? `Type ${type}`
  const l = c.layer(v6 ? 'ICMPv6' : 'ICMP', `${v6 ? 'Internet Control Message Protocol v6' : 'Internet Control Message Protocol'}`, o, end)
  l.fields.push(f('Type', `${type} (${name})`, o, 1), f('Code', code, o + 1, 1), f('Checksum', hex4(c.u16(o + 2)), o + 2, 2))
  let info = name
  const echo = v6 ? type === 128 || type === 129 : type === 0 || type === 8
  if (echo && c.has(o, 8)) {
    const id = c.u16(o + 4)
    const seq = c.u16(o + 6)
    l.fields.push(f('Identifier', `${hex4(id)} (${id})`, o + 4, 2), f('Sequence', seq, o + 6, 2))
    info += `  id=${hex4(id)}, seq=${seq}`
    if (end > o + 8) l.fields.push(f('Data', `${end - o - 8} bytes`, o + 8, end - o - 8))
  }
  c.summary.info = info
}

const TCP_FLAGS: [number, string][] = [
  [0x100, 'NS'],
  [0x80, 'CWR'],
  [0x40, 'ECE'],
  [0x20, 'URG'],
  [0x10, 'ACK'],
  [0x08, 'PSH'],
  [0x04, 'RST'],
  [0x02, 'SYN'],
  [0x01, 'FIN'],
]

function tcp(c: Ctx, o: number, end: number, ps: Pseudo): void {
  if (!c.has(o, 20)) return data(c, o)
  const sp = c.u16(o)
  const dp = c.u16(o + 2)
  const seq = c.u32(o + 4)
  const ack = c.u32(o + 8)
  const hlen = (c.b[o + 12] >> 4) * 4
  const fl = ((c.b[o + 12] & 1) << 8) | c.b[o + 13]
  const win = c.u16(o + 14)
  const csum = c.u16(o + 16)
  const flagNames = TCP_FLAGS.filter(([m]) => fl & m).map(([, n]) => n)
  const payloadStart = o + Math.max(hlen, 20)
  const plen = Math.max(0, end - payloadStart)
  const l = c.layer('TCP', `Transmission Control Protocol, Src Port: ${sp}, Dst Port: ${dp}, Seq: ${seq}, Len: ${plen}`, o, Math.min(payloadStart, end))
  let csumNote = ''
  if (end <= c.b.length && hlen >= 20) {
    const ok = inetChecksum(c.b, o, end, pseudoSum(ps, 6, end - o)) === 0
    csumNote = ok ? ' [correct]' : ' [incorrect]'
  }
  l.fields.push(
    f('Source port', portName(sp), o, 2),
    f('Destination port', portName(dp), o + 2, 2),
    f('Sequence number', seq, o + 4, 4),
    f('Acknowledgment number', ack, o + 8, 4),
    f('Header length', `${hlen} bytes`, o + 12, 1),
    f(
      'Flags',
      `${hex4(fl).replace('0x0', '0x')} (${flagNames.join(', ') || 'none'})`,
      o + 12,
      2,
      TCP_FLAGS.map(([m, n]) => f(n, fl & m ? 'Set' : 'Not set', o + 12, 2)),
    ),
    f('Window', win, o + 14, 2),
    f('Checksum', `${hex4(csum)}${csumNote}`, o + 16, 2),
    f('Urgent pointer', c.u16(o + 18), o + 18, 2),
  )
  if (hlen > 20 && c.has(o, hlen)) l.fields.push(tcpOptions(c, o + 20, o + hlen))
  c.summary.info = `${sp} → ${dp} [${flagNames.join(', ')}] Seq=${seq}${fl & 0x10 ? ` Ack=${ack}` : ''} Win=${win} Len=${plen}`
  if (plen > 0) app(c, payloadStart, end, sp, dp, 'tcp')
}

function tcpOptions(c: Ctx, o: number, end: number): PcapField {
  const kids: PcapField[] = []
  let p = o
  while (p < end) {
    const kind = c.b[p]
    if (kind === 0) {
      kids.push(f('End of Option List', '', p, 1))
      break
    }
    if (kind === 1) {
      kids.push(f('No-Operation', '', p, 1))
      p++
      continue
    }
    const len = c.b[p + 1]
    if (!len || len < 2) break
    if (kind === 2 && len === 4) kids.push(f('Maximum segment size', c.u16(p + 2), p, len))
    else if (kind === 3 && len === 3) kids.push(f('Window scale', c.b[p + 2], p, len))
    else if (kind === 4) kids.push(f('SACK permitted', '', p, len))
    else if (kind === 8 && len === 10) kids.push(f('Timestamps', `TSval ${c.u32(p + 2)}, TSecr ${c.u32(p + 6)}`, p, len))
    else kids.push(f(`Option ${kind}`, `${len} bytes`, p, len))
    p += len
  }
  return f('Options', `${end - o} bytes`, o, end - o, kids)
}

function udp(c: Ctx, o: number, end: number, ps: Pseudo): void {
  if (!c.has(o, 8)) return data(c, o)
  const sp = c.u16(o)
  const dp = c.u16(o + 2)
  const len = c.u16(o + 4)
  const csum = c.u16(o + 6)
  const uend = Math.min(o + Math.max(len, 8), end)
  const l = c.layer('UDP', `User Datagram Protocol, Src Port: ${sp}, Dst Port: ${dp}`, o, o + 8)
  let note = ''
  if (csum === 0) note = ' [none]'
  else if (uend <= c.b.length) note = inetChecksum(c.b, o, uend, pseudoSum(ps, 17, uend - o)) === 0 ? ' [correct]' : ' [incorrect]'
  l.fields.push(
    f('Source port', portName(sp), o, 2),
    f('Destination port', portName(dp), o + 2, 2),
    f('Length', len, o + 4, 2),
    f('Checksum', `${hex4(csum)}${note}`, o + 6, 2),
  )
  c.summary.info = `${sp} → ${dp} Len=${Math.max(0, uend - o - 8)}`
  if (uend > o + 8) app(c, o + 8, uend, sp, dp, 'udp')
}

function app(c: Ctx, o: number, end: number, sp: number, dp: number, l4: 'tcp' | 'udp'): void {
  const isPort = (...ps: number[]) => ps.includes(sp) || ps.includes(dp)
  if (isPort(53, 5353) && (l4 === 'udp' || end - o > 2)) {
    if (dns(c, l4 === 'tcp' ? o + 2 : o, end)) return
  }
  const head = ascii(c.b, o, Math.min(end, o + 32))
  if (HTTP_START.test(head)) return http(c, o, end)
  if (l4 === 'tcp' && end - o >= 5 && TLS_CONTENT[c.b[o]] && c.b[o + 1] === 3 && c.b[o + 2] <= 4) return tls(c, o, end)
  data(c, o, undefined, end)
}

function ascii(b: Uint8Array, s: number, e: number): string {
  let out = ''
  for (let i = s; i < e && i < b.length; i++) out += String.fromCharCode(b[i])
  return out
}

function dnsName(c: Ctx, o: number, base: number): { name: string; next: number } {
  const labels: string[] = []
  let p = o
  let next = -1
  let hops = 0
  while (c.has(p, 1)) {
    const len = c.b[p]
    if (len === 0) {
      p++
      break
    }
    if ((len & 0xc0) === 0xc0) {
      if (next < 0) next = p + 2
      p = base + (((len & 0x3f) << 8) | c.b[p + 1])
      if (++hops > 32) break
      continue
    }
    labels.push(ascii(c.b, p + 1, p + 1 + len))
    p += len + 1
  }
  return { name: labels.join('.') || '<Root>', next: next < 0 ? p : next }
}

function dns(c: Ctx, o: number, end: number): boolean {
  if (end - o < 12) return false
  const id = c.u16(o)
  const fl = c.u16(o + 2)
  const qd = c.u16(o + 4)
  const an = c.u16(o + 6)
  const ns = c.u16(o + 8)
  const ar = c.u16(o + 10)
  if (qd > 64 || an > 256) return false
  const resp = !!(fl & 0x8000)
  const rcode = fl & 0xf
  const l = c.layer('DNS', `Domain Name System (${resp ? 'response' : 'query'})`, o, end)
  l.fields.push(
    f('Transaction ID', hex4(id), o, 2),
    f('Flags', `${hex4(fl)} ${resp ? 'Standard query response' : 'Standard query'}${resp ? `, ${DNS_RCODES[rcode] ?? rcode}` : ''}`, o + 2, 2),
    f('Questions', qd, o + 4, 2),
    f('Answer RRs', an, o + 6, 2),
    f('Authority RRs', ns, o + 8, 2),
    f('Additional RRs', ar, o + 10, 2),
  )
  let p = o + 12
  const qs: PcapField[] = []
  const infoParts: string[] = []
  for (let i = 0; i < qd && p < end; i++) {
    const n = dnsName(c, p, o)
    const type = c.u16(n.next)
    const t = DNS_TYPES[type] ?? String(type)
    qs.push(f(n.name, `type ${t}, class ${c.u16(n.next + 2) === 1 ? 'IN' : c.u16(n.next + 2)}`, p, n.next + 4 - p))
    infoParts.push(`${t} ${n.name}`)
    p = n.next + 4
  }
  if (qs.length) l.fields.push(f('Queries', qs.length, qs[0].start, p - qs[0].start, qs))
  const ans: PcapField[] = []
  for (let i = 0; i < an && p + 10 < end; i++) {
    const n = dnsName(c, p, o)
    const q = n.next
    const type = c.u16(q)
    const rdlen = c.u16(q + 8)
    const rd = q + 10
    const t = DNS_TYPES[type] ?? String(type)
    let val = `${rdlen} bytes`
    if (type === 1 && rdlen === 4) val = formatIPv4(c.b, rd)
    else if (type === 28 && rdlen === 16) val = formatIPv6(c.b, rd)
    else if (type === 5 || type === 2 || type === 12) val = dnsName(c, rd, o).name
    ans.push(f(n.name, `type ${t}, TTL ${c.u32(q + 4)}, ${val}`, p, rd + rdlen - p))
    infoParts.push(`${t} ${val}`)
    p = rd + rdlen
  }
  if (ans.length) l.fields.push(f('Answers', ans.length, ans[0].start, p - ans[0].start, ans))
  c.summary.info = `${resp ? 'Standard query response' : 'Standard query'} ${hex4(id)} ${infoParts.join(' ')}${resp && rcode ? ` ${DNS_RCODES[rcode] ?? rcode}` : ''}`
  return true
}

function http(c: Ctx, o: number, end: number): void {
  const text = ascii(c.b, o, end)
  const hdrEnd = text.indexOf('\r\n\r\n')
  const headEnd = hdrEnd < 0 ? end : o + hdrEnd + 4
  const l = c.layer('HTTP', 'Hypertext Transfer Protocol', o, end)
  let p = o
  const lines = (hdrEnd < 0 ? text : text.slice(0, hdrEnd)).split('\r\n')
  lines.forEach((line, i) => {
    const len = line.length + 2
    const colon = line.indexOf(':')
    if (i === 0) l.fields.push(f('Request/Status line', line, p, len))
    else if (colon > 0) l.fields.push(f(line.slice(0, colon), line.slice(colon + 1).trim(), p, len))
    else if (line) l.fields.push(f('Line', line, p, len))
    p += len
  })
  if (headEnd < end) l.fields.push(f('Body', `${end - headEnd} bytes`, headEnd, end - headEnd))
  c.summary.info = lines[0]
}

function tls(c: Ctx, o: number, end: number): void {
  const infos: string[] = []
  let p = o
  let n = 0
  while (p + 5 <= end && n < 32) {
    const ct = c.b[p]
    if (!TLS_CONTENT[ct] || c.b[p + 1] !== 3) break
    const ver = c.u16(p + 1)
    const len = c.u16(p + 3)
    const rend = Math.min(p + 5 + len, end)
    const l = c.layer('TLS', `TLS Record Layer: ${TLS_CONTENT[ct]}`, p, rend)
    l.fields.push(
      f('Content type', `${TLS_CONTENT[ct]} (${ct})`, p, 1),
      f('Version', `${TLS_VERSIONS[ver] ?? hex4(ver)} (${hex4(ver)})`, p + 1, 2),
      f('Length', len, p + 3, 2),
    )
    let info = TLS_CONTENT[ct]
    if (ct === 22 && rend - p > 9) {
      const hs = c.b[p + 5]
      const hsName = TLS_HS[hs] ?? `Handshake ${hs}`
      info = hsName
      l.fields.push(f('Handshake type', `${hsName} (${hs})`, p + 5, 1))
      if (hs === 1) {
        const sni = clientHelloSni(c, p + 9, rend)
        if (sni) {
          l.fields.push(f('Server Name (SNI)', sni.name, sni.start, sni.len))
          info += ` (SNI=${sni.name})`
        }
      }
    } else if (ct === 21 && rend - p >= 7) {
      l.fields.push(f('Alert', `level ${c.b[p + 5]}, description ${c.b[p + 6]}`, p + 5, 2))
    } else if (ct === 23) {
      l.fields.push(f('Encrypted data', `${rend - p - 5} bytes`, p + 5, rend - p - 5))
    }
    infos.push(info)
    p = rend
    n++
  }
  if (infos.length) c.summary.info = infos.join(', ')
  if (p < end) data(c, p, undefined, end)
}

function clientHelloSni(c: Ctx, o: number, end: number): { name: string; start: number; len: number } | null {
  // version(2) random(32) session_id
  let p = o + 34
  if (p >= end) return null
  p += 1 + c.b[p]
  if (p + 2 > end) return null
  p += 2 + c.u16(p) // cipher suites
  if (p + 1 > end) return null
  p += 1 + c.b[p] // compression
  if (p + 2 > end) return null
  const extEnd = Math.min(p + 2 + c.u16(p), end)
  p += 2
  while (p + 4 <= extEnd) {
    const type = c.u16(p)
    const len = c.u16(p + 2)
    if (type === 0 && p + 9 <= extEnd) {
      const nlen = c.u16(p + 7)
      return { name: ascii(c.b, p + 9, Math.min(p + 9 + nlen, extEnd)), start: p + 9, len: nlen }
    }
    p += 4 + len
  }
  return null
}

function data(c: Ctx, o: number, title?: string, end = c.b.length): void {
  if (o >= end) return
  const len = end - o
  const l: PcapLayer = { proto: 'Data', title: title ?? `Data (${len} bytes)`, start: o, end, fields: [] }
  l.fields.push(f('Data', previewAscii(c.b, o, Math.min(end, o + 64)) + (len > 64 ? '…' : ''), o, len))
  c.layers.push(l)
  if (!c.summary.protocol) c.summary.protocol = 'Data'
  if (!c.summary.info) c.summary.info = `${len} bytes`
}

function previewAscii(b: Uint8Array, s: number, e: number): string {
  let out = ''
  for (let i = s; i < e; i++) out += b[i] >= 32 && b[i] < 127 ? String.fromCharCode(b[i]) : '.'
  return out
}

/** 캡처 전체 디섹션 */
export function analyzeCapture(bytes: Uint8Array, maxFrames = MAX_FRAMES): (PcapCapture & { packets: DissectedFrame[] }) | null {
  const cap = parseCapture(bytes, maxFrames)
  if (!cap) return null
  return { ...cap, packets: cap.frames.map(dissectFrame) }
}

/** 필드 트리에서 offset 을 포함하는 가장 깊은(좁은) 필드 */
export function fieldAt(layers: PcapLayer[], offset: number): PcapField | PcapLayer | null {
  let best: PcapField | PcapLayer | null = null
  const width = (x: { start: number; end: number }) => x.end - x.start
  const visit = (x: PcapField) => {
    if (offset < x.start || offset >= x.end) return
    if (!best || width(x) <= width(best)) best = x
    x.children?.forEach(visit)
  }
  for (const l of layers) {
    if (offset < l.start || offset >= l.end) continue
    if (!best || width(l) <= width(best)) best = l
    l.fields.forEach(visit)
  }
  return best
}

/** Wireshark 스타일 간이 표시 필터: `tcp`, `ip.addr==1.2.3.4`, `port 443`, 일반 텍스트 */
export function matchPacketFilter(p: DissectedFrame, filter: string): boolean {
  const q = filter.trim().toLowerCase()
  if (!q) return true
  return q.split(/\s*(?:&&|\band\b)\s*/).every((term) => {
    const t = term.trim()
    if (!t) return true
    const neg = t.startsWith('!') || t.startsWith('not ')
    const body = t.replace(/^!\s*|^not\s+/, '')
    return neg !== matchTerm(p, body)
  })
}

function matchTerm(p: DissectedFrame, t: string): boolean {
  const protos = p.layers.map((l) => l.proto.toLowerCase())
  const s = p.summary
  const m1 = /^([a-z0-9.]+)\s*(==|=|!=)\s*(.+)$/.exec(t)
  const m2 = /^(port|host|src|dst)\s+(\S+)$/.exec(t)
  const kv = m1 ? [m1[1], m1[2], m1[3]] : m2 ? [m2[1], '==', m2[2]] : null
  if (kv) {
    const [key, op, raw] = kv
    const val = raw.replace(/^"|"$/g, '')
    let hit: boolean
    const ports = () => p.layers.filter((l) => l.proto === 'TCP' || l.proto === 'UDP').flatMap((l) => l.fields.slice(0, 2).map((x) => x.value.split(' ')[0]))
    if (key === 'ip.addr' || key === 'host' || key === 'addr') hit = s.src.toLowerCase() === val || s.dst.toLowerCase() === val
    else if (key === 'ip.src' || key === 'src') hit = s.src.toLowerCase() === val
    else if (key === 'ip.dst' || key === 'dst') hit = s.dst.toLowerCase() === val
    else if (key === 'port' || key === 'tcp.port' || key === 'udp.port') hit = ports().includes(val)
    else if (key === 'frame.no' || key === 'no') hit = String(p.frame.no) === val
    else hit = false
    return op === '!=' ? !hit : hit
  }
  if (protos.includes(t)) return true
  if (t === 'ip' && protos.includes('ipv4')) return true
  return `${s.src} ${s.dst} ${s.protocol} ${s.info}`.toLowerCase().includes(t)
}

/** 캡처를 libpcap(.pcap) 파일로 직렬화 — Wireshark 로 내보내기용 */
export function toPcapFile(frames: readonly PcapFrame[]): Uint8Array {
  const linkType = frames[0]?.linkType ?? LINKTYPE.ETHERNET
  const total = 24 + frames.reduce((a, fr) => a + 16 + fr.data.length, 0)
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0xa1b2c3d4, true)
  dv.setUint16(4, 2, true)
  dv.setUint16(6, 4, true)
  dv.setUint32(16, 0x40000, true)
  dv.setUint32(20, linkType, true)
  let off = 24
  for (const fr of frames) {
    const ts = fr.ts ?? 0
    const sec = Math.floor(ts)
    dv.setUint32(off, sec, true)
    dv.setUint32(off + 4, Math.round((ts - sec) * 1e6), true)
    dv.setUint32(off + 8, fr.data.length, true)
    dv.setUint32(off + 12, Math.max(fr.origLen, fr.data.length), true)
    out.set(fr.data, off + 16)
    off += 16 + fr.data.length
  }
  return out
}
