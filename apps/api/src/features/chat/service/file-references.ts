import { constants as fsConstants, promises as fs } from 'node:fs'

import { confineToDir } from '../../ext/fs-discovery'
import { isPathWithin } from '../../../lib/path-containment'
import { codeSpanRanges, createFenceTracker, insideAnyRange } from '../../../lib/markdown-code'
import { alignToCharBoundary } from '../../agent-core/tools/file/file-utils'

/** Max bytes inlined per `@path` file reference (keeps the prompt bounded). */
export const FILE_REF_MAX_BYTES = 32 * 1024
/** Max file bytes inlined across one prompt expansion. */
export const FILE_REF_TOTAL_MAX_BYTES = 128 * 1024
/** Max successfully resolved references expanded in one prompt. */
export const FILE_REF_MAX_EXPANSIONS = 32
/** Max reference candidates that may touch the filesystem in one prompt. */
export const FILE_REF_MAX_CANDIDATES = 128

const FILE_REF_BUDGET_NOTICE = '[file reference omitted: expansion budget reached]'

interface CappedReference {
  body: string
  bytes: number
  truncated: boolean
}

/**
 * Resolve and read one reference without ever buffering the whole file.
 *
 * `confineToDir` closes lexical traversal. The realpath check closes the other
 * half of the boundary: a symlink below the skill/project root that points
 * outside it. The no-follow open plus inode comparison ensures the validated
 * final file is also the file whose descriptor is read if the path races.
 */
async function readCappedReference(
  rel: string,
  bases: string[],
  maxBytes: number,
): Promise<CappedReference | null> {
  if (maxBytes <= 0) return null
  for (const base of bases) {
    const abs = confineToDir(base, rel)
    if (!abs) continue
    try {
      const [canonicalBase, canonicalFile] = await Promise.all([
        fs.realpath(base),
        fs.realpath(abs),
      ])
      if (!isPathWithin(canonicalBase, canonicalFile)) continue
      const stat = await fs.stat(canonicalFile)
      if (!stat.isFile()) continue

      const noFollow =
        process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number'
          ? fsConstants.O_NOFOLLOW
          : 0
      const handle = await fs.open(canonicalFile, fsConstants.O_RDONLY | noFollow)
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) continue
        // One look-ahead byte tells us whether the rendered body needs a
        // truncation marker while keeping allocation bounded.
        const buffer = Buffer.allocUnsafe(maxBytes + 1)
        let offset = 0
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
          if (bytesRead === 0) break
          offset += bytesRead
        }
        // A complete short read already ends on a character boundary. Do not ask
        // alignToCharBoundary to inspect buffer[offset]: this is an allocUnsafe
        // look-ahead buffer, so the byte immediately after EOF is uninitialized
        // and can randomly resemble a UTF-8 continuation byte, dropping valid
        // trailing ASCII. Alignment is needed only when the byte cap cut the file.
        const bytes =
          offset <= maxBytes ? offset : alignToCharBoundary(buffer.subarray(0, offset), maxBytes)
        return {
          body: buffer.subarray(0, bytes).toString('utf8'),
          bytes,
          truncated: offset > maxBytes,
        }
      } finally {
        await handle.close()
      }
    } catch {
      // Missing, unreadable, or unsafe in this base — try the next base.
    }
  }
  return null
}

/** Keep referenced data inside its Markdown fence even when the file contains one. */
function neutralizeFenceClosers(body: string): string {
  return body.replace(/```/g, '``\u200B`')
}

/**
 * Expand Claude Code `@path` file references. A `@relative/path` at line-start or
 * after whitespace is replaced by the referenced file's content, fenced with its
 * path. Paths resolve against each base in `bases` order (typically the session
 * working dir first, then a plugin dir) and MUST stay inside one of them
 * (confinement) — a reference that escapes, is missing, or is unreadable is left
 * verbatim so it reaches the model as ordinary text. Content is capped at
 * {@link FILE_REF_MAX_BYTES}.
 *
 * References inside Markdown code spans (`` `@x` ``) or fenced code blocks are
 * skipped (the usual `@import` convention for instruction files), so a path can be shown
 * literally by wrapping it in backticks or a code fence. Single pass — inlined
 * content is NOT re-scanned for further references.
 *
 * SECURITY: callers pass only LOCAL filesystem bases. Plugin/MCP-sourced skill
 * bodies that are not local files must NOT be expanded (remote content is
 * excluded from the `@`-scan).
 */
export async function expandFileReferences(text: string, bases: string[]): Promise<string> {
  if (!text.includes('@') || bases.length === 0) return text

  const lines = text.split('\n')
  const out: string[] = []
  let expandedCount = 0
  let expandedBytes = 0
  let candidatesChecked = 0
  let budgetNoticeEmitted = false
  const insideFence = createFenceTracker()
  // `@` at line-start or after whitespace; spec is non-space, non-backtick chars.
  const refRe = /(^|\s)@([^\s`]+)/g

  for (const line of lines) {
    if (insideFence(line)) {
      out.push(line)
      continue
    }

    const spans = codeSpanRanges(line)
    let rebuilt = ''
    let cursor = 0
    let matched = false
    let m: RegExpExecArray | null
    refRe.lastIndex = 0
    while ((m = refRe.exec(line))) {
      const atIndex = m.index + m[1].length
      if (insideAnyRange(atIndex, spans)) continue
      const rel = m[2]
      let body: string | null = null
      if (
        candidatesChecked >= FILE_REF_MAX_CANDIDATES ||
        expandedCount >= FILE_REF_MAX_EXPANSIONS ||
        expandedBytes >= FILE_REF_TOTAL_MAX_BYTES
      ) {
        if (!budgetNoticeEmitted) {
          budgetNoticeEmitted = true
          body = FILE_REF_BUDGET_NOTICE
        }
      } else {
        candidatesChecked++
        const remaining = FILE_REF_TOTAL_MAX_BYTES - expandedBytes
        const read = await readCappedReference(rel, bases, Math.min(FILE_REF_MAX_BYTES, remaining))
        if (read) {
          expandedCount++
          expandedBytes += read.bytes
          body = `\`\`\` ${rel}\n${neutralizeFenceClosers(read.body)}${read.truncated ? '\n… [truncated]' : ''}\n\`\`\``
        }
      }
      if (body == null) continue // unresolved — leave the literal `@path`
      matched = true
      // Keep everything up to (and including) the whitespace/line-start prefix,
      // then splice in the fenced body in place of the `@rel` token.
      rebuilt += line.slice(cursor, atIndex) + body
      cursor = atIndex + 1 + rel.length
    }
    if (matched) {
      rebuilt += line.slice(cursor)
      out.push(rebuilt)
    } else {
      out.push(line)
    }
  }

  return out.join('\n')
}
