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
 * A query's words are its terms (`lib/fts-query.ts`), the same ones FTS5 matched.
 */
import type { QueryTerm } from '../../lib/fts-query'

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
