/**
 * Search over a small catalog by words and, when semantic search answers, by meaning — the same
 * fusion chats use (`hybrid.ts`). A catalog's vectors are its own collection, so its search is
 * never crowded by another's; a match counts only when it stands out from its own collection.
 *
 * Items are keyed `<scope>:<name>` in the index (`global`, or a project id) and by name in the
 * list a provider reads, which already merges the global ones with the project's.
 */
import { SEMANTIC_GLOBAL_SCOPE } from '@localixai/mini-app-sdk/backend'
import { bestFieldScore } from '../agent-core/search/match'
import { catalogNameOf } from '../embeddings/list-source'
import type { SearchHit, SearchQuery } from '../agent-core/search/provider'
import { queryTerms } from '../../lib/fts-query'
import { fuse, isLookupQuery, unitScore, wordCoverage, type FusionInput } from './hybrid'

const MEANING_CANDIDATES = 50

export async function catalogHits<Row>(
  query: SearchQuery,
  catalog: {
    collection: string
    rows: readonly Row[]
    nameOf: (row: Row) => string
    /** The fields words are matched in, most telling first. */
    fields: (row: Row) => ReadonlyArray<string | null | undefined>
    hit: (row: Row, score: number) => SearchHit
  },
): Promise<SearchHit[]> {
  const { rows } = catalog
  const fieldsOf = (row: Row) => catalog.fields(row).filter((f): f is string => !!f)
  const lexical = rows.map((row) => ({
    row,
    textScore: bestFieldScore(fieldsOf(row), query.text),
  }))
  if (!query.semantic) {
    return lexical.filter((r) => r.textScore > 0).map((r) => catalog.hit(r.row, r.textScore))
  }
  const scope =
    typeof query.projectId === 'string' ? [SEMANTIC_GLOBAL_SCOPE, query.projectId] : undefined
  const matches = await query.semantic
    .similar(catalog.collection, { limit: MEANING_CANDIDATES, ...(scope ? { scope } : {}) })
    .catch(() => [])
  // A project's item shadows the global one of the same name; either answers for the name.
  const matchOf = new Map<string, (typeof matches)[number]>()
  for (const match of matches) {
    const name = catalogNameOf(match.key)
    if ((matchOf.get(name)?.z ?? -Infinity) < match.z) matchOf.set(name, match)
  }
  const terms = queryTerms(query.text, { prefixLast: true })
  const byName = new Map<string, Row>()
  const inputs: FusionInput[] = []
  for (const { row, textScore } of lexical) {
    const name = catalog.nameOf(row)
    const match = matchOf.get(name)
    if (textScore <= 0 && !match) continue
    byName.set(name, row)
    inputs.push({
      key: name,
      z: match?.z,
      gate: match?.gate,
      textScore,
      coverage: wordCoverage(terms, fieldsOf(row).join(' ')),
    })
  }
  return fuse(inputs, { zGate: query.semantic.zGate, lookup: isLookupQuery(terms) }).map(
    (result) => ({
      ...catalog.hit(byName.get(result.key)!, unitScore(result.score)),
      matchedBy: result.matchedBy,
    }),
  )
}
