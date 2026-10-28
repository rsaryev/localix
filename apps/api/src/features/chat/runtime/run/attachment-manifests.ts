/**
 * How an attachment is DESCRIBED to the model once its bytes are not inlined.
 *
 * Split out of `attachment-spill.ts` because two callers need the same vocabulary:
 * the spill path (bytes written into the workspace) and the copy-free path path
 * (bytes left where the user already had them, see `attachment-path.ts`). Both
 * must say the same things the same way — a manifest is the only thing the model
 * gets, so a difference in wording between the two is a difference in what the
 * agent believes it may do next.
 */
import { open } from 'node:fs/promises'

import { formatSize } from '@localixai/agent'

/** Lines of head preview kept in the manifest of a spilled text file. */
export const SPILL_PREVIEW_LINES = 50
/**
 * How many bytes of a text file are decoded to build its manifest preview.
 *
 * The manifest shows at most SPILL_PREVIEW_LINES lines, so decoding past this buys nothing.
 * It is a real ceiling, not a tidiness bound: a `path` attachment names an arbitrary file the
 * user was deliberately never asked to size (the agent decides what to do with it), so reading
 * it whole put an unbounded amount of the user's disk into the API process — one attached
 * multi-gigabyte log was enough to take the server down with it. Reading a bounded prefix
 * costs the same for the small files that dominate and cannot be provoked into an OOM.
 */
export const TEXT_PREVIEW_BYTES = 128 * 1024

export function textManifest(
  relPath: string,
  name: string,
  byteLen: number,
  textInfo: { lineCount: number; preview: string; truncated?: boolean },
): string {
  const { lineCount, preview, truncated } = textInfo
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : 'text'
  // Say what the preview actually is. A file that is long in BYTES but short in lines
  // spills with its whole text shown, and "see the rest" would then send the model on a
  // read that returns nothing new. When only a prefix of the file was decoded, `lineCount`
  // counts the PREFIX, so neither the total nor "the first 50 of N" may be claimed.
  const shown = truncated
    ? // The total is unknowable from a prefix, so state only what IS shown. Which of the two
      // bounds actually cut the preview depends on the file: many short lines hit the line
      // limit first, one enormous line hits the byte limit first.
      `It is too large to preview whole. Showing ${
        lineCount > SPILL_PREVIEW_LINES
          ? `its first ${SPILL_PREVIEW_LINES} lines`
          : `its first ${formatSize(Buffer.byteLength(preview, 'utf8'))}`
      } — use \`Read\` on \`${relPath}\` with start_line/end_line (or offset) to see any other part:`
    : lineCount <= SPILL_PREVIEW_LINES
      ? 'Its full text is shown below (it lives on disk only to keep the context small):'
      : `It was written to disk instead of inlined to keep the context small. Showing the first ${SPILL_PREVIEW_LINES} of ${lineCount} lines — use \`Read\` on \`${relPath}\` with start_line/end_line (or offset) to see the rest:`
  return [
    truncated
      ? `Attached file saved to the workspace: ${relPath} (${ext}, ${formatSize(byteLen)}).`
      : `Attached file saved to the workspace: ${relPath} (${ext}, ${formatSize(byteLen)}, ${lineCount} lines).`,
    shown,
    '',
    '```',
    preview,
    '```',
  ].join('\n')
}

/** Count lines and retain the preview in one O(1)-allocation scan. */
export function analyzeText(text: string): { lineCount: number; preview: string } {
  if (text.length === 0) return { lineCount: 0, preview: '' }
  let lineCount = 1
  let previewEnd = text.length
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue
    if (lineCount === SPILL_PREVIEW_LINES && previewEnd === text.length) previewEnd = index
    lineCount += 1
  }
  return { lineCount, preview: text.slice(0, previewEnd) }
}

/**
 * Media types whose bytes are text the model can read directly. Deliberately narrow: a wrong
 * guess would read a binary as UTF-8 and put mojibake in the manifest, which is worse than an
 * honest "binary at this path".
 */
export function isTextualMediaType(mediaType: string): boolean {
  const type = mediaType.toLowerCase()
  if (type.startsWith('text/')) return true
  return (
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/x-ndjson' ||
    type === 'application/yaml' ||
    type === 'application/x-yaml' ||
    type.endsWith('+json') ||
    type.endsWith('+xml')
  )
}

export interface TextPrefix {
  /** The decoded prefix — at most TEXT_PREVIEW_BYTES of the file. */
  text: string
  /** Whether the file continues past what was decoded. */
  truncated: boolean
  /** The size of the WHOLE file, not of `text`. */
  byteLength: number
}

/**
 * Decode at most TEXT_PREVIEW_BYTES from the head of a file.
 *
 * Returns null when the bytes are not UTF-8 (the caller then describes the resource as binary
 * rather than putting mojibake in the manifest). IO errors PROPAGATE, so a caller that must
 * tell "missing/unreadable" apart from "binary" still can.
 */
export async function readTextPrefix(absPath: string): Promise<TextPrefix | null> {
  const handle = await open(absPath, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('The path is not a regular file.')
    const readLen = Math.min(info.size, TEXT_PREVIEW_BYTES)
    const buf = Buffer.alloc(readLen)
    await handle.read(buf, 0, readLen, 0)
    // `stream: true` holds back a trailing multi-byte sequence that the cut may have split,
    // instead of emitting U+FFFD for it — otherwise every truncated read of a file that
    // contains any non-ASCII text would be misreported as binary. Genuinely invalid bytes
    // still decode to U+FFFD, which is what the check below looks for.
    const text = new TextDecoder('utf-8').decode(buf, { stream: true })
    if (text.includes('\ufffd')) return null
    return { text, truncated: info.size > readLen, byteLength: info.size }
  } finally {
    await handle.close()
  }
}

/** Read a just-written spill file back as text; null when unreadable or not UTF-8. */
export async function readTextFile(absPath: string): Promise<TextPrefix | null> {
  try {
    return await readTextPrefix(absPath)
  } catch {
    return null
  }
}

export function binaryManifest(relPath: string, mediaType: string, size: number): string {
  return `Attached file saved to the workspace: ${relPath} (${mediaType}, ${formatSize(size)}). Binary file written to disk, not shown inline — use \`Read\` on \`${relPath}\` if you need to inspect it.`
}

export function permissionRequiredManifest(
  absPath: string,
  mediaType: string,
  size: number,
): string {
  return `Attached file remains at its original path: ${absPath} (${mediaType}, ${formatSize(size)}). Its contents were not read because the path is outside the workspace — use \`Read\` on \`${absPath}\` if you need to inspect it; the user will be asked for permission.`
}

export function unavailablePathManifest(absPath: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') {
    return `Attached file is no longer available at its original path: ${absPath}. It may have been moved, renamed, or deleted after it was attached.`
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return `Attached file could not be read at its original path: ${absPath}. The file is not readable.`
  }
  const reason = error instanceof Error ? error.message : 'The file could not be read.'
  return `Attached file could not be read at its original path: ${absPath}. ${reason}`
}
