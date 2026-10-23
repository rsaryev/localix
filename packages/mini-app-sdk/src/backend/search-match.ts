import {
  normalizeSearchText,
  rankSearchCandidates,
  scoreSearchFields,
  type RankedSearchResult,
  type RankSearchOptions,
  type SearchCandidate,
  type SearchField,
  type ScoreSearchOptions,
} from '@localixai/search'

export {
  normalizeSearchText,
  rankSearchCandidates,
  scoreSearchFields,
  type RankedSearchResult,
  type RankSearchOptions,
  type SearchCandidate,
  type SearchField,
  type ScoreSearchOptions,
}

/**
 * Best shared-engine score across several optional fields. (The SDK's own substring/subsequence
 * scorers that used to sit here were a second ranking copy nobody called; `@localixai/search` is the
 * one scorer.)
 */
export function bestFieldScore(fields: Array<string | null | undefined>, needle: string): number {
  let best = 0
  for (const text of fields) {
    const score = scoreSearchFields([{ text }], needle, { requireAllTerms: true })
    if (score > best) best = score
    if (best === 1) break
  }
  return best
}
