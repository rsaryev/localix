import { NotFoundError } from '../../../lib/domain-errors'
import { readdir } from 'node:fs/promises'
import { openSessionEnv, resolveAgainst, type FileOpsContext } from './file-ops-context'
import type { DirEntry, DirListing } from '../contracts'

/** Max entries a single directory listing returns before it's capped (see {@link listDirectory}). */
const DIR_ENTRY_LIMIT = 1000

export async function listDirectory(
  ctx: FileOpsContext,
  userId: string,
  sessionId: string,
  dirPath?: string,
): Promise<DirListing> {
  const { dir: root } = await openSessionEnv(ctx, userId, sessionId)
  const target = !dirPath ? root : resolveAgainst(root, dirPath)

  // Explorer refresh is latency-sensitive and can read several expanded folders after one
  // filesystem frame. A listing stays in-process: spawning a login shell + `ls` per folder
  // measured 12–91x slower than native readdir and also split legal filenames containing
  // newlines into phantom tree rows.
  let unsortedEntries: DirEntry[]
  try {
    unsortedEntries = (await readdir(target, { withFileTypes: true })).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? ('dir' as const) : ('file' as const),
    }))
  } catch {
    throw new NotFoundError('not_a_directory', `${target} is not a directory`)
  }
  const totalEntries = unsortedEntries.length

  const allEntries = unsortedEntries.sort((a, b) =>
    a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
  )

  // Cap huge directories (e.g. `.turbo/cache`, `node_modules` with tens of
  // thousands of entries) so a single expand can't ship — or make the tree
  // render — an unbounded row list and freeze the UI. Dirs sort first, so the
  // cap keeps the most navigable entries; the omitted count rides `truncated`.
  const overflow = totalEntries - DIR_ENTRY_LIMIT
  const entries = overflow > 0 ? allEntries.slice(0, DIR_ENTRY_LIMIT) : allEntries

  return { path: target, entries, ...(overflow > 0 ? { truncated: overflow } : {}) }
}
