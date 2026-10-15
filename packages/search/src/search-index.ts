import type { SearchCandidate, RankSearchOptions, RankedSearchResult } from './contracts'
import { normalizeSearchText } from './normalize'
import { prepareFields, adapterFieldScore } from './field-score'
import { buildCorpusScorer } from './full-text'

/** A catalog normalized and indexed once, ranked against any number of later queries. */
export interface SearchIndex<T> {
  readonly size: number
  rank(options: RankSearchOptions<T>): RankedSearchResult<T>[]
}

/**
 * Prepare fields and build the full-text corpus once. Callers that rank the same catalog per
 * keystroke keep the index and call `rank` instead of re-normalizing every candidate each time.
 */
export function createSearchIndex<T>(candidates: readonly SearchCandidate<T>[]): SearchIndex<T> {
  const preparedCandidates = candidates.map((candidate) => prepareFields(candidate.fields))
  let corpus: ReturnType<typeof buildCorpusScorer> | undefined
  const scoreCorpus = (queries: readonly string[], requireAllTerms: boolean) =>
    (corpus ??= buildCorpusScorer(preparedCandidates))(queries, requireAllTerms)

  return {
    size: candidates.length,
    rank(options) {
      const rawQueries = typeof options.queries === 'string' ? [options.queries] : options.queries
      const queries = rawQueries.map(normalizeSearchText).filter(Boolean)
      if (queries.length === 0) {
        if (options.emptyQuery === 'none') return []
        const all = candidates.map((candidate, index) => ({ candidate, index }))
        if (options.compare) {
          all.sort(
            (a, b) => options.compare!(a.candidate.item, b.candidate.item) || a.index - b.index,
          )
        }
        return all.slice(0, options.limit).map(({ candidate }) => ({
          item: candidate.item,
          score: 0,
          matchedQueryIndexes: [],
        }))
      }

      const minScore = options.minScore ?? Number.EPSILON
      const corpusScores = scoreCorpus(queries, options.scoreOptions?.requireAllTerms ?? false)
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
    },
  }
}
