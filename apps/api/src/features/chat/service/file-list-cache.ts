import type { IndexedProjectFiles } from '../../agent-core/project-file-index'

/**
 * Short-lived memo of a workspace's project-relative FILE LIST — the `rg --files`
 * walk that backs ⌘P quick-open, the composer's @-autocomplete and the tree search
 * box.
 *
 * Those surfaces search server-side on every keystroke (behind a ~90ms debounce),
 * and each search re-walked the entire tree: typing five characters spawned five
 * full `rg --files` runs and re-parsed the whole path list each time. Measured:
 * ~10ms / 7k paths on a mid-sized monorepo, ~50ms / 16k paths on a large one — per
 * keystroke, per surface, on top of whatever else the machine is doing.
 *
 * The fix is to index once and invalidate on change, at the smallest size that
 * fits: memoize the walk per (root, includeIgnored), hold it for
 * a few seconds, and drop it the moment anything says the tree moved. The PROMISE is
 * memoized, so keystrokes that overlap one walk share it instead of racing.
 *
 * Staleness is bounded from both ends. `invalidateFileList` is called from the
 * file-tree mutations (the user's own create/rename/delete/paste) and from the
 * fs-watch feed (agent writes, builds, branch switches), so in practice the memo is
 * dropped as soon as it is wrong. The TTL is only the backstop for the case with no
 * live watcher — an ssh/docker session, or a tree nobody has opened.
 */

/** Backstop lifetime for an un-invalidated entry. Deliberately short: it only has
 *  to cover a burst of keystrokes, not a working session. */
export const FILE_LIST_TTL_MS = 5_000

/**
 * Ceiling on how many paths the searchable index holds. A real ceiling, unlike the
 * byte-level stdout capture cap it replaces: that one kept the TAIL of `rg --files`
 * output past 4 MB, so a large tree lost a silent, unknowable share of its files
 * (measured: 14,611 of 33,094). This one is a path count, it is applied to the
 * FRONT of the walk, and whatever it drops is counted and reported to the caller as
 * `indexTruncated`. Generous enough that no ordinary repo reaches it — a
 * mid-sized monorepo is ~7k files, a large one ~16k.
 */
export { MAX_INDEXED_FILES } from '../../agent-core/project-file-index'
export type { IndexedProjectFiles as IndexedFiles } from '../../agent-core/project-file-index'

interface Entry {
  at: number
  files: Promise<IndexedProjectFiles>
}

const cache = new Map<string, Entry>()

const keyOf = (root: string, includeIgnored: boolean) => `${root}\0${includeIgnored ? '1' : '0'}`

/**
 * The memoized file list for a workspace root, computing it via `load` on a miss.
 * A rejected load is never cached — the next keystroke retries.
 */
export async function getProjectFileList(
  root: string,
  includeIgnored: boolean,
  load: () => Promise<IndexedProjectFiles>,
  nowMs: () => number = Date.now,
): Promise<IndexedProjectFiles> {
  const key = keyOf(root, includeIgnored)
  const hit = cache.get(key)
  if (hit && nowMs() - hit.at < FILE_LIST_TTL_MS) return hit.files

  const files = load()
  cache.set(key, { at: nowMs(), files })
  try {
    return await files
  } catch (err) {
    // Only drop OUR entry: a concurrent invalidation may already have replaced it.
    if (cache.get(key)?.files === files) cache.delete(key)
    throw err
  }
}

/**
 * Drop a root's memo (both ignore modes), or the whole cache when no root is given.
 * Call after anything that adds/removes a path: a tree mutation, an fs-watch frame.
 */
export function invalidateFileList(root?: string): void {
  if (root === undefined) {
    cache.clear()
    return
  }
  cache.delete(keyOf(root, true))
  cache.delete(keyOf(root, false))
}
