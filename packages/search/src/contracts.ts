/** One weighted field in a locally ranked document. Put the strongest field first. */
export interface SearchField {
  text: string | null | undefined
  /** Relative relevance. The strongest field is normally 1; supporting prose 0.4–0.7. */
  weight?: number
}

export interface SearchCandidate<T> {
  item: T
  fields: readonly SearchField[]
}

export interface RankedSearchResult<T> {
  item: T
  /** Normalized relevance in [0,1]. */
  score: number
  /** Indexes of the nonblank normalized intents this result matched. */
  matchedQueryIndexes: readonly number[]
}

export interface RankSearchOptions<T> {
  queries: string | readonly string[]
  limit?: number
  minScore?: number
  /** Per-intent matching policy, shared by every candidate in this ranking pass. */
  scoreOptions?: ScoreSearchOptions
  /** Return the deterministic candidate order when every query is blank. */
  emptyQuery?: 'all' | 'none'
  /** Stable domain tie-break after relevance; input order is the final tie-break. */
  compare?: (left: T, right: T) => number
}

export interface ScoreSearchOptions {
  /** Reject a document unless every query term matched at least one field. */
  requireAllTerms?: boolean
}

export interface PreparedField {
  text: string
  terms: readonly string[]
  weight: number
}
