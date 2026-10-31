import { normalizeSearchText, rankSearchCandidates } from '@localixai/search'

/** Shared-engine path profile used by quick-open and every project file picker. */
function pathFields(path: string) {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  const normalized = normalizeSearchText(path)
  const initials = normalized
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
  return [
    { text: basename, weight: 1 },
    { text: initials, weight: 0.95 },
    { text: path, weight: 0.75 },
  ]
}

/**
 * Rank project-relative paths against a query, returning every match sorted
 * best-first (shorter path breaks ties). An empty query keeps the input order
 * but sorted shortest-first (a useful "before you type" default). Unlike
 * `rankFiles`, this does NOT cap — the caller paginates — so a UI can report the
 * total match count alongside a page of results.
 */
export function rankPaths(paths: string[], query: string): string[] {
  const q = query.replace(/\s+/g, '').toLowerCase()
  if (!q) return [...paths].sort((a, b) => a.length - b.length)
  return rankSearchCandidates(
    paths.map((path) => ({ item: path, fields: pathFields(path) })),
    {
      queries: q,
      compare: (left, right) => left.length - right.length || left.localeCompare(right),
    },
  ).map((result) => result.item)
}

/**
 * Rank project-relative file paths against a query for the go-to-file palette.
 * Thin cap over {@link rankPaths}.
 */
export function rankFiles(paths: string[], query: string, limit: number): string[] {
  return rankPaths(paths, query).slice(0, limit)
}
