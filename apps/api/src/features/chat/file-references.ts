import { constants as fsConstants, promises as fs } from 'node:fs'
import type { FileReference } from '@rsaryev/llx-plugin'
import { relative } from 'node:path'

import { confineToDir } from '../ext/fs-discovery'
import { isPathWithin } from '../../lib/path-containment'
import { alignToCharBoundary } from '../agent-core/tools/file/file-utils'

/** Max bytes inlined per `@path` file reference (keeps the prompt bounded). */
export const FILE_REF_MAX_BYTES = 32 * 1024
/** Max file bytes inlined across one prompt expansion. */
export const FILE_REF_TOTAL_MAX_BYTES = 128 * 1024
/** Max successfully resolved references attached to one prompt. */
export const FILE_REF_MAX_EXPANSIONS = 32
/** Max references that may touch the filesystem in one prompt. */
export const FILE_REF_MAX_CANDIDATES = 128

const FILE_REF_BUDGET_NOTICE = '[file reference omitted: expansion budget reached]'

interface CappedReference {
  /** The file's path from the base it was read in. */
  name: string
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
  path: string,
  bases: readonly string[],
  maxBytes: number,
): Promise<CappedReference | null> {
  if (maxBytes <= 0) return null
  for (const base of bases) {
    const abs = confineToDir(base, path)
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
          name: relative(base, abs),
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

interface Budget {
  candidates: number
  expansions: number
  bytes: number
}

const spent = (budget: Budget) =>
  budget.candidates >= FILE_REF_MAX_CANDIDATES ||
  budget.expansions >= FILE_REF_MAX_EXPANSIONS ||
  budget.bytes >= FILE_REF_TOTAL_MAX_BYTES

/** One reference as a fenced block named by its path in its base; none when missing or outside `bases`. */
async function blockOf(
  reference: FileReference,
  bases: readonly string[],
  budget: Budget,
): Promise<string | null> {
  budget.candidates++
  const remaining = FILE_REF_TOTAL_MAX_BYTES - budget.bytes
  const read = await readCappedReference(
    reference.path,
    bases,
    Math.min(FILE_REF_MAX_BYTES, remaining),
  )
  if (!read) return null
  budget.expansions++
  budget.bytes += read.bytes
  const body = `${neutralizeFenceClosers(read.body)}${read.truncated ? '\n… [truncated]' : ''}`
  return `\`\`\` ${read.name}\n${body}\n\`\`\``
}

/**
 * Attach the files a skill's or command's text names with `@` (the kit finds them and leaves the
 * `@` in the text; skills.md: the host attaches them as it does a user's). Each file is read only
 * inside one of `bases` (the session's working folder first): a reference that escapes them,
 * through `..`, an absolute path or a symlink, is missing or is unreadable stays plain text. The
 * blocks follow the text, each capped at {@link FILE_REF_MAX_BYTES}, the whole at
 * {@link FILE_REF_TOTAL_MAX_BYTES}.
 */
export async function attachFileReferences(
  text: string,
  references: readonly FileReference[],
  bases: readonly string[],
): Promise<string> {
  const budget: Budget = { candidates: 0, expansions: 0, bytes: 0 }
  const blocks: string[] = []
  for (const reference of references) {
    if (spent(budget)) {
      blocks.push(FILE_REF_BUDGET_NOTICE)
      break
    }
    const block = await blockOf(reference, bases, budget)
    if (block) blocks.push(block)
  }
  return blocks.length ? `${text}\n\n${blocks.join('\n\n')}` : text
}
