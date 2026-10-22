/**
 * Output truncation for tool results, under two independent limits — whichever is hit first wins:
 * a line count (default 2000) and a size in UTF-8 bytes (default 50 KiB).
 *
 * - `truncateHead` keeps the FIRST lines — for file reads, where the beginning matters.
 * - `truncateTail` keeps the LAST lines — for command output, where errors and results end it.
 *
 * The third direction lives next door in `truncate-middle.ts`: it keeps BOTH ends under a
 * CHARACTER budget, which shares no arithmetic with these two.
 *
 * Whole lines only, with one exception: when the very last line of a tail is larger than the byte
 * limit on its own, its end is kept, never splitting a multi-byte sequence or a surrogate pair
 * (unpaired surrogates in that partial line become U+FFFD). Anything kept whole is unchanged.
 */

import { truncateStringToBytesFromEnd, utf8ByteLength } from './truncate-utf8'

export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024

const KIB = 1024
const MIB = 1024 * KIB
const LF = 10

export interface TruncationResult {
  /** The truncated content. */
  content: string
  /** Whether truncation occurred. */
  truncated: boolean
  /** Which limit was hit: "lines", "bytes", or null if not truncated. */
  truncatedBy: 'lines' | 'bytes' | null
  /** Total number of lines in the original content. */
  totalLines: number
  /** Total number of bytes in the original content. */
  totalBytes: number
  /** Number of complete lines in the truncated output. */
  outputLines: number
  /** Number of bytes in the truncated output. */
  outputBytes: number
  /** Whether the last line was partially truncated (only for tail truncation edge case). */
  lastLinePartial: boolean
  /** Whether the first line exceeded the byte limit (for head truncation). */
  firstLineExceedsLimit: boolean
  /** The max lines limit that was applied. */
  maxLines: number
  /** The max bytes limit that was applied. */
  maxBytes: number
}

export interface TruncationOptions {
  /** Maximum number of lines (default: 2000). */
  maxLines?: number
  /** Maximum number of bytes (default: 50KB). */
  maxBytes?: number
}

/** Format a byte count as a human-readable size (e.g. "12.3KB"). */
export function formatSize(bytes: number): string {
  if (bytes < KIB) return `${bytes}B`
  return bytes < MIB ? `${(bytes / KIB).toFixed(1)}KB` : `${(bytes / MIB).toFixed(1)}MB`
}

/** Logical lines: a trailing newline ends the last line rather than starting an empty one. */
function lineCount(content: string): number {
  if (content === '') return 0
  let breaks = 0
  for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) breaks++
  return content.charCodeAt(content.length - 1) === LF ? breaks : breaks + 1
}

interface Measured {
  content: string
  totalLines: number
  totalBytes: number
  maxLines: number
  maxBytes: number
}

function measure(content: string, options: TruncationOptions): Measured {
  return {
    content,
    totalLines: lineCount(content),
    totalBytes: utf8ByteLength(content),
    maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  }
}

const fits = (input: Measured) =>
  input.totalLines <= input.maxLines && input.totalBytes <= input.maxBytes

/** The result for what was kept; `kept` is the lines in output order. */
function result(
  input: Measured,
  kept: readonly string[] | null,
  by: TruncationResult['truncatedBy'],
  flags: { lastLinePartial?: boolean; firstLineExceedsLimit?: boolean } = {},
): TruncationResult {
  const content = kept === null ? input.content : kept.join('\n')
  return {
    content,
    truncated: kept !== null,
    truncatedBy: by,
    totalLines: input.totalLines,
    totalBytes: input.totalBytes,
    outputLines: kept === null ? input.totalLines : kept.length,
    outputBytes: kept === null ? input.totalBytes : utf8ByteLength(content),
    lastLinePartial: flags.lastLinePartial ?? false,
    firstLineExceedsLimit: flags.firstLineExceedsLimit ?? false,
    maxLines: input.maxLines,
    maxBytes: input.maxBytes,
  }
}

/**
 * Truncate content from the head (keep the first N lines/bytes).
 *
 * Never returns a partial line. If the first line alone exceeds the byte limit, returns empty
 * content with `firstLineExceedsLimit = true`.
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const input = measure(content, options)
  if (fits(input)) return result(input, null, null)

  const firstBreak = content.indexOf('\n')
  const firstLine = firstBreak === -1 ? content : content.slice(0, firstBreak)
  if (utf8ByteLength(firstLine) > input.maxBytes) {
    return result(input, [], 'bytes', { firstLineExceedsLimit: true })
  }

  const kept: string[] = []
  let bytes = 0
  let start = 0
  const limit = Math.min(input.totalLines, input.maxLines)
  while (kept.length < limit) {
    const end = content.indexOf('\n', start)
    const line = content.slice(start, end === -1 ? content.length : end)
    // Every line after the first also brings the newline before it.
    const cost = utf8ByteLength(line) + (kept.length === 0 ? 0 : 1)
    if (bytes + cost > input.maxBytes) return result(input, kept, 'bytes')
    kept.push(line)
    bytes += cost
    start = end + 1
  }
  return result(input, kept, 'lines')
}

/**
 * Truncate content from the tail (keep the last N lines/bytes).
 *
 * May return a partial FIRST line if a single trailing line exceeds the byte limit.
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  const input = measure(content, options)
  if (fits(input)) return result(input, null, null)

  // Lines are collected last-first and reversed once at the end.
  const kept: string[] = []
  let bytes = 0
  let partial = false
  let end = content.charCodeAt(content.length - 1) === LF ? content.length - 1 : content.length
  for (let left = input.totalLines; left > 0 && kept.length < input.maxLines; left--) {
    const start = end === 0 ? 0 : content.lastIndexOf('\n', end - 1) + 1
    const line = content.slice(start, end)
    const cost = utf8ByteLength(line) + (kept.length === 0 ? 0 : 1)
    if (bytes + cost > input.maxBytes) {
      if (kept.length === 0) {
        // A last line too large on its own: surface its end rather than nothing.
        const tail = truncateStringToBytesFromEnd(line, input.maxBytes)
        kept.push(tail)
        bytes = utf8ByteLength(tail)
        partial = true
      }
      const by = kept.length >= input.maxLines && bytes <= input.maxBytes ? 'lines' : 'bytes'
      return result(input, kept.reverse(), by, { lastLinePartial: partial })
    }
    kept.push(line)
    bytes += cost
    end = start - 1
  }
  return result(input, kept.reverse(), 'lines')
}
