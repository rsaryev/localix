// Pure parser for `rg --json` output → flat content-search matches, with optional
// surrounding context lines. Kept free of fs/env so the parsing + context-attach
// semantics are unit-testable in isolation (see ripgrep-parse.test.ts).
import type { FileContentMatch } from '../contracts'

/** Display cap for a single line so a minified/data line can't bloat the payload. */
export const MAX_LINE_TEXT = 500

/** Convert a UTF-8 byte offset within `text` to a JS (UTF-16) char offset. */
const byteToCharOffset = (text: string, byteOffset: number): number =>
  Buffer.from(text, 'utf8').subarray(0, byteOffset).toString('utf8').length

/** Strip a trailing CR/LF and cap the line to the display width. */
const trimLine = (raw: string): string => raw.replace(/\r?\n$/, '').slice(0, MAX_LINE_TEXT)

interface RgEvent {
  type?: string
  data?: {
    path?: { text?: string }
    lines?: { text?: string }
    line_number?: number
    submatches?: { start: number; end: number }[]
  }
}

export interface ParseRipgrepOptions {
  /** Hard cap on the number of matches returned. */
  limit: number
  /** Lines of surrounding context (0 = none) already requested via `rg --context`. */
  contextLines?: number
}

/**
 * Parse ripgrep `--json` stdout into a flat, capped match list. When
 * `contextLines > 0` the stream also carries `type:"context"` events (rg emits
 * them when invoked with `--context N`); those are collected per file and, in a
 * second pass, attached to each match as contiguous `before`/`after` runs. Only
 * `match` events count toward `limit`; context is free.
 */
export function parseRipgrepMatches(
  stdout: string,
  opts: ParseRipgrepOptions,
): { matches: FileContentMatch[]; truncated: boolean } {
  const { limit, contextLines = 0 } = opts
  const matches: FileContentMatch[] = []
  // path → (1-based line number → line text), from `context` events only.
  const contextByFile = new Map<string, Map<number, string>>()
  let truncated = false

  outer: for (const raw of stdout.split('\n')) {
    if (!raw) continue
    let event: RgEvent
    try {
      event = JSON.parse(raw)
    } catch {
      continue
    }

    if (event.type === 'context') {
      const filePath = event.data?.path?.text
      const lineNo = event.data?.line_number
      const lineRaw = event.data?.lines?.text
      if (!filePath || lineRaw === undefined || !lineNo) continue
      const relPath = filePath.replace(/^\.\//, '')
      let fileCtx = contextByFile.get(relPath)
      if (!fileCtx) {
        fileCtx = new Map()
        contextByFile.set(relPath, fileCtx)
      }
      fileCtx.set(lineNo, trimLine(lineRaw))
      continue
    }

    if (event.type !== 'match' || !event.data) continue
    // Reached the cap: stop taking new matches. Trailing `context` events of the
    // final included match have already been recorded above by the time the next
    // match event arrives here.
    if (matches.length >= limit) {
      truncated = true
      break
    }

    const filePath = event.data.path?.text
    const lineRaw = event.data.lines?.text
    const lineNumber = event.data.line_number
    if (!filePath || lineRaw === undefined || !lineNumber) continue

    const lineNoNewline = lineRaw.replace(/\r?\n$/, '')
    const relPath = filePath.replace(/^\.\//, '')
    for (const sub of event.data.submatches ?? []) {
      if (matches.length >= limit) {
        truncated = true
        break outer
      }
      const startChar = byteToCharOffset(lineNoNewline, sub.start)
      const endChar = byteToCharOffset(lineNoNewline, sub.end)
      // Keep the match visible even when the line itself is huge: window the
      // displayed text around the match if it would exceed the display cap.
      let lineText = lineNoNewline
      let matchStart = startChar
      let matchEnd = endChar
      if (lineText.length > MAX_LINE_TEXT) {
        const ctxStart = Math.max(0, startChar - 80)
        lineText = lineNoNewline.slice(ctxStart, ctxStart + MAX_LINE_TEXT)
        matchStart = startChar - ctxStart
        matchEnd = Math.min(lineText.length, endChar - ctxStart)
      }
      matches.push({ path: relPath, line: lineNumber, lineText, matchStart, matchEnd })
    }
  }

  // Second pass: attach contiguous before/after context runs to each match.
  if (contextLines > 0) {
    for (const m of matches) {
      const fileCtx = contextByFile.get(m.path)
      if (!fileCtx) continue
      const before: string[] = []
      for (let ln = m.line - 1; ln >= m.line - contextLines; ln--) {
        const text = fileCtx.get(ln)
        if (text === undefined) break // stop at the first gap (an adjacent match)
        before.unshift(text)
      }
      const after: string[] = []
      for (let ln = m.line + 1; ln <= m.line + contextLines; ln++) {
        const text = fileCtx.get(ln)
        if (text === undefined) break
        after.push(text)
      }
      if (before.length) m.before = before
      if (after.length) m.after = after
    }
  }

  return { matches, truncated }
}
