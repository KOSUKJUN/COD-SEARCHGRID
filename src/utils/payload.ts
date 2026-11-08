/**
 * 이벤트 payload 분석: JSON / 텍스트 / base64 / hex 를 판별하고 보기용 문자열을 만든다.
 */

export type PayloadView = 'text' | 'json' | 'hex'
export type PayloadEncoding = 'text' | 'base64' | 'hex' | 'object'

export interface PayloadInfo {
  encoding: PayloadEncoding
  /** 디코딩된 바이트 수 */
  size: number
  bytes: Uint8Array
  /** 사람이 읽을 수 있는 텍스트 (binary 면 제어문자를 '.' 으로 치환) */
  text: string
  /** JSON 으로 해석 가능하면 pretty print 결과 */
  json: string | null
  binary: boolean
  defaultView: PayloadView
}

const encoder = new TextEncoder()

export function decodeBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/\s+/g, ''))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function decodeHex(s: string): Uint8Array | null {
  const t = s.replace(/\s+|0x/gi, '')
  if (t.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(t)) return null
  const out = new Uint8Array(t.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16)
  return out
}

/** 휴리스틱: 영문 대/소문자 + 숫자/기호가 섞인 4의 배수 길이 문자열 */
export function looksLikeBase64(s: string): boolean {
  const t = s.replace(/\s+/g, '')
  return (
    t.length >= 16 &&
    t.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(t) &&
    /[0-9+/]/.test(t) &&
    /[A-Z]/.test(t) &&
    /[a-z]/.test(t)
  )
}

function tryPrettyJson(text: string): string | null {
  const t = text.trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return null
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return null
  }
}

function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096)
  if (!n) return false
  let bad = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 9 || b === 10 || b === 13) continue
    if (b < 32 || b === 127) bad++
  }
  return bad / n > 0.05
}

function printable(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b === 10 || b === 9 || (b >= 32 && b < 127) ? String.fromCharCode(b) : '.'
  return s
}

function fromBytes(bytes: Uint8Array, encoding: PayloadEncoding): PayloadInfo {
  const binary = isBinary(bytes)
  const text = binary ? printable(bytes) : new TextDecoder('utf-8').decode(bytes)
  const json = binary ? null : tryPrettyJson(text)
  return { encoding, size: bytes.length, bytes, text, json, binary, defaultView: binary ? 'hex' : json ? 'json' : 'text' }
}

/**
 * @param value payload 값 (string | object)
 * @param encodingHint 'base64' | 'hex' | 'text' — 지정하지 않으면 자동 판별
 */
export function analyzePayload(value: unknown, encodingHint?: string | null): PayloadInfo | null {
  if (value == null || value === '') return null
  if (typeof value === 'object') {
    const json = JSON.stringify(value, null, 2)
    const bytes = encoder.encode(json)
    return { encoding: 'object', size: bytes.length, bytes, text: json, json, binary: false, defaultView: 'json' }
  }
  const s = String(value)
  const hint = encodingHint ? String(encodingHint).toLowerCase() : ''
  if (hint === 'base64' || (!hint && looksLikeBase64(s))) {
    const bytes = decodeBase64(s)
    if (bytes) return fromBytes(bytes, 'base64')
  }
  if (hint === 'hex') {
    const bytes = decodeHex(s)
    if (bytes) return fromBytes(bytes, 'hex')
  }
  const bytes = encoder.encode(s)
  const json = tryPrettyJson(s)
  return { encoding: 'text', size: bytes.length, bytes, text: s, json, binary: false, defaultView: json ? 'json' : 'text' }
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** `00000000  48 65 6c 6c 6f ...  |Hello...|` 형식 hex dump */
export function hexDump(bytes: Uint8Array, maxBytes = 64 * 1024): { text: string; truncated: boolean } {
  const n = Math.min(bytes.length, maxBytes)
  const lines: string[] = []
  for (let off = 0; off < n; off += 16) {
    const end = Math.min(off + 16, n)
    let hex = ''
    let ascii = ''
    for (let i = off; i < off + 16; i++) {
      if (i === off + 8) hex += ' '
      if (i < end) {
        const b = bytes[i]
        hex += HEX[b] + ' '
        ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '.'
      } else hex += '   '
    }
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex} |${ascii}|`)
  }
  return { text: lines.join('\n'), truncated: bytes.length > maxBytes }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
