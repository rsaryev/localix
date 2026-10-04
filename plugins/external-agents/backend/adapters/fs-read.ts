/**
 * Bounded, read-only reads of provider-owned history files.
 *
 * WHY BOUNDED, and why head+tail rather than a whole-file read: real Claude Code and Codex
 * histories run to hundreds of megabytes across hundreds of files. Summarizing by reading each
 * file whole costs half a gigabyte of I/O to paint a list. A fixed head+tail window costs a
 * bounded ~100-300 KB per file regardless of how large the transcript grew, and it is sufficient
 * because these formats put identity at the START (session id, cwd, version) and the freshest
 * title at the END (Claude Code rewrites an `ai-title` record every turn).
 *
 * Verified against the largest real files: a 5.5 MB Claude Code transcript yields its `cwd` and
 * `sessionId` in the first 64 KB and its current `aiTitle` in the last 32 KB; a 6 MB Codex rollout
 * yields `session_meta` in its first 16 KB line and its first `user_message` at byte 87005 — which
 * is why the Codex head budget is 256 KB and not 64 KB.
 *
 * All reads here are read-only: adapters must be read-only with respect to provider-owned files.
 * We never open a provider path for write.
 */

import { open, stat } from 'node:fs/promises'

export interface BoundedText {
  readonly text: string
  /** True when the file was larger than the window, so the text is a fragment. */
  readonly partial: boolean
  readonly size: number
}

export async function readHead(path: string, maxBytes: number): Promise<BoundedText> {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    const take = Math.min(maxBytes, info.size)
    const buf = Buffer.allocUnsafe(take)
    await handle.read(buf, 0, take, 0)
    return { text: buf.toString('utf8'), partial: info.size > take, size: info.size }
  } finally {
    await handle.close()
  }
}

export async function readTail(path: string, maxBytes: number): Promise<BoundedText> {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    const take = Math.min(maxBytes, info.size)
    const buf = Buffer.allocUnsafe(take)
    await handle.read(buf, 0, take, Math.max(0, info.size - take))
    return { text: buf.toString('utf8'), partial: info.size > take, size: info.size }
  } finally {
    await handle.close()
  }
}

/**
 * Parse whole JSONL lines out of a window. The first line of a tail window and the last line of a
 * head window are almost always truncated mid-record; dropping them is correct, not lossy, because
 * a partial JSON object carries no reliable field.
 */
export function parseWindowLines(
  window: BoundedText,
  position: 'head' | 'tail',
): readonly Record<string, unknown>[] {
  let lines = window.text.split('\n')
  if (window.partial) {
    if (position === 'head') lines = lines.slice(0, -1)
    else lines = lines.slice(1)
  }
  const out: Record<string, unknown>[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed[0] !== '{') continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') out.push(parsed as Record<string, unknown>)
    } catch {
      // A single malformed line must not lose the rest of the window.
    }
  }
  return out
}

/**
 * Stream a JSONL file line by line without materializing it. Used for transcript reads, which are
 * on-demand and single-session, so the cost is paid only when a human or the model asks for one
 * specific transcript.
 */
export async function* streamJsonlRecords(
  path: string,
  maxBytes: number,
  /**
   * Called if the cap stopped the read before the file ended.
   *
   * It used to stop in silence, and silence is the wrong answer here: the caller counts the records
   * it sees and reports that count as `total`, so a capped read presents a truncated session as a
   * complete one — and a TAIL read presents the middle of it as the end. Measured on a real local history:
   * 7 files exceed the 32 MB transcript cap, and on the largest (47.72 MB, 21,220 lines) the "tail"
   * ended 7h40m before the session did while reporting `total: 8596`.
   */
  onTruncated?: () => void,
): AsyncGenerator<Record<string, unknown>> {
  const file = Bun.file(path)
  const stream = file.stream()
  const decoder = new TextDecoder()
  let carry = ''
  let read = 0
  for await (const chunk of stream) {
    read += chunk.byteLength
    carry += decoder.decode(chunk, { stream: true })
    let nl = carry.indexOf('\n')
    while (nl >= 0) {
      const line = carry.slice(0, nl).trim()
      carry = carry.slice(nl + 1)
      if (line[0] === '{') {
        try {
          const parsed: unknown = JSON.parse(line)
          if (parsed && typeof parsed === 'object') yield parsed as Record<string, unknown>
        } catch {
          // skip malformed line
        }
      }
      nl = carry.indexOf('\n')
    }
    if (read >= maxBytes) {
      onTruncated?.()
      return
    }
  }
  const last = carry.trim()
  if (last[0] === '{') {
    try {
      const parsed: unknown = JSON.parse(last)
      if (parsed && typeof parsed === 'object') yield parsed as Record<string, unknown>
    } catch {
      // skip malformed trailing line
    }
  }
}

/**
 * Records for a transcript read, from whichever END the caller asked for.
 *
 * A forward stream cannot reach the end of a file larger than its cap, and that is not a theoretical
 * limit: seven files in a real history exceed the 32 MB transcript cap, and on the largest (47.72 MB,
 * 21,220 lines) a "tail" read used to stop 7h40m before the session ended. Reading BACKWARDS costs
 * memory the forward path avoids, so it is taken only when the tail is what was asked for — measured
 * on that file at 13 ms to read the last 32 MB and 35 ms to parse it, for a single on-demand read.
 *
 * `onTruncated` still fires when the file was larger than the window, because the count the caller
 * derives is a floor either way; what changes is WHICH end of the session it counted.
 */
export async function* jsonlRecords(
  path: string,
  maxBytes: number,
  options: { readonly fromEnd?: boolean; readonly onTruncated?: () => void } = {},
): AsyncGenerator<Record<string, unknown>> {
  if (!options.fromEnd) {
    yield* streamJsonlRecords(path, maxBytes, options.onTruncated)
    return
  }
  const window = await readTail(path, maxBytes)
  // `partial` means the window starts mid-line, which is exactly "the file was bigger than this".
  if (window.partial) options.onTruncated?.()
  for (const record of parseWindowLines(window, 'tail')) yield record
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** `mtime|size` — changes whenever the transcript is appended to, which is the only mutation these formats perform. */
export function revisionOf(mtimeMs: number, size: number): string {
  return `${Math.trunc(mtimeMs)}|${size}`
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  // Marked, not silent: a reader must be able to tell that a body was cut.
  return `${text.slice(0, max)}\n[... ${text.length - max} more characters]`
}
