/**
 * The working tree's content-free fingerprint.
 *
 * Server-resolved commit context is cached against it, so it has to change
 * whenever the next commit's content would — including edits that leave the
 * status flags and the line totals alone (a same-line-count rewrite, or moving a
 * hunk in or out of the index). It never reads a file's CONTENTS: polling stays
 * cheap and no source data is retained anywhere.
 *
 * Split out of `status.ts` for the repo's size ratchet, and the seam holds up —
 * this is a hash over metadata, not a git read, and `collectStatus` is its only
 * caller.
 */
import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { confineToDir } from '../support/path-containment'
import { mapLimit } from '../support/map-limit'
import type { RepoFileChange } from '../contracts'

/** How many `lstat` calls run at once while fingerprinting the changed paths. */
const CHANGE_VERSION_STAT_CONCURRENCY = 24

/**
 * Hash cheap filesystem metadata for changed paths. This intentionally does not
 * read file contents: Git status polling stays inexpensive and no source data is
 * retained, while same-line-count rewrites still change mtime in normal editor,
 * agent and terminal workflows. Status flags cover index-only transitions.
 */
export async function computeChangeVersion(
  cwd: string,
  files: RepoFileChange[],
  indexState = '',
): Promise<string> {
  const entries = await mapLimit(files, CHANGE_VERSION_STAT_CONCURRENCY, async (file) => {
    const safe = confineToDir(cwd, file.path)
    let metadata = 'missing'
    if (safe) {
      try {
        const value = await lstat(safe, { bigint: true })
        // ctime/ino cover atomic same-size replacements that preserve mtime;
        // all fields come from the same cheap lstat (no file-content read).
        metadata = `${value.size}:${value.mtimeNs}:${value.ctimeNs}:${value.ino}:${value.mode}`
      } catch {
        // Deleted and concurrently-renamed paths are represented by their status.
      }
    }
    return [
      file.path,
      file.oldPath ?? '',
      file.status,
      file.staged ? '1' : '0',
      file.unstaged ? '1' : '0',
      metadata,
    ].join('\0')
  })
  return createHash('sha256')
    .update(indexState)
    .update('\0')
    .update(entries.join('\n'))
    .digest('hex')
    .slice(0, 20)
}
