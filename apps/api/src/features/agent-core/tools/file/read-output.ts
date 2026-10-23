import { truncateHead } from '@localixai/agent'
import { truncationMarker } from '../tool-output'
import { alignToCharBoundary } from './file-utils'

/** Byte cap on the rich `details.output` (and the default model-facing slice). */
export const MAX_OUTPUT_BYTES = 64_000
/** Max directory entries listed before eliding the rest. */
export const MAX_DIR_ENTRIES = 1_000

/** Pure size/truncation shape shared by read results. */
export interface ReadOutput {
  bytes: number
  truncated: boolean
  output: string
}

/**
 * Git's binary heuristic (the shared `hasBinarySignature`): a NUL byte within the first chunk
 * means the file is binary. Decoding such a file as UTF-8 yields garbage / U+FFFD replacement
 * runs that pollute the model's context with no useful signal, so we return a notice instead of
 * the bytes.
 */
export { hasBinarySignature as looksBinary } from '@localixai/mini-app-sdk/backend'

/**
 * Back up `index` to the nearest UTF-8 character boundary (a byte that is NOT a
 * 10xxxxxx continuation byte). Byte-offset slicing through a multi-byte
 * character would otherwise emit U+FFFD replacement chars at the seam of
 * continued reads.
 */
export function truncateOutput(output: string, startOffset = 0): ReadOutput {
  const fullBuffer = Buffer.from(output)
  const totalBytes = fullBuffer.byteLength
  // Both slice points back up to a character boundary so neither this read's
  // tail nor a continued read's head produces U+FFFD.
  const start = alignToCharBoundary(fullBuffer, Math.min(startOffset, totalBytes))
  const buffer = fullBuffer.subarray(start)

  if (buffer.byteLength <= MAX_OUTPUT_BYTES) {
    const slice = buffer.toString('utf8')
    const header = start > 0 ? `[…showing bytes ${start}-${totalBytes} of ${totalBytes}…]\n` : ''
    return { bytes: totalBytes, truncated: false, output: header + slice }
  }

  const nextOffset = alignToCharBoundary(fullBuffer, start + MAX_OUTPUT_BYTES)
  const slice = fullBuffer.subarray(start, nextOffset).toString('utf8')
  const header = start > 0 ? `[…showing bytes ${start}-${nextOffset} of ${totalBytes}…]\n` : ''
  // Tell the model exactly how to continue instead of silently dropping the tail.
  return {
    bytes: totalBytes,
    truncated: true,
    output: `${header}${slice}\n[…truncated at ${nextOffset - start} bytes. ${totalBytes - nextOffset} bytes remain — call read again with offset=${nextOffset} to continue, OR use \`search\` to jump straight to a specific symbol/line instead of paging the whole file.]`,
  }
}

/**
 * Secondary line-cap guard for the MODEL-facing file content. The byte-based
 * `truncateOutput` already bounds size (and provides offset-based continuation),
 * but a file with very many short lines can still be huge in LINE count, which
 * bloats the prompt. Keep the HEAD (beginning matters for file reads). The rich
 * `details.output` is left untouched for the UI; this only shrinks `content`.
 *
 * Only the LINE limit is applied here (bytes are already bounded by
 * `truncateOutput`, and re-applying the default byte limit would wrongly clobber
 * the byte-truncated head — e.g. a few very long lines). No-op below the limit.
 */
export function modelFacingFile(
  output: string,
  opts?: {
    /**
     * Byte offset of `output[0]` within the underlying FILE. When known, the
     * truncation marker names the exact next call (`offset=N`) instead of a
     * generic "read again with an offset" — the model should never have to
     * guess how to get the rest (self-continuing truncation). Omit
     * for non-file content (an outline), where file offsets don't apply.
     */
    continueFromByteOffset?: number
  },
): string {
  const r = truncateHead(output, { maxBytes: Number.POSITIVE_INFINITY })
  if (!r.truncated) return output
  const nextOffset =
    opts?.continueFromByteOffset !== undefined
      ? opts.continueFromByteOffset + Buffer.byteLength(r.content)
      : undefined
  const marker = truncationMarker(r, {
    kept: 'first',
    advice:
      nextOffset !== undefined
        ? `Call read again with offset=${nextOffset} to continue, or use \`search\` to jump straight to a specific symbol/line.`
        : 'Read again with an offset to page further, or use `search` to jump straight to a specific symbol/line.',
  })
  return `${r.content}\n${marker}`
}
