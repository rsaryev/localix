import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import { sessionSource } from '../source-refs'
import type { ChatRepository, HistorySearchHitDetailed } from '../../../chat/repository'
import {
  BROWSE_DEFAULT_SESSIONS,
  BROWSE_PREVIEW_CHARS,
  capJson,
  DISCOVERY_BOOKEND_COUNT,
  DISCOVERY_DEFAULT_SESSIONS,
  DISCOVERY_MAX_SESSIONS,
  DISCOVERY_PREVIEW_CHARS,
  DISCOVERY_SNIPPETS_PER_SESSION,
  DISCOVERY_WINDOW,
  extractMessageText,
  type HistorySearchDetails,
  type HistorySessionResult,
  SCROLL_DEFAULT_WINDOW,
  SCROLL_PREVIEW_CHARS,
  toFtsMatchQuery,
  toPreview,
  truncate,
} from './history-search-format'

// Re-export the pure formatting/text helpers + types so existing importers
// (tests, tool routes) keep their stable `./history-search` surface.
export * from './history-search-format'

export const historySearchInputSchema = z.object({
  query: z.string().min(1).optional().describe('Discovery: full-text search.'),
  session_id: z.string().optional().describe('Scroll: the session to read.'),
  around_message_id: z
    .string()
    .optional()
    .describe('Scroll: the message to center on; needs no session_id.'),
  window: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .describe('Scroll: messages each side (default 5).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Max sessions (discovery default 5, max 10; browse default 10).'),
})

// ---- tool ------------------------------------------------------------------------

type HistorySearchRepo = Pick<
  ChatRepository,
  | 'searchHistoryDetailed'
  | 'getHistoryMessageWindow'
  | 'getSessionBookends'
  | 'listRecentSessionsForHistory'
  | 'getSessionMetaByIds'
>

export function createHistorySearchTool(repo: HistorySearchRepo, userId: string) {
  return defineAgentTool({
    name: TOOL.history_search,
    label: 'Search History',
    activeVerb: 'Searching history',
    description:
      "Recall this user's past conversations, inspect a delegated child, or coordinate with another session in the same workspace by session_id when work may overlap. Otherwise use only when the user references their OWN prior work, never for general knowledge; one focused query, never near-duplicates. " +
      "`query` searches; `around_message_id` scrolls around that message (its session is implied; `session_id` alone scrolls from a session's end); no args browses recent sessions.",
    inputSchema: historySearchInputSchema,
    mutates: false,
    // Read-only DB queries — safe to run concurrently with other reads.
    executionMode: 'parallel',
    async execute(_toolCallId, input) {
      try {
        if (input.query) return await runDiscovery(repo, userId, input.query, input.limit)
        if (input.session_id || input.around_message_id) {
          return await runScroll(
            repo,
            userId,
            input.session_id ?? null,
            input.around_message_id ?? null,
            input.window,
          )
        }
        return await runBrowse(repo, userId, input.limit)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        // FTS5 not available (e.g. SQLite built without FTS5) — graceful degradation
        if (message.includes('no such table') || message.includes('no such module')) {
          return {
            content: 'History search is not available in this environment (FTS5 not enabled).',
            isError: true,
          }
        }
        return { content: `History search failed: ${message}`, isError: true }
      }
    },
  })
}

async function runDiscovery(
  repo: HistorySearchRepo,
  userId: string,
  query: string,
  limitInput?: number,
) {
  const sessionLimit = Math.min(limitInput ?? DISCOVERY_DEFAULT_SESSIONS, DISCOVERY_MAX_SESSIONS)
  const matchQuery = toFtsMatchQuery(query)
  const details: HistorySearchDetails = { mode: 'discovery', query, userId, count: 0 }
  // Nothing searchable (query was only punctuation/metacharacters) — return cleanly rather
  // than handing FTS5 an empty MATCH.
  if (!matchQuery) {
    return { content: 'No matching messages found in conversation history.', details }
  }

  // Over-fetch hits so grouping by session still fills `sessionLimit` sessions.
  const hits = await repo.searchHistoryDetailed(userId, matchQuery, Math.min(sessionLimit * 5, 50))
  if (hits.length === 0) {
    return { content: 'No matching messages found in conversation history.', details }
  }

  // Group hits by session, preserving FTS rank order (best hit first per session).
  const bySession = new Map<string, HistorySearchHitDetailed[]>()
  for (const hit of hits) {
    const list = bySession.get(hit.sessionId)
    if (list) list.push(hit)
    else if (bySession.size < sessionLimit) bySession.set(hit.sessionId, [hit])
  }

  const meta = new Map(
    (await repo.getSessionMetaByIds(userId, [...bySession.keys()])).map((m) => [m.id, m] as const),
  )

  const sessions: HistorySessionResult[] = []
  for (const [sessionId, sessionHits] of bySession) {
    const best = sessionHits[0]
    const windowRows = await repo.getHistoryMessageWindow(
      userId,
      sessionId,
      best.messageId,
      DISCOVERY_WINDOW,
    )
    const bookends = await repo.getSessionBookends(userId, sessionId, DISCOVERY_BOOKEND_COUNT)
    const windowIds = new Set(windowRows.map((r) => r.id))
    const m = meta.get(sessionId)
    sessions.push({
      sessionId,
      title: m?.title ?? '',
      createdAt: m?.createdAt ?? best.createdAt,
      lastMessageAt: m?.lastMessageAt ?? best.createdAt,
      snippets: sessionHits.slice(0, DISCOVERY_SNIPPETS_PER_SESSION).map((h) => h.snippet),
      matchWindow: windowRows.map((r) => toPreview(r, DISCOVERY_PREVIEW_CHARS)),
      start: bookends.first
        .filter((r) => !windowIds.has(r.id))
        .map((r) => toPreview(r, DISCOVERY_PREVIEW_CHARS)),
      end: bookends.last
        .filter((r) => !windowIds.has(r.id))
        .map((r) => toPreview(r, DISCOVERY_PREVIEW_CHARS)),
    })
  }

  details.count = sessions.length
  // DISCOVERED, not consulted: discovery returns which sessions MATCH, and a match is not a read.
  // Calling these consulted is exactly what the context-system document rejects, and the answer
  // surface hides them while the session registry keeps them.
  return {
    content: capJson({ mode: 'discovery', query, sessions }),
    details,
    sources: sessions.map((session) =>
      sessionSource({
        sessionId: session.sessionId,
        ...(session.title ? { title: session.title } : {}),
        role: 'discovered' as const,
      }),
    ),
  }
}

async function runScroll(
  repo: HistorySearchRepo,
  userId: string,
  requestedSessionId: string | null,
  aroundMessageId: string | null,
  windowInput?: number,
) {
  const window = windowInput ?? SCROLL_DEFAULT_WINDOW
  const rows = await repo.getHistoryMessageWindow(
    userId,
    requestedSessionId,
    aroundMessageId,
    window,
  )
  const sessionId = rows[0]?.sessionId ?? requestedSessionId ?? ''
  const details: HistorySearchDetails = { mode: 'scroll', sessionId, userId, count: rows.length }
  if (rows.length === 0) {
    return {
      content: requestedSessionId
        ? 'No messages found for that session (or the anchor message does not belong to it).'
        : "No message with that id in this user's history.",
      details,
    }
  }
  const payload = {
    mode: 'scroll',
    sessionId,
    anchorMessageId: aroundMessageId ?? rows[rows.length - 1].id,
    messages: rows.map((r) => toPreview(r, SCROLL_PREVIEW_CHARS)),
  }
  // CONSULTED: scroll returns the messages themselves, so that session's content is in the
  // evidence the model reads. The row opens it, which is the honest answer to "where did that
  // come from" — better than the transcript this tool deliberately does not paste in whole.
  return {
    content: capJson(payload),
    details,
    sources: [sessionSource({ sessionId })],
  }
}

async function runBrowse(repo: HistorySearchRepo, userId: string, limitInput?: number) {
  const limit = limitInput ?? BROWSE_DEFAULT_SESSIONS
  const rows = await repo.listRecentSessionsForHistory(userId, limit)
  const details: HistorySearchDetails = { mode: 'browse', userId, count: rows.length }
  if (rows.length === 0) {
    return { content: 'No past sessions found.', details }
  }
  const payload = {
    mode: 'browse',
    sessions: rows.map((r) => ({
      sessionId: r.id,
      title: r.title,
      createdAt: r.createdAt,
      lastMessageAt: r.lastMessageAt,
      messageCount: r.messageCount,
      preview: r.firstUserPayloadJson
        ? truncate(
            extractMessageText(r.firstUserPayloadJson).replace(/\s+/g, ' ').trim(),
            BROWSE_PREVIEW_CHARS,
          )
        : '',
    })),
  }
  return { content: capJson(payload), details }
}
