import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import type {
  HistorySearchHit,
  HistorySearchHitDetailed,
  HistoryMessageRow,
  RecentSessionRow,
  SessionMetaRow,
} from './repository'

// FTS5 history-search + message-window/bookend queries — a distinct concern from
// the session/message tree CRUD in repository.ts. Pure db reads; extracted so the
// repository factory spreads these in via createHistoryQueries(db). Types are
// imported type-only from ./repository (erased — no runtime cycle).

/** Map a selected agent_messages row to the camelCase HistoryMessageRow shape. */
const toHistoryMessageRow = (row: {
  id: string
  session_id: string
  role: string
  payload_json: string
  sequence: number
  created_at: string
}): HistoryMessageRow => ({
  id: row.id,
  sessionId: row.session_id,
  role: row.role,
  payloadJson: row.payload_json,
  sequence: row.sequence,
  createdAt: row.created_at,
})

export function createHistoryQueries(db: Kysely<AppDatabase>) {
  /**
   * Like searchHistory, but each hit also carries the matched message id +
   * sequence so callers can anchor a context window around it (GlobalSearch
   * v2 discovery mode).
   */
  async function searchHistoryDetailed(
    userId: string,
    match: string,
    limit: number,
  ): Promise<HistorySearchHitDetailed[]> {
    const result = await sql<{
      id: string
      session_id: string
      role: string
      snippet: string
      sequence: number
      created_at: string
    }>`
      SELECT
        m.id,
        m.session_id,
        m.role,
        snippet(agent_messages_fts, 0, '[', ']', '…', 20) AS snippet,
        m.sequence,
        m.created_at
      FROM agent_messages_fts
      JOIN agent_messages AS m ON m.rowid = agent_messages_fts.rowid
      WHERE agent_messages_fts MATCH ${match}
        AND m.user_id = ${userId}
      ORDER BY agent_messages_fts.rank
      LIMIT ${limit}
    `.execute(db)
    return result.rows.map((row) => ({
      messageId: row.id,
      sessionId: row.session_id,
      role: row.role,
      snippet: row.snippet,
      sequence: row.sequence,
      createdAt: row.created_at,
    }))
  }

  return {
    /**
     * Full-text search across a user's message history (FTS5). `match` must be a
     * pre-sanitized FTS5 MATCH expression. Throws if FTS5 is unavailable — callers
     * degrade gracefully.
     */
    async searchHistory(userId: string, match: string, limit: number): Promise<HistorySearchHit[]> {
      const hits = await searchHistoryDetailed(userId, match, limit)
      return hits.map(({ sessionId, role, snippet, createdAt }) => ({
        sessionId,
        role,
        snippet,
        createdAt,
      }))
    },

    searchHistoryDetailed,

    /**
     * A ±window of messages around an anchor message, ordered by sequence. A null anchor
     * centers on the session's last message. A null session takes the anchor's own: an
     * evicted-history pointer names only a message id, and the model should not have to know
     * which session it is in to follow it. Returns [] when the anchor is not this user's (or not
     * in the named session).
     */
    async getHistoryMessageWindow(
      userId: string,
      sessionId: string | null,
      anchorMessageId: string | null,
      window: number,
    ): Promise<HistoryMessageRow[]> {
      const owned = db
        .selectFrom('agent_messages')
        .select(['id', 'session_id', 'role', 'payload_json', 'sequence', 'created_at'])
        .where('user_id', '=', userId)
      const scoped = sessionId ? owned.where('session_id', '=', sessionId) : undefined
      const anchor = anchorMessageId
        ? await (scoped ?? owned).where('id', '=', anchorMessageId).executeTakeFirst()
        : await scoped?.orderBy('sequence', 'desc').limit(1).executeTakeFirst()
      if (!anchor) return []
      const base = owned.where('session_id', '=', anchor.session_id)
      const [before, after] = await Promise.all([
        base
          .where('sequence', '<', anchor.sequence)
          .orderBy('sequence', 'desc')
          .limit(window)
          .execute(),
        base
          .where('sequence', '>=', anchor.sequence)
          .orderBy('sequence', 'asc')
          .limit(window + 1)
          .execute(),
      ])
      return [...before.reverse(), ...after].map(toHistoryMessageRow)
    },

    /**
     * First + last `count` user/assistant messages of a session (the "bookends"
     * GlobalSearch discovery attaches to each hit). Overlapping rows (short
     * sessions) appear in `first` only.
     */
    async getSessionBookends(
      userId: string,
      sessionId: string,
      count: number,
    ): Promise<{ first: HistoryMessageRow[]; last: HistoryMessageRow[] }> {
      const base = db
        .selectFrom('agent_messages')
        .select(['id', 'session_id', 'role', 'payload_json', 'sequence', 'created_at'])
        .where('session_id', '=', sessionId)
        .where('user_id', '=', userId)
        .where('role', 'in', ['user', 'assistant'])
      const [firstRows, lastRows] = await Promise.all([
        base.orderBy('sequence', 'asc').limit(count).execute(),
        base.orderBy('sequence', 'desc').limit(count).execute(),
      ])
      const first = firstRows.map(toHistoryMessageRow)
      const firstIds = new Set(first.map((r) => r.id))
      const last: HistoryMessageRow[] = []
      for (let index = lastRows.length - 1; index >= 0; index -= 1) {
        const row = toHistoryMessageRow(lastRows[index])
        if (!firstIds.has(row.id)) last.push(row)
      }
      return { first, last }
    },

    /**
     * Recent sessions for GlobalSearch browse mode — newest activity first,
     * with a cheap message count and the first user message payload (preview).
     */
    async listRecentSessionsForHistory(userId: string, limit: number): Promise<RecentSessionRow[]> {
      const result = await sql<{
        id: string
        title: string
        created_at: string
        last_message_at: string
        message_count: number
        first_user_payload: string | null
      }>`
        SELECT
          s.id,
          s.title,
          s.created_at,
          s.last_message_at,
          (SELECT COUNT(*) FROM agent_messages m WHERE m.session_id = s.id) AS message_count,
          (SELECT m.payload_json FROM agent_messages m
            WHERE m.session_id = s.id AND m.role = 'user'
            ORDER BY m.sequence ASC LIMIT 1) AS first_user_payload
        FROM agent_sessions s
        WHERE s.user_id = ${userId}
        ORDER BY s.last_message_at DESC
        LIMIT ${limit}
      `.execute(db)
      return result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        lastMessageAt: row.last_message_at,
        messageCount: Number(row.message_count),
        firstUserPayloadJson: row.first_user_payload,
      }))
    },

    /** Title + timestamps for a set of session ids (GlobalSearch discovery grouping). */
    async getSessionMetaByIds(userId: string, sessionIds: string[]): Promise<SessionMetaRow[]> {
      if (sessionIds.length === 0) return []
      const rows = await db
        .selectFrom('agent_sessions')
        .select(['id', 'title', 'created_at', 'last_message_at'])
        .where('user_id', '=', userId)
        .where('id', 'in', sessionIds)
        .execute()
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        lastMessageAt: row.last_message_at,
      }))
    },
  }
}
