/**
 * A small ring buffer over `console.*` + window error/rejection events, installed
 * at probe mount so the agent's `console` command can read recent page logs. Split
 * out of actuate/index.ts (which re-exports it) — closure-free, no DOM-actuation deps.
 */

import type { VfConsoleEntry } from '../protocol/index'

export interface ConsoleCapture {
  /** Recent entries. With `sinceSeq`, only entries recorded at/after that cursor —
   *  so a caller can read "what was logged DURING my action" (see `cursor`). */
  read(sinceSeq?: number): VfConsoleEntry[]
  /** A monotonic cursor: the seq the NEXT recorded entry will get. Capture it before
   *  an action, pass it to `read(cursor)` after, to get exactly that action's logs. */
  cursor(): number
  /** Record a synthetic entry straight into the buffer (e.g. an auto-dismissed dialog),
   *  bypassing `console.*` so it's captured even if the page tampered with console. */
  note(text: string, level?: VfConsoleEntry['level']): void
  uninstall(): void
}

/** A buffered entry carries a monotonic seq so `read(sinceSeq)` is stable across
 *  ring-buffer eviction; the seq is stripped from the public `VfConsoleEntry`. */
interface Buffered extends VfConsoleEntry {
  seq: number
}

/** The ring buffer alone — what a HOST fills from its own error sources (see `./embedded`). */
export type ConsoleBuffer = Omit<ConsoleCapture, 'uninstall'> & {
  record(level: VfConsoleEntry['level'], text: string): void
}

export function createConsoleBuffer(limit = 50): ConsoleBuffer {
  const buf: Buffered[] = []
  // Monotonic across the buffer's whole life (NOT reset by eviction), so a cursor
  // captured before an action still selects that action's entries afterward.
  let seq = 0
  const record = (level: VfConsoleEntry['level'], text: string) => {
    buf.push({ seq: seq++, level, text: text.length > 500 ? `${text.slice(0, 499)}…` : text })
    if (buf.length > limit) buf.shift()
  }
  const strip = (b: Buffered): VfConsoleEntry => ({ level: b.level, text: b.text })
  return {
    record,
    read: (sinceSeq?: number) =>
      (sinceSeq == null ? buf.slice(-limit) : buf.filter((b) => b.seq >= sinceSeq)).map(strip),
    cursor: () => seq,
    note: (text: string, level: VfConsoleEntry['level'] = 'warn') => record(level, text),
  }
}

/** What one logged value costs at most: the entry keeps 500 characters anyway. */
const ARG_CHARS = 500

/**
 * One logged value as text, never costing more than the entry keeps. `JSON.stringify` of
 * whatever a site logs ran on every `console.*` call the page made — a large state object
 * serialized in full, again and again, only for 499 characters of it to be kept.
 */
export function previewArg(value: unknown, room = ARG_CHARS): string {
  if (typeof value === 'string') return value.slice(0, room)
  if (value === null || typeof value !== 'object') return String(value)
  if (value instanceof Error) return `${value.name}: ${value.message}`.slice(0, room)
  const parts: string[] = []
  let used = 0
  const isArray = Array.isArray(value)
  for (const key of Object.keys(value)) {
    if (used >= room) {
      parts.push('…')
      break
    }
    let item: unknown
    try {
      item = (value as Record<string, unknown>)[key]
    } catch {
      item = '?'
    }
    const text =
      item !== null && typeof item === 'object'
        ? Array.isArray(item)
          ? `[${item.length}]`
          : '{…}'
        : typeof item === 'string'
          ? JSON.stringify(item.slice(0, 80))
          : String(item)
    const part = isArray ? text : `${JSON.stringify(key)}:${text}`
    parts.push(part)
    used += part.length + 1
  }
  return (isArray ? `[${parts.join(',')}]` : `{${parts.join(',')}}`).slice(0, room)
}

/** Install a small ring buffer over `console.*` + window errors at probe mount. */
export function installConsoleCapture(limit = 50): ConsoleCapture {
  const buffer = createConsoleBuffer(limit)
  const push = (level: VfConsoleEntry['level'], args: unknown[]) => {
    buffer.record(level, args.map((a) => previewArg(a)).join(' '))
  }

  const levels: VfConsoleEntry['level'][] = ['log', 'info', 'warn', 'error', 'debug']
  const original: Partial<Record<VfConsoleEntry['level'], (...a: unknown[]) => void>> = {}
  for (const level of levels) {
    const orig = (console as unknown as Record<string, (...a: unknown[]) => void>)[level]
    original[level] = orig
    ;(console as unknown as Record<string, (...a: unknown[]) => void>)[level] = (
      ...args: unknown[]
    ) => {
      push(level, args)
      try {
        orig?.apply(console, args)
      } catch {
        /* noop */
      }
    }
  }
  const onError = (e: ErrorEvent) => push('error', [e.message])
  const onRejection = (e: PromiseRejectionEvent) =>
    push('error', [`Unhandled rejection: ${String(e.reason)}`])
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return {
    read: buffer.read,
    cursor: buffer.cursor,
    note: buffer.note,
    uninstall() {
      for (const level of levels) {
        if (original[level])
          (console as unknown as Record<string, unknown>)[level] = original[level]
      }
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    },
  }
}
