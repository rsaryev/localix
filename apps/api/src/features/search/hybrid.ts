/**
 * Hybrid ranking: the query's WORDS and its MEANING, fused into one score. Pure functions.
 *
 * The fusion is DigUp's, which beat reciprocal-rank fusion on its evals (R@1 0.88 vs 0.73):
 *
 *   candidate  ⇔  z ≥ zGate  (stands out by meaning)  OR  coverage ≥ 0.5  (has half the words)
 *   score      =  meaningWeight · max(z, 0)  +  wordsWeight · coverage^1.5
 *
 * so one common word cannot beat a strong meaning match, while every word of an exact lookup
 * usually does. A query made only of codes and numbers ("ERR_402", "TRX50", an order number)
 * means nothing to an embedding: it weighs words double and meaning half.
 *
 * Words are matched by prefix where a language attaches endings. FTS here has no stemmer for
 * Russian, so a Cyrillic word of five or more letters drops its last letter and matches as a
 * prefix (the plural "retries" then finds its genitive form), and the last word of a query
 * being typed is a prefix too. Words under three letters are dropped in every language: they
 * are mostly function words, and an English stopword list covers the rest of that language.
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'we',
  'i',
  'my',
  'me',
  'you',
])

/** Shorter words are dropped as terms; meaning still sees the whole query. */
const MIN_TERM_LENGTH = 3

export interface QueryTerm {
  /** What a word must equal, or start with when `prefix`. Lowercase, NFKC. */
  stem: string
  prefix: boolean
}

const CYRILLIC = /\p{Script=Cyrillic}/u

export function queryTerms(text: string, options: { prefixLast?: boolean } = {}): QueryTerm[] {
  const seen = new Set<string>()
  const words = text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length >= MIN_TERM_LENGTH && !STOPWORDS.has(w) && !seen.has(w) && seen.add(w))
  return words.map((word, index) => {
    if (CYRILLIC.test(word) && word.length >= 5) return { stem: word.slice(0, -1), prefix: true }
    const last = options.prefixLast && index === words.length - 1
    return { stem: word, prefix: !!last && word.length >= 2 }
  })
}

/** The terms as an FTS5 OR-query; '' when nothing is searchable. */
export function ftsOrQuery(terms: readonly QueryTerm[]): string {
  return terms.map((t) => `"${t.stem.replace(/"/g, '')}"${t.prefix ? '*' : ''}`).join(' OR ')
}

/** Share of the query's terms found in `text` (word starts for prefix terms, whole words else). */
export function wordCoverage(terms: readonly QueryTerm[], text: string): number {
  if (terms.length === 0) return 0
  const words = new Set(
    text
      .normalize('NFKC')
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .filter(Boolean),
  )
  let found = 0
  for (const term of terms) {
    if (words.has(term.stem)) found += 1
    else if (term.prefix) {
      for (const w of words) {
        if (w.startsWith(term.stem)) {
          found += 1
          break
        }
      }
    }
  }
  return found / terms.length
}

/** Codes, IDs and long numbers: a query of only these is a lookup, not a description. */
export function isLookupQuery(terms: readonly QueryTerm[]): boolean {
  return (
    terms.length > 0 &&
    terms.every((t) => /\p{N}/u.test(t.stem) && (/\p{L}/u.test(t.stem) || t.stem.length >= 4))
  )
}

export interface FusionInput {
  key: string
  /** Meaning: the best chunk's z for this query (absent when the item had no vector match). */
  z?: number
  /** The z this item's collection needs to stand out; `options.zGate` when absent. */
  gate?: number
  /** Words: share of query terms the item contains (absent when words were not checked). */
  coverage?: number
  /** A provider's own text score in [0,1] (title fuzzy match…), added as words evidence. */
  textScore?: number
}

export interface FusedResult {
  key: string
  score: number
  matchedBy: 'words' | 'meaning' | 'both'
  z: number | null
}

export const WORDS_WEIGHT = 2
export const COVERAGE_GATE = 0.5

export function fuse(
  inputs: Iterable<FusionInput>,
  options: { zGate: number; lookup?: boolean },
): FusedResult[] {
  const meaningWeight = options.lookup ? 0.5 : 1
  const wordsWeight = options.lookup ? WORDS_WEIGHT * 2 : WORDS_WEIGHT
  const out: FusedResult[] = []
  for (const input of inputs) {
    const z = input.z ?? null
    const coverage = input.coverage ?? 0
    const textScore = input.textScore ?? 0
    const byMeaning = z !== null && z >= (input.gate ?? options.zGate)
    const byWords = coverage >= COVERAGE_GATE || textScore > 0
    if (!byMeaning && !byWords) continue
    const score =
      meaningWeight * Math.max(z ?? 0, 0) + wordsWeight * Math.max(coverage, textScore) ** 1.5
    out.push({
      key: input.key,
      score,
      matchedBy: byMeaning && byWords ? 'both' : byMeaning ? 'meaning' : 'words',
      z,
    })
  }
  return out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
}

/** A fused score (unbounded) as the [0,1] relevance `SearchHit.score` carries. */
export function unitScore(fused: number): number {
  return Math.min(0.99, fused / (fused + 3))
}

/** How many leading results score at least `ratio` × the best — the rest are weak matches. */
export function strongCount(scores: readonly number[], ratio = 0.5): number {
  const top = scores[0]
  if (top === undefined || top <= 0) return scores.length
  let n = 0
  while (n < scores.length && scores[n]! >= top * ratio) n += 1
  return n
}
