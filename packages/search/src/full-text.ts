import MiniSearch, { type SearchOptions } from 'minisearch'
import type { PreparedField } from './contracts'
import { normalizeSearchText, words } from './normalize'

function matchingOptions(requireAllTerms: boolean): SearchOptions {
  return {
    combineWith: requireAllTerms ? 'AND' : 'OR',
    prefix: (term) => term.length >= 2,
    fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
    maxFuzzy: 2,
    weights: { fuzzy: 0.45, prefix: 0.75 },
  }
}

type IndexedDocument = { id: number } & Record<string, string | number>

const FULL_TEXT_SCORE_SATURATION = 0.5

/**
 * Let MiniSearch own ordinary token, prefix, fuzzy, and BM25 relevance. The
 * surrounding adapter only maps its open-ended score onto Localix's public
 * [0,1] scale and applies per-candidate field weights.
 */
export function fullTextScore(
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
    ...matchingOptions(requireAllTerms),
  })
  if (!result) return 0

  const queryTermCount = new Set(words(query)).size
  const matchedTermCount = new Set(result.queryTerms).size
  const coverage = queryTermCount === 0 ? 0 : Math.min(1, matchedTermCount / queryTermCount)
  const normalized = result.score / (result.score + FULL_TEXT_SCORE_SATURATION)
  return Math.min(1, normalized * (0.7 + coverage * 0.3))
}

export function corpusFullTextScores(
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
      ...matchingOptions(requireAllTerms),
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
