/**
 * The HYBRID strategy of chat's two search domains: words and meaning, fused (`search/hybrid`).
 *
 * Used only when the query carries a `semantic` strategy; the lexical code path in
 * `search-provider.ts` is untouched otherwise, so turning semantic search off restores exactly
 * the old behaviour. Each function returns ready `SearchHit`s in the same id/uri grammar as
 * the lexical path — a result opens the same way whichever strategy found it.
 */
import type { SearchHit, SearchQuery } from '../agent-core/search/provider'
import type { SemanticQuery } from '@localixai/plugin-sdk/backend'
import { bestFieldScore } from '../agent-core/search/match'
import {
  ftsOrQuery,
  fuse,
  isLookupQuery,
  queryTerms,
  unitScore,
  wordCoverage,
  type FusionInput,
} from '../search/hybrid'
import type { MessageSearchReads, MessageSearchRow } from './message-search-reads'
import { MESSAGES_COLLECTION, SESSIONS_COLLECTION } from './semantic-sources'

export interface HybridSessionRow {
  id: string
  title: string
  projectId: string | null
  parentSessionId: string | null
  sessionKind: string
}

const WORD_CANDIDATES = 120
const MEANING_CANDIDATES = 80
const SNIPPET_CHARS = 220

/** The excerpt a meaning-only hit shows: the matched chunk, cut at a word near the cap. */
function excerptSnippet(excerpt: string): string {
  const flat = excerpt.replace(/\s+/g, ' ').trim()
  if (flat.length <= SNIPPET_CHARS) return flat
  const cut = flat.lastIndexOf(' ', SNIPPET_CHARS)
  return `${flat.slice(0, cut > SNIPPET_CHARS / 2 ? cut : SNIPPET_CHARS)}…`
}

const inProject = (query: SearchQuery, projectId: string | null | undefined) =>
  query.projectId === undefined || projectId === query.projectId

export async function hybridMessageHits(
  deps: {
    reads: MessageSearchReads
    sessions: HybridSessionRow[]
    toUri(sessionId: string, messageId: string): string
  },
  userId: string,
  query: SearchQuery & { semantic: SemanticQuery },
  cap: number,
): Promise<SearchHit[]> {
  const terms = queryTerms(query.text, { prefixLast: true })
  const [words, meaning] = await Promise.all([
    deps.reads.wordCandidates(userId, ftsOrQuery(terms), WORD_CANDIDATES).catch(() => []),
    query.semantic
      .similar(MESSAGES_COLLECTION, {
        limit: MEANING_CANDIDATES,
        ...(typeof query.projectId === 'string' ? { scope: query.projectId } : {}),
      })
      .catch(() => []),
  ])
  const rows = new Map<string, MessageSearchRow>(words.map((w) => [w.messageId, w]))
  const missing = meaning.filter((m) => !rows.has(m.key)).map((m) => m.key)
  for (const row of await deps.reads.byIds(userId, missing).catch(() => [])) {
    rows.set(row.messageId, row)
  }
  const byKey = new Map(meaning.map((m) => [m.key, m]))
  const sessionOf = new Map(deps.sessions.map((s) => [s.id, s]))

  const inputs: FusionInput[] = []
  for (const row of rows.values()) {
    inputs.push({
      key: row.messageId,
      z: byKey.get(row.messageId)?.z,
      gate: byKey.get(row.messageId)?.gate,
      coverage: wordCoverage(terms, row.text),
    })
  }
  const fused = fuse(inputs, { zGate: query.semantic.zGate, lookup: isLookupQuery(terms) })

  const hits: SearchHit[] = []
  for (const result of fused) {
    const row = rows.get(result.key)!
    const session = sessionOf.get(row.sessionId)
    if (!inProject(query, session?.projectId ?? null)) continue
    const wordSnippet = row.snippet.includes('[') ? row.snippet : ''
    const match = byKey.get(row.messageId)
    const snippet =
      result.matchedBy === 'meaning' || !wordSnippet
        ? excerptSnippet(match?.excerpt || row.text)
        : wordSnippet
    const flat = snippet.replace(/[[\]]/g, '')
    hits.push({
      id: deps.toUri(row.sessionId, row.messageId),
      domain: 'messages',
      title: session?.title || flat.slice(0, 80) || 'Message',
      subtitle: `${row.role} · ${flat}`,
      snippet,
      icon: 'message',
      score: unitScore(result.score),
      matchedBy: result.matchedBy,
    })
    if (hits.length >= cap) break
  }
  return hits
}

export async function hybridSessionHits(
  deps: { sessions: HybridSessionRow[]; toUri(sessionId: string): string },
  query: SearchQuery & { semantic: SemanticQuery },
  cap: number,
): Promise<SearchHit[]> {
  const terms = queryTerms(query.text, { prefixLast: true })
  const meaning = await query.semantic
    .similar(SESSIONS_COLLECTION, {
      limit: MEANING_CANDIDATES,
      ...(typeof query.projectId === 'string' ? { scope: query.projectId } : {}),
    })
    .catch(() => [])
  const matchOf = new Map(meaning.map((m) => [m.key, m]))
  const inputs: FusionInput[] = []
  const visible = deps.sessions.filter((s) => inProject(query, s.projectId))
  for (const s of visible) {
    const textScore = bestFieldScore([s.title], query.text)
    const match = matchOf.get(s.id)
    if (textScore <= 0 && !match) continue
    inputs.push({
      key: s.id,
      z: match?.z,
      gate: match?.gate,
      textScore,
      coverage: wordCoverage(terms, s.title),
    })
  }
  const byId = new Map(visible.map((s) => [s.id, s]))
  return fuse(inputs, { zGate: query.semantic.zGate, lookup: isLookupQuery(terms) })
    .slice(0, cap)
    .map((result) => {
      const s = byId.get(result.key)!
      const isSub = !!s.parentSessionId || s.sessionKind !== 'chat'
      return {
        id: deps.toUri(s.id),
        domain: 'sessions',
        title: s.title || '(untitled chat)',
        subtitle: isSub ? `subsession · ${s.sessionKind}` : undefined,
        icon: isSub ? 'subsession' : 'session',
        score: unitScore(result.score),
        matchedBy: result.matchedBy,
      }
    })
}
