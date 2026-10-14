// Pure filename filter for the file tree ("filter on type").
// Operates over the ALREADY-LOADED tree (`childrenByPath`) — a case-insensitive
// substring match on entry names — and reports which rows to render, which
// folders to force-open, and which name-matched folders should reveal their
// whole subtree. No React / DOM / network, so it is unit-testable in isolation.
//
// Scope note: like the schema-browser filter (which searches loaded columns), this
// narrows the visible/loaded tree — it is a complement to project-wide ⌘P quick-open
// and to the tree's content-search mode, not a replacement for either.
import type { DirEntry } from '@/shared/api/contracts'

export interface FileTreeFilter {
  /** Paths (files + dirs) that should render: a name match, or an ancestor of one. */
  visible: Set<string>
  /** Directory paths to force-open so matches nested under them are revealed. */
  expand: Set<string>
  /**
   * Directories whose OWN name matched: their entire subtree renders unfiltered
   * (you searched for the folder, so its contents are all "in scope").
   */
  showAllUnder: Set<string>
  /** Number of entries (files + dirs) whose own name matched the query. */
  matchCount: number
}

/**
 * Filter the loaded tree under `root` by `query`. Returns `null` for a blank
 * query — the caller renders the full, unfiltered tree instead.
 */
export function filterFileTree(
  root: string | null,
  childrenByPath: Record<string, DirEntry[]>,
  query: string,
): FileTreeFilter | null {
  const q = query.trim().toLowerCase()
  if (!q || !root) return null

  const visible = new Set<string>()
  const expand = new Set<string>()
  const showAllUnder = new Set<string>()
  let matchCount = 0

  // Returns whether anything under `dir` is visible (so ancestors can be kept).
  const walk = (dir: string): boolean => {
    const entries = childrenByPath[dir]
    if (!entries) return false
    let anyVisible = false
    for (const e of entries) {
      const full = `${dir}/${e.name}`
      const selfMatch = e.name.toLowerCase().includes(q)
      if (selfMatch) matchCount++
      const descendantMatch = e.type === 'dir' ? walk(full) : false
      if (selfMatch || descendantMatch) {
        visible.add(full)
        anyVisible = true
        if (e.type === 'dir') {
          // A folder matched by name shows its whole subtree; a folder that only
          // CONTAINS matches is force-opened so those matches are revealed.
          if (selfMatch) showAllUnder.add(full)
          if (descendantMatch) expand.add(full)
        }
      }
    }
    return anyVisible
  }

  walk(root)
  return { visible, expand, showAllUnder, matchCount }
}
