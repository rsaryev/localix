import MiniSearch from 'minisearch'

export {
  foldCase,
  matchPositions,
  positionalMatch,
  type MatchKind,
  type PositionalMatch,
} from './positions'

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
  /** Indexes of the submitted intents this result matched. */
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

const WORDS = /[\p{Letter}\p{Number}]+/gu

/** Accent-insensitive, Unicode-aware text used by every Localix local-search surface. */
export function normalizeSearchText(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/\p{Mark}/gu, '')
      .toLocaleLowerCase()
      .match(WORDS)
      ?.join(' ') ?? ''
  )
}

function words(value: string): string[] {
  return value ? value.split(' ') : []
}

function compact(value: string): string {
  return value.replace(/ /g, '')
}

/** Quality of an ordered abbreviation inside one word, rewarding tight spans. */
function wordSubsequenceScore(target: string, query: string): number {
  if (query.length < 2 || query.length > target.length) return 0
  let shortest = Number.POSITIVE_INFINITY
  for (
    let start = target.indexOf(query[0]!);
    start >= 0;
    start = target.indexOf(query[0]!, start + 1)
  ) {
    let queryIndex = 1
    let end = start
    while (++end < target.length && queryIndex < query.length) {
      if (target[end] === query[queryIndex]) queryIndex += 1
    }
    if (queryIndex === query.length) shortest = Math.min(shortest, end - start)
  }
  if (!Number.isFinite(shortest)) return 0
  const gaps = shortest - query.length
  if (gaps > Math.max(4, query.length * 2)) return 0
  return Math.max(0.35, 0.62 - gaps * 0.04)
}

/** Inflections the plural rule accepts: plugin→plugins, box→boxes, entry→entries. */
const PLURAL_TAIL = new Set(['s', 'es'])

function wordScore(target: string, query: string): number {
  if (target === query) return 1
  if (query.length >= 2 && target.startsWith(query)) return 0.9
  // Catalog plurals: an indexed "plugin" should answer a query for "plugins".
  // The tail is checked for an actual inflection rather than "any two characters",
  // because the loose form scored the STOPWORD "the" against a query for "theme"
  // at 0.74 — so every entry whose prose contained the word "the" ranked as a
  // theme match. Length alone cannot separate those: "box"→"boxes" is the same
  // shape as "the"→"theme"; only the tail tells them apart.
  if (target.length >= 3 && query.startsWith(target) && PLURAL_TAIL.has(query.slice(target.length)))
    return 0.74
  return wordSubsequenceScore(target, query)
}

function phraseScore(target: string, query: string): number {
  if (!target || !query) return 0
  if (target === query) return 1
  if (target.startsWith(query)) return 0.9
  const at = target.indexOf(query)
  if (at >= 0) return target[at - 1] === ' ' ? 0.8 : 0.6
  const compactQuery = compact(query)
  const compactTarget = compact(target)
  const compactPhrase = words(target).some((term) => term.length > 1)
  if (compactPhrase && compactQuery.length >= 2 && compactTarget === compactQuery) return 0.9
  if (compactPhrase && compactQuery.length >= 2 && compactTarget.startsWith(compactQuery))
    return 0.85
  if (compactPhrase && compactQuery.length >= 3 && compactTarget.includes(compactQuery)) return 0.75
  return wordSubsequenceScore(compactTarget, compactQuery) * 0.82
}

interface PreparedField {
  text: string
  terms: readonly string[]
  weight: number
}

type IndexedDocument = { id: number } & Record<string, string | number>

const FULL_TEXT_SCORE_SATURATION = 0.5

/**
 * Let MiniSearch own ordinary token, prefix, fuzzy, and BM25 relevance. The
 * surrounding adapter only maps its open-ended score onto Localix's public
 * [0,1] scale and applies per-candidate field weights.
 */
function fullTextScore(
  fields: readonly PreparedField[],
  query: string,
  requireAllTerms: boolean,
): number {
  const fieldNames = fields.map((_, index) => `field${index}`)
  const document: IndexedDocument = { id: 0 }
  const boost: Record<string, number> = {}
  for (const [index, field] of fields.entries()) {
    const fieldName = fieldNames[index]!
    document[fieldName] = field.text
    boost[fieldName] = field.weight
  }

  const index = new MiniSearch<IndexedDocument>({
    fields: fieldNames,
    tokenize: (text) => words(normalizeSearchText(text)),
  })
  index.add(document)
  const [result] = index.search(query, {
    boost,
    combineWith: requireAllTerms ? 'AND' : 'OR',
    prefix: (term) => term.length >= 2,
    fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
    maxFuzzy: 2,
    weights: { fuzzy: 0.45, prefix: 0.75 },
  })
  if (!result) return 0

  const queryTermCount = new Set(words(query)).size
  const matchedTermCount = new Set(result.queryTerms).size
  const coverage = queryTermCount === 0 ? 0 : Math.min(1, matchedTermCount / queryTermCount)
  const normalized = result.score / (result.score + FULL_TEXT_SCORE_SATURATION)
  return Math.min(1, normalized * (0.7 + coverage * 0.3))
}

function corpusFullTextScores(
  candidates: readonly (readonly PreparedField[])[],
  queries: readonly string[],
  requireAllTerms: boolean,
): readonly ReadonlyMap<number, number>[] {
  const fieldCount = Math.max(0, ...candidates.map((fields) => fields.length))
  if (fieldCount === 0) return queries.map(() => new Map())

  const fieldNames = Array.from({ length: fieldCount }, (_, index) => `field${index}`)
  const documents = candidates.map((fields, id) => {
    const document: IndexedDocument = { id }
    for (const [index, field] of fields.entries()) document[fieldNames[index]!] = field.text
    return document
  })
  const index = new MiniSearch<IndexedDocument>({
    fields: fieldNames,
    tokenize: (text) => words(normalizeSearchText(text)),
  })
  index.addAll(documents)

  return queries.map((query) => {
    const queryTermCount = new Set(words(query)).size
    const scores = new Map<number, number>()
    for (const result of index.search(query, {
      combineWith: requireAllTerms ? 'AND' : 'OR',
      prefix: (term) => term.length >= 2,
      fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
      maxFuzzy: 2,
      weights: { fuzzy: 0.45, prefix: 0.75 },
    })) {
      const candidateIndex = Number(result.id)
      const fields = candidates[candidateIndex]
      if (!fields) continue

      const matchedFieldWeights = Object.values(result.match).map((fieldMatches) =>
        Math.max(
          0,
          ...fieldMatches.map((fieldName) => fields[Number(fieldName.slice(5))]?.weight ?? 0),
        ),
      )
      const fieldWeight =
        matchedFieldWeights.length === 0
          ? 1
          : matchedFieldWeights.reduce((sum, weight) => sum + weight, 0) /
            matchedFieldWeights.length
      const matchedTermCount = new Set(result.queryTerms).size
      const coverage = queryTermCount === 0 ? 0 : Math.min(1, matchedTermCount / queryTermCount)
      const normalized = result.score / (result.score + FULL_TEXT_SCORE_SATURATION)
      scores.set(candidateIndex, Math.min(1, normalized * fieldWeight * (0.7 + coverage * 0.3)))
    }
    return scores
  })
}

function prepareFields(fields: readonly SearchField[]): PreparedField[] {
  const present = fields
    .map((field) => ({ text: normalizeSearchText(field.text ?? ''), weight: field.weight ?? 1 }))
    .filter((field) => field.text && Number.isFinite(field.weight) && field.weight > 0)
  const maxWeight = Math.max(1, ...present.map((field) => field.weight))
  return present.map((field) => ({
    text: field.text,
    terms: words(field.text),
    weight: field.weight / maxWeight,
  }))
}

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

function adapterFieldScore(
  prepared: readonly PreparedField[],
  needle: string,
  fullText: number,
  options: ScoreSearchOptions,
): number {
  const queryTerms = words(needle)

  let phrase = 0
  for (const field of prepared) {
    phrase = Math.max(phrase, phraseScore(field.text, needle) * field.weight)
  }

  // Compact identifiers and ordered abbreviations intentionally sit outside
  // MiniSearch's word-based model. Keep them as a narrow compatibility adapter.
  let adapterTotal = 0
  let matched = 0
  for (const term of queryTerms) {
    let best = 0
    for (const field of prepared) {
      for (const candidate of field.terms) {
        best = Math.max(best, wordScore(candidate, term) * field.weight)
      }
    }
    if (best > 0) matched += 1
    adapterTotal += best
  }
  const coverage = matched / queryTerms.length
  const adapterScore = (adapterTotal / queryTerms.length) * (0.7 + coverage * 0.3)
  if (options.requireAllTerms && fullText === 0 && coverage < 1) return 0
  let score = Math.max(phrase, fullText, adapterScore)
  // Retain the positional quality of a single-term phrase match: an entire
  // field, its prefix, a word boundary, and a mid-word hit must remain distinct.
  if (queryTerms.length === 1 && phrase > 0) score = Math.min(score, phrase)
  return Math.min(1, score)
}

/**
 * Rank a catalog once for one or many intents. Results are deduplicated by candidate identity;
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
