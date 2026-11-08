import { h, type FunctionalComponent } from 'vue'

export interface Segment {
  t: string
  h: boolean
}

export function buildHighlightRegExp(terms: readonly string[]): RegExp | null {
  const list = [...terms].filter(Boolean).sort((a, b) => b.length - a.length)
  if (!list.length) return null
  return new RegExp(`(${list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
}

export function splitHighlight(text: string, re: RegExp | null): Segment[] {
  if (!re || !text) return [{ t: text, h: false }]
  return text
    .split(re)
    .map((t, i) => ({ t, h: i % 2 === 1 }))
    .filter((s) => s.t !== '')
}

/** 검색어 하이라이트 텍스트 (v-html 없이 안전하게 렌더링) */
export const HighlightText: FunctionalComponent<{ text: string; re: RegExp | null }> = (props) =>
  splitHighlight(props.text, props.re).map((s) => (s.h ? h('mark', { class: 'csg-hl' }, s.t) : s.t))
HighlightText.props = ['text', 're']
HighlightText.displayName = 'HighlightText'
