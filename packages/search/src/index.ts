import type {
  SearchField,
  ScoreSearchOptions,
  SearchCandidate,
  RankSearchOptions,
  RankedSearchResult,
} from './contracts'
import { normalizeSearchText } from './normalize'
import { prepareFields, adapterFieldScore } from './field-score'
import { fullTextScore } from './full-text'
import { createSearchIndex } from './search-index'

export { createSearchIndex, type SearchIndex } from './search-index'

export type {
  SearchField,
  SearchCandidate,
  RankedSearchResult,
  RankSearchOptions,
  ScoreSearchOptions,
} from './contracts'
export { normalizeSearchText } from './normalize'

export {
  foldCase,
  matchPositions,
  positionalMatch,
  type MatchKind,
  type PositionalMatch,
} from './positions'

/** Score one document against one intent, allowing its terms to match across fields. */
export function scoreSearchFields(
  fields: readonly SearchField[],
  query: string,
  options: ScoreSearchOptions = {},
): number {
  const needle = normalizeSearchText(query)
  if (!needle) return 0
  const prepared = prepareFields(fields)
  if (prepared.length === 0) return 0

  const fullText = fullTextScore(prepared, needle, options.requireAllTerms ?? false)

  return adapterFieldScore(prepared, needle, fullText, options)
}

/**
 * Rank a catalog once for one or many intents, fusing scores per submitted candidate;
 * multi-query fusion rewards broad support without allowing several weak matches to beat one
 * exact match. This is intentionally an in-memory ranker, not a replacement for FTS retrieval.
 * For a catalog queried repeatedly (type-ahead), build it once with `createSearchIndex`.
 */
export function rankSearchCandidates<T>(
  candidates: readonly SearchCandidate<T>[],
  options: RankSearchOptions<T>,
): RankedSearchResult<T>[] {
  return createSearchIndex(candidates).rank(options)
}
