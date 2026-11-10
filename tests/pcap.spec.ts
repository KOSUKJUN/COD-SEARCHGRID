import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  LINKTYPE,
  analyzeCapture,
  dissectFrame,
  fieldAt,
  formatIPv6,
  inetChecksum,
  looksLikePacket,
  matchPacketFilter,
  parseCapture,
  toPcapFile,
  type PcapFrame,
} from '../src/utils/pcap'
import { generateEvents } from '../mock-server/generate'
import PcapViewer from '../src/components/PcapViewer.vue'
import EventDetail from '../src/components/EventDetail.vue'

const ip = (a: string) => a.split('.').map(Number)
const str = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

function ipv4(src: string, dst: string, proto: number, l4: number[]): number[] {
  const total = 20 + l4.length
  const h = [0x45, 0, total >> 8, total & 0xff, 0x12, 0x34, 0x40, 0, 64, proto, 0, 0, ...ip(src), ...ip(dst)]
  const c = inetChecksum(Uint8Array.from(h), 0, 20)
  h[10] = c >> 8
  h[11] = c & 0xff
  return [...h, ...l4]
}
function tcp(sp: number, dp: number, flags: number, data: number[] = []): number[] {
  return [sp >> 8, sp & 0xff, dp >> 8, dp & 0xff, 0, 0, 0, 1, 0, 0, 0, 0, 0x50, flags, 0xfa, 0xf0, 0, 0, 0, 0, ...data]
}
function udp(sp: number, dp: number, data: number[]): number[] {
  const len = 8 + data.length
  return [sp >> 8, sp & 0xff, dp >> 8, dp & 0xff, len >> 8, len & 0xff, 0, 0, ...data]
}
function eth(payload: number[], type = 0x0800): number[] {
  return [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, type >> 8, type & 0xff, ...payload]
}
function pcap(frames: number[][], linkType: number = LINKTYPE.ETHERNET): Uint8Array {
  return toPcapFile(
    frames.map((d, i): PcapFrame => ({ no: i + 1, ts: 1700000000 + i * 0.5, linkType, capLen: d.length, origLen: d.length, data: Uint8Array.from(d) })),
  )
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

const httpReq = str('GET /index.html HTTP/1.1\r\nHost: example.com\r\n\r\n')
const dnsQuery = [0xab, 0xcd, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0, 7, ...str('example'), 3, ...str('com'), 0, 0, 1, 0, 1]

describe('parseCapture', () => {
  it('libpcap 파일: 패킷 수 · 타임스탬프 · 링크타입', () => {
    const file = pcap([eth(ipv4('10.0.0.1', '10.0.0.2', 6, tcp(1234, 80, 0x02))), eth(ipv4('10.0.0.2', '10.0.0.1', 6, tcp(80, 1234, 0x12)))])
    const c = parseCapture(file)!
    expect(c.format).toBe('pcap')
    expect(c.frames).toHaveLength(2)
    expect(c.frames[1].ts).toBeCloseTo(1700000000.5, 5)
    expect(c.frames[0].linkType).toBe(LINKTYPE.ETHERNET)
  })

  it('big-endian pcap 도 읽는다', () => {
    const d = eth(ipv4('1.1.1.1', '2.2.2.2', 17, udp(53, 53, dnsQuery)))
    const out = new Uint8Array(24 + 16 + d.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, 0xa1b2c3d4, false)
    dv.setUint32(20, 1, false)
    dv.setUint32(24, 100, false)
    dv.setUint32(32, d.length, false)
    dv.setUint32(36, d.length, false)
    out.set(d, 40)
    const c = parseCapture(out)!
    expect(c.frames).toHaveLength(1)
    expect(c.frames[0].ts).toBe(100)
  })

  it('pcapng (SHB + IDB + EPB)', () => {
    const d = Uint8Array.from(eth(ipv4('10.0.0.1', '10.0.0.2', 6, tcp(1, 2, 0x02))))
    const pad = (n: number) => Math.ceil(n / 4) * 4
    const shb = new Uint8Array(28)
    let dv = new DataView(shb.buffer)
    dv.setUint32(0, 0x0a0d0d0a, true)
    dv.setUint32(4, 28, true)
    dv.setUint32(8, 0x1a2b3c4d, true)
    dv.setUint16(12, 1, true)
    dv.setInt32(16, -1, true)
    dv.setInt32(20, -1, true)
    dv.setUint32(24, 28, true)
    const idb = new Uint8Array(20)
    dv = new DataView(idb.buffer)
    dv.setUint32(0, 1, true)
    dv.setUint32(4, 20, true)
    dv.setUint16(8, 1, true)
    dv.setUint32(16, 20, true)
    const elen = 32 + pad(d.length)
    const epb = new Uint8Array(elen)
    dv = new DataView(epb.buffer)
    dv.setUint32(0, 6, true)
    dv.setUint32(4, elen, true)
    dv.setUint32(12, 0, true)
    dv.setUint32(16, 2_000_000, true) // 2초 (µs)
    dv.setUint32(20, d.length, true)
    dv.setUint32(24, d.length, true)
    epb.set(d, 28)
    dv.setUint32(elen - 4, elen, true)
    const file = new Uint8Array([...shb, ...idb, ...epb])
    const c = parseCapture(file)!
    expect(c.format).toBe('pcapng')
    expect(c.frames).toHaveLength(1)
    expect(c.frames[0].ts).toBe(2)
    expect(dissectFrame(c.frames[0]).summary.protocol).toBe('TCP')
  })

  it('raw IPv4 패킷은 단일 프레임', () => {
    const c = parseCapture(Uint8Array.from(ipv4('10.0.0.1', '8.8.8.8', 6, tcp(5555, 443, 0x18))))!
    expect(c.format).toBe('raw')
    expect(c.frames[0].linkType).toBe(LINKTYPE.RAW)
  })

  it('텍스트는 패킷이 아님', () => {
    expect(looksLikePacket(Uint8Array.from(str('hello world, this is not a packet')))).toBe(false)
    expect(parseCapture(Uint8Array.from(str('hi')))).toBeNull()
  })
})

describe('dissectFrame', () => {
  const frame = (d: number[], linkType: number = LINKTYPE.ETHERNET): PcapFrame => ({ no: 1, ts: 0, linkType, capLen: d.length, origLen: d.length, data: Uint8Array.from(d) })

  it('Ethernet → IPv4 → TCP → HTTP', () => {
    const p = dissectFrame(frame(eth(ipv4('192.168.0.10', '93.184.216.34', 6, tcp(51000, 80, 0x18, httpReq)))))
    expect(p.layers.map((l) => l.proto)).toEqual(['Ethernet', 'IPv4', 'TCP', 'HTTP'])
    expect(p.summary).toMatchObject({ src: '192.168.0.10', dst: '93.184.216.34', protocol: 'HTTP', info: 'GET /index.html HTTP/1.1' })
    const ipl = p.layers[1]
    expect(ipl.fields.find((f) => f.name === 'Header checksum')!.value).toContain('[correct]')
    expect(p.layers[3].fields.find((f) => f.name === 'Host')!.value).toBe('example.com')
  })

  it('TCP 플래그 요약', () => {
    const p = dissectFrame(frame(ipv4('10.0.0.1', '10.0.0.2', 6, tcp(1234, 443, 0x12)), LINKTYPE.RAW))
    expect(p.summary.protocol).toBe('TCP')
    expect(p.summary.info).toContain('[ACK, SYN]')
    expect(p.summary.info).toContain('1234 → 443')
  })

  it('UDP → DNS 쿼리', () => {
    const p = dissectFrame(frame(eth(ipv4('10.0.0.1', '10.0.0.53', 17, udp(40000, 53, dnsQuery)))))
    expect(p.summary.protocol).toBe('DNS')
    expect(p.summary.info).toBe('Standard query 0xabcd A example.com')
  })

  it('ARP', () => {
    const arp = [0, 1, 8, 0, 6, 4, 0, 1, 0, 0x11, 0x22, 0x33, 0x44, 0x55, ...ip('10.0.0.1'), 0, 0, 0, 0, 0, 0, ...ip('10.0.0.254')]
    const p = dissectFrame(frame(eth(arp, 0x0806)))
    expect(p.summary.protocol).toBe('ARP')
    expect(p.summary.info).toBe('Who has 10.0.0.254? Tell 10.0.0.1')
  })

  it('IPv6 → ICMPv6 echo', () => {
    const src = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
    const dst = [0xfe, 0x80, ...new Array(13).fill(0), 2]
    const icmp = [128, 0, 0, 0, 0, 7, 0, 1]
    const v6 = [0x60, 0, 0, 0, 0, icmp.length, 58, 64, ...src, ...dst, ...icmp]
    const p = dissectFrame(frame(eth(v6, 0x86dd)))
    expect(p.summary).toMatchObject({ src: '2001:db8::1', dst: 'fe80::2', protocol: 'ICMPv6' })
    expect(p.summary.info).toContain('Echo request')
  })

  it('TLS Client Hello SNI', () => {
    const sni = str('secure.example.com')
    const ext = [0, 0, 0, sni.length + 5, 0, sni.length + 3, 0, 0, sni.length, ...sni]
    const body = [3, 3, ...new Array(32).fill(0), 0, 0, 2, 0x13, 0x01, 1, 0, 0, ext.length, ...ext]
    const hs = [1, 0, body.length >> 8, body.length & 0xff, ...body]
    const rec = [22, 3, 1, hs.length >> 8, hs.length & 0xff, ...hs]
    const p = dissectFrame(frame(ipv4('10.0.0.1', '1.1.1.1', 6, tcp(50000, 443, 0x18, rec)), LINKTYPE.RAW))
    expect(p.summary.protocol).toBe('TLS')
    expect(p.summary.info).toBe('Client Hello (SNI=secure.example.com)')
  })

  it('잘린 패킷도 예외 없이 처리', () => {
    const full = eth(ipv4('10.0.0.1', '10.0.0.2', 6, tcp(1, 2, 0x18, httpReq)))
    const p = dissectFrame(frame(full.slice(0, 40)))
    expect(p.layers[0].proto).toBe('Ethernet')
  })

  it('fieldAt: 바이트 오프셋 → 가장 좁은 필드', () => {
    const p = dissectFrame(frame(eth(ipv4('10.0.0.1', '10.0.0.2', 6, tcp(1, 2, 0x02)))))
    expect(fieldAt(p.layers, 14 + 12)).toMatchObject({ name: 'Source', value: '10.0.0.1' })
    expect(fieldAt(p.layers, 0)).toMatchObject({ name: 'Destination' })
  })
})

describe('matchPacketFilter / misc', () => {
  const cap = analyzeCapture(
    pcap([
      eth(ipv4('10.0.0.1', '10.0.0.53', 17, udp(40000, 53, dnsQuery))),
      eth(ipv4('10.0.0.1', '93.184.216.34', 6, tcp(51000, 80, 0x18, httpReq))),
    ]),
  )!
  const run = (q: string) => cap.packets.filter((p) => matchPacketFilter(p, q)).map((p) => p.frame.no)

  it('프로토콜 / 주소 / 포트 / 부정 / and', () => {
    expect(run('dns')).toEqual([1])
    expect(run('tcp')).toEqual([2])
    expect(run('ip')).toEqual([1, 2])
    expect(run('ip.dst==10.0.0.53')).toEqual([1])
    expect(run('port 80')).toEqual([2])
    expect(run('!dns')).toEqual([2])
    expect(run('ip.src==10.0.0.1 && http')).toEqual([2])
    expect(run('index.html')).toEqual([2])
  })

  it('IPv6 축약 표기', () => {
    expect(formatIPv6(Uint8Array.from(new Array(16).fill(0)), 0)).toBe('::')
    expect(formatIPv6(Uint8Array.from([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]), 0)).toBe('2001:db8::1:0:0:1')
  })

  it('mock 데이터의 패킷 payload 는 체크섬까지 정상으로 디섹션된다', () => {
    const evs = generateEvents(2000).filter((e) => e.payload_encoding === 'base64')
    const sessions = evs.filter((e) => e.sourcetype === 'pcap')
    const alerts = evs.filter((e) => e.sourcetype === 'suricata:alert')
    expect(sessions.length).toBeGreaterThan(0)
    expect(alerts.length).toBeGreaterThan(0)
    const toBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
    const s = analyzeCapture(toBytes(sessions[0].payload!))!
    expect(s.format).toBe('pcap')
    expect(s.packets.map((p) => p.summary.protocol)).toEqual(['DNS', 'DNS', 'TCP', 'TCP', 'TCP', 'HTTP', 'HTTP', 'TCP', 'TCP', 'TCP'])
    for (const e of [sessions[0], ...alerts.slice(0, 20)]) {
      for (const p of analyzeCapture(toBytes(e.payload!))!.packets) {
        const tcpL = p.layers.find((l) => l.proto === 'TCP' || l.proto === 'UDP')!
        expect(tcpL.fields.find((f) => f.name === 'Checksum')!.value).toContain('[correct]')
        expect(p.layers.find((l) => l.proto === 'IPv4')!.fields.find((f) => f.name === 'Header checksum')!.value).toContain('[correct]')
      }
    }
  })
})

describe('PcapViewer / EventDetail', () => {
  const file = pcap([
    eth(ipv4('10.0.0.1', '10.0.0.53', 17, udp(40000, 53, dnsQuery))),
    eth(ipv4('10.0.0.1', '93.184.216.34', 6, tcp(51000, 80, 0x18, httpReq))),
  ])

  it('패킷 목록 · 트리 · hex 강조', async () => {
    const w = mount(PcapViewer, { props: { value: b64(file), encoding: 'base64' } })
    const rows = w.findAll('.csg-pcap__table tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('DNS')
    await rows[1].trigger('click')
    expect(w.find('.csg-pcap__tree').text()).toContain('Hypertext Transfer Protocol')
    // IPv4 Source 필드 클릭 → hex 4바이트 강조
    const node = w
      .findAll('.csg-pcap__node')
      .find((n) => n.find('.csg-pcap__fname').exists() && n.find('.csg-pcap__fname').text() === 'Source' && n.find('.csg-pcap__fval').text() === '10.0.0.1')!
    await node.trigger('click')
    expect(w.findAll('.csg-pcap__bytes .csg-pcap__b--on')).toHaveLength(4)
    // 필터
    await w.find('.csg-pcap__filter').setValue('http')
    expect(w.findAll('.csg-pcap__table tbody tr')).toHaveLength(1)
  })

  it('패킷이 아니면 안내 문구', () => {
    const w = mount(PcapViewer, { props: { value: 'plain text payload', encoding: null } })
    expect(w.text()).toContain('해석할 수 없는')
  })

  it('상세보기: 패킷 payload 면 Payload 옆에 PCAP 분석 탭', async () => {
    const w = mount(EventDetail, { props: { row: { _time: 'x', payload: b64(file), payload_encoding: 'base64' } } })
    const tabs = w.findAll('.csg-tabs__btn').map((b) => b.text())
    expect(tabs).toEqual(['필드', 'Payload', 'PCAP 분석', 'JSON'])
    await w.setProps({ tab: 'pcap' })
    expect(w.find('.csg-pcap').exists()).toBe(true)
  })

  it('텍스트 payload 이거나 pcap=false 면 탭 없음', () => {
    const w1 = mount(EventDetail, { props: { row: { payload: 'GET / HTTP/1.1\r\n\r\n' } } })
    expect(w1.text()).not.toContain('PCAP')
    const w2 = mount(EventDetail, { props: { row: { payload: b64(file), payload_encoding: 'base64' }, pcap: false } })
    expect(w2.text()).not.toContain('PCAP')
  })
})
