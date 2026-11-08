/** localStorage 래퍼 — 비공개 창/차단 환경에서도 예외 없이 동작 */
export function readStore<T>(key: string | undefined, fallback: T): T {
  if (!key) return fallback
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeStore(key: string | undefined, value: unknown): void {
  if (!key) return
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / 접근 불가 무시 */
  }
}

export function removeStore(key: string | undefined): void {
  if (!key) return
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    /* 무시 */
  }
}
