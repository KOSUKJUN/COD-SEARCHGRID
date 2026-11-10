import type { GridColumn, LogRecord } from '../types'
import { getValueByPath } from './query'

export type ExportFormat = 'csv' | 'json' | 'tsv'

function toText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function cell(col: GridColumn, row: LogRecord, formatted: boolean): string {
  const v = getValueByPath(row, col.field)
  return formatted && col.formatter ? col.formatter(v, row) : toText(v)
}

function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV 생성. Excel 에서 한글이 깨지지 않도록 기본적으로 UTF-8 BOM 을 붙인다.
 */
export function toCSV(
  rows: readonly LogRecord[],
  columns: readonly GridColumn[],
  opts: { bom?: boolean; formatted?: boolean } = {},
): string {
  const { bom = true, formatted = false } = opts
  const lines = [columns.map((c) => csvEscape(c.label ?? c.field)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => csvEscape(cell(c, r, formatted))).join(','))
  return (bom ? '﻿' : '') + lines.join('\r\n')
}

/** 클립보드용 TSV (스프레드시트에 붙여넣기 가능) */
export function toTSV(rows: readonly LogRecord[], columns: readonly GridColumn[], header = true): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ')
  const lines = header ? [columns.map((c) => clean(c.label ?? c.field)).join('\t')] : []
  for (const r of rows) lines.push(columns.map((c) => clean(cell(c, r, true))).join('\t'))
  return lines.join('\n')
}

export function toJSON(rows: readonly LogRecord[]): string {
  return JSON.stringify(rows, null, 2)
}

export function downloadText(content: string, fileName: string, mime: string): void {
  downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), fileName)
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function timestampedName(base: string, ext: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${base}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`
}

/** 클립보드 복사 (Clipboard API 불가 시 textarea fallback) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback 시도 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
