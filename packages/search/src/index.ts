import type {
  SearchField,
  ScoreSearchOptions,
  SearchCandidate,
  RankSearchOptions,
  RankedSearchResult,
} from './contracts'
import { normalizeSearchText } from './normalize'
import { prepareFields, adapterFieldScore } from './field-score'
import { fullTextScore, corpusFullTextScores } from './full-text'

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
 */
export function rankSearchCandidates<T>(
  candidates: readonly SearchCandidate<T>[],
  options: RankSearchOptions<T>,
): RankedSearchResult<T>[] {
  const rawQueries = typeof options.queries === 'string' ? [options.queries] : options.queries
  const queries = rawQueries.map(normalizeSearchText).filter(Boolean)
  if (queries.length === 0) {
    if (options.emptyQuery === 'none') return []
    const all = candidates.map((candidate, index) => ({ candidate, index }))
    if (options.compare) {
      all.sort((a, b) => options.compare!(a.candidate.item, b.candidate.item) || a.index - b.index)
    }
    return all.slice(0, options.limit).map(({ candidate }) => ({
      item: candidate.item,
      score: 0,
      matchedQueryIndexes: [],
    }))
  }

  const minScore = options.minScore ?? Number.EPSILON
  const preparedCandidates = candidates.map((candidate) => prepareFields(candidate.fields))
  const corpusScores = corpusFullTextScores(
    preparedCandidates,
    queries,
    options.scoreOptions?.requireAllTerms ?? false,
  )
  const ranked = candidates.flatMap((candidate, index) => {
    const scores = queries.map((query, queryIndex) =>
      adapterFieldScore(
        preparedCandidates[index]!,
        query,
        corpusScores[queryIndex]!.get(index) ?? 0,
        options.scoreOptions ?? {},
      ),
    )
    const matchedQueryIndexes = scores.flatMap((score, queryIndex) =>
      score >= minScore ? [queryIndex] : [],
    )
    if (matchedQueryIndexes.length === 0) return []
    const max = Math.max(...scores)
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length
    return [
      {
        item: candidate.item,
        score: max * 0.85 + average * 0.15,
        matchedQueryIndexes,
        index,
      },
    ]
  })

  ranked.sort(
    (left, right) =>
      right.score - left.score ||
      (options.compare?.(left.item, right.item) ?? 0) ||
      left.index - right.index,
  )
  return ranked.slice(0, options.limit).map(({ item, score, matchedQueryIndexes }) => ({
    item,
    score,
    matchedQueryIndexes,
  }))
}
