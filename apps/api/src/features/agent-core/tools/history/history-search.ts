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

// ---- modes ------------------------------------------------------------------------

export type HistorySearchRepo = Pick<
  ChatRepository,
  | 'searchHistoryDetailed'
  | 'getHistoryMessageWindow'
  | 'getSessionBookends'
  | 'listRecentSessionsForHistory'
  | 'getSessionMetaByIds'
>

/** A mode's answer, in the agent tool result shape. */
export type HistoryModeResult = Awaited<ReturnType<typeof runBrowse>> & { isError?: boolean }

/**
 * The conversation-history reads `GlobalSearch` offers beside search: SCROLL (the messages
 * around one, or a session's end), BROWSE (recent sessions) and the full-text DISCOVERY it falls
 * back to in a host without the search service. Errors become a tool error, never a throw.
 */
export function createHistoryModes(repo: HistorySearchRepo, userId: string) {
  const guarded = async (run: () => Promise<HistoryModeResult>): Promise<HistoryModeResult> => {
    try {
      return await run()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      // FTS5 not available (e.g. SQLite built without FTS5) — graceful degradation
      if (message.includes('no such table') || message.includes('no such module')) {
        return {
          content: 'History search is not available in this environment (FTS5 not enabled).',
          isError: true,
        } as HistoryModeResult
      }
      return { content: `History search failed: ${message}`, isError: true } as HistoryModeResult
    }
  }
  return {
    discover: (query: string, limit?: number) =>
      guarded(() => runDiscovery(repo, userId, query, limit) as Promise<HistoryModeResult>),
    scroll: (sessionId: string | null, aroundMessageId: string | null, window?: number) =>
      guarded(
        () =>
          runScroll(repo, userId, sessionId, aroundMessageId, window) as Promise<HistoryModeResult>,
      ),
    browse: (limit?: number) => guarded(() => runBrowse(repo, userId, limit)),
  }
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
