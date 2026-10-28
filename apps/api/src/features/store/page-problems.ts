import { shelfKinds, type StoreProblem } from '@localixai/store'

import type { ListingQuery } from './service-types'

/**
 * The unread sources a listing page says: those of the kinds its shelf lists. A plugin marketplace
 * that could not be read is said on Plugins and on the shelves of what plugins give, never above
 * the mini apps; a search, Discover and the library span every kind, and Sources says each one.
 */
export function pageProblems(
  problems: readonly StoreProblem[],
  query: Pick<ListingQuery, 'shelf' | 'q'>,
): StoreProblem[] {
  if (!query.shelf || query.q?.trim()) return []
  const kinds = shelfKinds(query.shelf)
  return problems.filter((problem) => kinds.includes(problem.kind))
}
