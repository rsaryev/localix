/**
 * Smart output truncation for tool results.
 *
 * Truncation enforces two INDEPENDENT limits — whichever is hit first wins:
 * - Line limit (default: 2000 lines)
 * - Byte limit (default: 50KB, measured in UTF-8 bytes)
 *
 * Two directions, both under LINE and BYTE limits:
 * - `truncateHead` keeps the FIRST N — use for file reads (beginning matters).
 * - `truncateTail` keeps the LAST N — use for bash/command output (errors and
 *   final results are at the end).
 *
 * The third direction lives next door in `truncate-middle.ts`: it keeps BOTH ends
 * under a CHARACTER budget, which shares no arithmetic with these two.
 *
 * UTF-8 safe: byte counting and the partial-line edge case never split a
 * multi-byte sequence or a surrogate pair; unpaired surrogates are replaced
 * with U+FFFD so the output is always valid text.
 */

export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024 // 50KB

const ONE_KIB = 1024
const ONE_MIB = ONE_KIB * 1024

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

interface RuntimeBuffer {
  byteLength(content: string, encoding: 'utf8'): number
}

const runtimeBuffer = (globalThis as { Buffer?: RuntimeBuffer }).Buffer
// oxlint-disable-next-line no-control-regex -- the ASCII range 0x00-0x7f is the point: this matches any non-ASCII byte
const nonAsciiPattern = /[^\x00-\x7f]/

/** UTF-8 byte length of a string. Uses Buffer when available, else a manual scan. */
function utf8ByteLength(content: string): number {
  if (runtimeBuffer) return runtimeBuffer.byteLength(content, 'utf8')

  const firstNonAscii = content.search(nonAsciiPattern)
  if (firstNonAscii === -1) return content.length

  let bytes = firstNonAscii
  for (let i = firstNonAscii; i < content.length; i++) {
    const code = content.charCodeAt(i)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < content.length) {
      const next = content.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

/** Count logical lines without allocating one array entry per input line. */
function countLines(content: string): number {
  if (content.length === 0) return 0
  let lines = 1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++
  }
  if (content.charCodeAt(content.length - 1) === 10) lines--
  return lines
}

/** Replace any unpaired surrogate with U+FFFD so the result is valid UTF-16/UTF-8. */
function replaceUnpairedSurrogates(content: string): string {
  let output = ''
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < content.length) {
        const next = content.charCodeAt(i + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          output += content[i] + content[i + 1]
          i++
          continue
        }
      }
      output += '�'
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += '�'
    } else {
      output += content[i]
    }
  }
  return output
}

/** Format a byte count as a human-readable size (e.g. "12.3KB"). */
export function formatSize(bytes: number): string {
  if (bytes < ONE_KIB) return `${bytes}B`
  if (bytes < ONE_MIB) return `${(bytes / ONE_KIB).toFixed(1)}KB`
  return `${(bytes / ONE_MIB).toFixed(1)}MB`
}

/**
 * Truncate content from the head (keep the first N lines/bytes).
 * Suitable for file reads where you want to see the beginning.
 *
 * Never returns a partial line. If the first line alone exceeds the byte limit,
 * returns empty content with `firstLineExceedsLimit = true`.
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const totalBytes = utf8ByteLength(content)
  const totalLines = countLines(content)

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    }
  }

  const firstLineEnd = content.indexOf('\n')
  const firstLine = content.slice(0, firstLineEnd === -1 ? content.length : firstLineEnd)
  const firstLineBytes = utf8ByteLength(firstLine)
  if (firstLineBytes > maxBytes) {
    return {
      content: '',
      truncated: true,
      truncatedBy: 'bytes',
      totalLines,
      totalBytes,
      outputLines: 0,
      outputBytes: 0,
      lastLinePartial: false,
      firstLineExceedsLimit: true,
      maxLines,
      maxBytes,
    }
  }

  const outputLinesArr: string[] = []
  let outputBytesCount = 0
  let truncatedBy: 'lines' | 'bytes' = 'lines'

  let cursor = 0
  for (let i = 0; i < totalLines && i < maxLines; i++) {
    const newline = content.indexOf('\n', cursor)
    const lineEnd = newline === -1 ? content.length : newline
    const line = content.slice(cursor, lineEnd)
    const lineBytes = utf8ByteLength(line) + (i > 0 ? 1 : 0) // +1 for newline

    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = 'bytes'
      break
    }

    outputLinesArr.push(line)
    outputBytesCount += lineBytes
    cursor = lineEnd + 1
  }

  if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
    truncatedBy = 'lines'
  }

  const outputContent = outputLinesArr.join('\n')
  const finalOutputBytes = utf8ByteLength(outputContent)

  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: finalOutputBytes,
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  }
}

/**
 * Truncate content from the tail (keep the last N lines/bytes).
 * Suitable for bash/command output where the end (errors, final result) matters.
 *
 * May return a partial FIRST line if a single trailing line exceeds the byte limit.
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const totalBytes = utf8ByteLength(content)
  const ignoresTrailingEmpty = content.length > 0 && content.charCodeAt(content.length - 1) === 10
  const totalLines = countLines(content)

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    }
  }

  const outputLinesArr: string[] = []
  let outputBytesCount = 0
  let truncatedBy: 'lines' | 'bytes' = 'lines'
  let lastLinePartial = false

  let lineEnd = ignoresTrailingEmpty ? content.length - 1 : content.length
  for (let i = totalLines - 1; i >= 0 && outputLinesArr.length < maxLines; i--) {
    const newline = lineEnd === 0 ? -1 : content.lastIndexOf('\n', lineEnd - 1)
    const lineStart = newline + 1
    const line = content.slice(lineStart, lineEnd)
    const lineBytes = utf8ByteLength(line) + (outputLinesArr.length > 0 ? 1 : 0) // +1 for newline

    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = 'bytes'
      // Edge case: if we haven't added ANY lines yet and this single line exceeds
      // maxBytes, take the END of the line (partial) so we still surface something.
      if (outputLinesArr.length === 0) {
        const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes)
        outputLinesArr.push(truncatedLine)
        outputBytesCount = utf8ByteLength(truncatedLine)
        lastLinePartial = true
      }
      break
    }

    outputLinesArr.push(line)
    outputBytesCount += lineBytes
    lineEnd = newline
  }

  if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
    truncatedBy = 'lines'
  }

  const outputContent = outputLinesArr.reverse().join('\n')
  const finalOutputBytes = utf8ByteLength(outputContent)

  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: finalOutputBytes,
    lastLinePartial,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  }
}

/**
 * Truncate a string to fit within a byte limit, keeping the END.
 * Handles multi-byte UTF-8 characters and surrogate pairs correctly.
 */
function truncateStringToBytesFromEnd(str: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''

  let outputBytes = 0
  let start = str.length
  let needsReplacement = false
  for (let i = str.length; i > 0;) {
    let characterStart = i - 1
    const code = str.charCodeAt(characterStart)
    let characterBytes: number
    let unpairedSurrogate = false
    if (code >= 0xdc00 && code <= 0xdfff && characterStart > 0) {
      const previous = str.charCodeAt(characterStart - 1)
      if (previous >= 0xd800 && previous <= 0xdbff) {
        characterStart--
        characterBytes = 4
      } else {
        characterBytes = 3
        unpairedSurrogate = true
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      characterBytes = 3
      unpairedSurrogate = true
    } else {
      characterBytes = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3
    }
    if (outputBytes + characterBytes > maxBytes) break
    outputBytes += characterBytes
    start = characterStart
    needsReplacement ||= unpairedSurrogate
    i = characterStart
  }

  const output = str.slice(start)
  return needsReplacement ? replaceUnpairedSurrogates(output) : output
}
