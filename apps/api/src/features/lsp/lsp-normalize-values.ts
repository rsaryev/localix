import { fileURLToPath } from 'node:url'
import type { LspPosition, LspTextEdit } from './lsp-response-types'

// Shared wire-value conversions use the normalized response models.
export function uriToPath(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return null
  try {
    return fileURLToPath(uri)
  } catch {
    return null
  }
}

export function toPosition(p: unknown): LspPosition | null {
  const o = p as { line?: unknown; character?: unknown } | null
  if (!o || !Number.isFinite(Number(o.line)) || !Number.isFinite(Number(o.character))) return null
  return { line: Number(o.line), character: Number(o.character) }
}

export function toRange(r: unknown): { start: LspPosition; end: LspPosition } | null {
  const o = r as { start?: unknown; end?: unknown } | null
  if (!o) return null
  const start = toPosition(o.start)
  const end = toPosition(o.end)
  return start && end ? { start, end } : null
}

export function toTextEdit(raw: unknown): LspTextEdit | null {
  const e = raw as { range?: unknown; newText?: unknown } | null
  if (!e || typeof e.newText !== 'string') return null
  const range = toRange(e.range)
  return range ? { range, newText: e.newText } : null
}
