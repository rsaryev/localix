/**
 * Chunk → LINES. One splitter, because two owners need it and both get the same two bugs
 * when they roll their own.
 *
 * A producer hands us arbitrary boundaries: one write can carry three lines, and one line can
 * arrive in three writes. Splitting per chunk therefore reports a line twice (its halves
 * counted separately) and loses the last line when it never gets a newline. Both cost more
 * than the code that prevents them: a line here is a NOTIFICATION — the plugin monitor host
 * wakes a session per line, and the agent's `monitor` counts events in them.
 *
 * Callers:
 *   - `features/plugins/monitor-stream.ts` — a `ReadableStream` from `Bun.spawn`;
 *   - `features/monitors/sources/command.ts` — chunk callbacks from `childBgProc`.
 *
 * Deliberate choices:
 *   - `\r` ends a line too. Progress writers (curl, npm, cargo) rewrite one line with carriage
 *     returns; treating only `\n` as terminal turns a download meter into one 50 KB "line".
 *   - blank lines are dropped: not something to wake anyone for.
 *   - a line past `maxLineChars` is cut and MARKED rather than buffered forever, so a producer
 *     with no newlines at all (a minified bundle) cannot grow the pending buffer without bound.
 */

/** Longest single line kept. Chars ≈ bytes for this cap's purpose. */
export const MAX_LINE_CHARS = 2_000
/** Appended to a line that was cut. Asserted by the plugin monitor host's tests. */
export const LINE_TRUNCATION_MARKER = '… [truncated]'

export interface LineSplitter {
  /** Feed a chunk; returns the lines completed by it (never partial, never blank). */
  push(chunk: string): string[]
  /** Emit whatever is buffered without a terminator (call at exit). */
  flush(): string[]
}

export function createLineSplitter(maxLineChars: number = MAX_LINE_CHARS): LineSplitter {
  let pending = ''

  const take = (raw: string): string[] => {
    const line = raw.trim()
    if (!line) return []
    return [
      line.length > maxLineChars ? `${line.slice(0, maxLineChars)}${LINE_TRUNCATION_MARKER}` : line,
    ]
  }

  return {
    push(chunk) {
      if (!chunk) return []
      pending += chunk
      const out: string[] = []
      // Split on \n, \r\n and lone \r in one pass.
      const parts = pending.split(/\r\n|\n|\r/)
      // The last part is either empty (the chunk ended on a terminator) or a partial line.
      pending = parts.pop() ?? ''
      for (const part of parts) out.push(...take(part))
      // A terminator-less monster line: cut it loose instead of buffering forever.
      if (pending.length > maxLineChars) {
        out.push(...take(pending))
        pending = ''
      }
      return out
    },
    flush() {
      const rest = pending
      pending = ''
      return take(rest)
    },
  }
}
