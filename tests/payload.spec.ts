import { describe, expect, it } from 'vitest'
import { analyzePayload, hexDump, looksLikeBase64 } from '../src/utils/payload'

describe('analyzePayload', () => {
  it('없는 값은 null', () => {
    expect(analyzePayload(undefined)).toBeNull()
    expect(analyzePayload('')).toBeNull()
  })

  it('JSON 문자열은 pretty print 하고 기본 보기는 json', () => {
    const p = analyzePayload('{"a":1,"b":[2]}')!
    expect(p.encoding).toBe('text')
    expect(p.defaultView).toBe('json')
    expect(p.json).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}')
  })

  it('객체는 JSON', () => {
    const p = analyzePayload({ x: 'y' })!
    expect(p.encoding).toBe('object')
    expect(p.defaultView).toBe('json')
  })

  it('일반 텍스트', () => {
    const p = analyzePayload('GET / HTTP/1.1\r\nHost: a\r\n')!
    expect(p.defaultView).toBe('text')
    expect(p.binary).toBe(false)
    expect(p.size).toBe(25)
  })

  it('base64 힌트 + 바이너리 → hex', () => {
    const bin = String.fromCharCode(0x45, 0, 0, 0x3c, 1, 2, 3, 0, 0xff, 0x10) + 'GET /'
    const p = analyzePayload(btoa(bin), 'base64')!
    expect(p.encoding).toBe('base64')
    expect(p.binary).toBe(true)
    expect(p.defaultView).toBe('hex')
    expect(p.text.endsWith('GET /')).toBe(true)
  })

  it('base64 텍스트 자동 판별', () => {
    const b64 = btoa('{"user":"admin","ok":true}')
    expect(looksLikeBase64(b64)).toBe(true)
    const p = analyzePayload(b64)!
    expect(p.encoding).toBe('base64')
    expect(p.defaultView).toBe('json')
  })

  it('일반 단어는 base64 로 오판하지 않음', () => {
    expect(looksLikeBase64('administrator')).toBe(false)
    expect(analyzePayload('connectionrefused')!.encoding).toBe('text')
  })

  it('hex 힌트', () => {
    const p = analyzePayload('48 65 6c 6c 6f', 'hex')!
    expect(p.text).toBe('Hello')
  })
})

describe('hexDump', () => {
  it('offset / hex / ascii 형식', () => {
    const bytes = new TextEncoder().encode('Hello, World! 123')
    const { text, truncated } = hexDump(bytes)
    const lines = text.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('00000000  48 65 6c 6c 6f 2c 20 57  6f 72 6c 64 21 20 31 32  |Hello, World! 12|')
    expect(lines[1].startsWith('00000010  33 ')).toBe(true)
    expect(truncated).toBe(false)
  })
  it('최대 크기 초과 시 truncated', () => {
    expect(hexDump(new Uint8Array(100), 32).truncated).toBe(true)
  })
})
