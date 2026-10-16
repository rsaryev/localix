/**
 * Read a file INTO THE PROMPT — bounded, capped, and marked. The one owner.
 *
 * Prompt assembly re-reads the context files on every turn, so the cost of a stray
 * multi-MB file anywhere in the tree does not amortize — it recurs for the life of
 * the session. We only ever KEEP `maxChars` of a file and scan it in a fixed-size
 * reusable buffer. Ordinary oversized content stops just past the character cap;
 * long leading/trailing whitespace may require more I/O to preserve exact `trim()`
 * semantics, but never a proportional memory allocation.
 *
 * WHY ITS OWN MODULE. This bound was learned once and then not propagated. It was
 * fixed in `context-files.ts` ("instead of slurping a multi-MB file on every prompt
 * assembly") and its sibling `context-imports.ts` kept the naive `readFile` — and
 * that sibling is the `@import` path, the ONE of the two a user can aim at an
 * arbitrary file. The two copies were otherwise line-for-line identical, so nothing
 * flagged the divergence: both returned the same string, and only one of them read
 * the whole file to do it. Declaring the read once is what keeps the next caller
 * from rediscovering the same lesson.
 *
 * The CAP and the MARKER stay the caller's: an imported file and a context file are
 * separate budgets with separate model-facing wording, and this module has no
 * opinion about either. It owns only HOW the bytes come off disk.
 */
import { promises as fs } from 'node:fs'

export interface CappedReadSpec {
  /** Hard cap on the returned characters — the caller's budget. */
  maxChars: number
  /** Appended verbatim when the file exceeded the cap — the caller's model-facing wording. */
  truncationMarker: string
}

/**
 * The file's content, trimmed and capped to `maxChars` (with `truncationMarker`
 * appended when it was cut), or `null` when there is nothing to contribute — the
 * path is missing, is not a file, or holds only whitespace. Every caller treats
 * those three the same way, so they collapse to one answer.
 *
 * Equivalent to reading the whole file and slicing it, except that a cap landing
 * between a UTF-16 surrogate pair backs up one code unit instead of emitting an
 * invalid lone surrogate. The implementation scans fixed-size chunks and stops as
 * soon as truncation is proven, so a huge leading-whitespace prefix cannot fall back
 * to an unbounded allocation.
 */
export async function readCappedFile(
  path: string,
  { maxChars, truncationMarker }: CappedReadSpec,
): Promise<string | null> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile()) return null

    const result = await readTrimmedPrefix(path, maxChars)
    if (!result) return null
    if (!result.truncated) return result.content
    const content = /[\uD800-\uDBFF]$/.test(result.content)
      ? result.content.slice(0, -1)
      : result.content
    return content + truncationMarker
  } catch {
    return null
  }
}

const READ_CHUNK_BYTES = 64 * 1024
const WHITESPACE = /\s/u

/**
 * Stream the semantics of `raw.trim()` followed by `slice(0, maxChars)`.
 * We keep at most `maxChars` UTF-16 code units and a single reusable byte chunk.
 */
async function readTrimmedPrefix(
  path: string,
  maxChars: number,
): Promise<{ content: string; truncated: boolean } | null> {
  const handle = await fs.open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES)
    const decoder = new TextDecoder()
    const kept: string[] = []
    let byteOffset = 0
    let logicalLength = 0
    let started = false
    let truncated = false

    const consume = (chunk: string): void => {
      for (let index = 0; index < chunk.length; index++) {
        const char = chunk[index]!
        const whitespace = WHITESPACE.test(char)
        if (!started) {
          if (whitespace) continue
          started = true
        }
        logicalLength += 1
        if (logicalLength <= maxChars) kept.push(char)
        // A non-whitespace character beyond the cap proves that `trim()` still
        // exceeds it. Trailing whitespace alone must not produce a cut marker.
        if (!whitespace && logicalLength > maxChars) {
          truncated = true
          return
        }
      }
    }

    while (!truncated) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, byteOffset)
      if (bytesRead === 0) {
        consume(decoder.decode())
        break
      }
      byteOffset += bytesRead
      consume(decoder.decode(buffer.subarray(0, bytesRead), { stream: true }))
    }

    if (!started) return null
    const content = kept.join('')
    return { content: truncated ? content : content.trimEnd(), truncated }
  } finally {
    await handle.close()
  }
}
