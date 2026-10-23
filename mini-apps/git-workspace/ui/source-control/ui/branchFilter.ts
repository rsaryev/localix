/**
 * Narrowing a branch list by a typed query — the pure half of the Branches
 * section's filter box.
 *
 * Kept separate from the component because the ranking rules are the part worth
 * pinning down: a repo with two hundred branches is exactly the repo where the
 * section is unusable without this, and exactly the one where "why is that
 * fourth?" needs an answer.
 *
 * Ranking, best first:
 *  1. exact name,
 *  2. prefix (`feat` → `feature/login` before `fix/feature-flag`),
 *  3. substring, earlier position wins,
 *  4. subsequence (`fl` → `feature/login`) — the loosest, and last.
 *
 * Ties keep the INPUT order, which is git's `--sort=-committerdate`: among
 * equally good textual matches the one you touched most recently is the one you
 * meant. Matching is case-insensitive; a blank query returns the list untouched
 * (same array identity, so an unfiltered render allocates nothing).
 */

import { positionalMatch } from '@localixai/mini-app-sdk/ui/utilities'

/** The least a row needs to be filterable. Both branch shapes satisfy it. */
export interface FilterableBranch {
  name: string
}

/**
 * Lower is better; `null` = not a match at all. The kind comes from the shared positional matcher
 * — the same one `MatchedText` highlights the row with, so the lit characters are the match that
 * ranked it.
 */
export function branchMatchScore(name: string, query: string): number | null {
  if (!query.trim()) return 0
  const match = positionalMatch(query, name)
  if (!match) return null
  if (match.kind === 'exact') return 0
  if (match.kind === 'prefix') return 1
  // Position-weighted, but always worse than a prefix and better than a
  // subsequence: the bands never overlap however long the name is.
  if (match.kind === 'substring') return 2 + Math.min(match.start, 900) / 1000
  return 4
}

/**
 * Filter + rank `branches` by `query`, keeping input order among equal scores.
 * `pinned` (the current branch) always survives the filter — hiding the branch
 * you are standing on makes the section lie about where you are.
 */
export function filterBranches<T extends FilterableBranch>(
  branches: readonly T[],
  query: string,
  pinned?: string | null,
): readonly T[] {
  if (!query.trim()) return branches
  const scored: Array<{ item: T; score: number; order: number }> = []
  branches.forEach((item, order) => {
    const score = item.name === pinned ? -1 : branchMatchScore(item.name, query)
    if (score !== null) scored.push({ item, score, order })
  })
  scored.sort((a, b) => a.score - b.score || a.order - b.order)
  return scored.map((entry) => entry.item)
}
