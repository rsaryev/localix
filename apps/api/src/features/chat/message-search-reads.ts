/**
 * The reads the HYBRID message search needs beyond `searchHistoryDetailed`:
 *   - word candidates with their whole searchable text, so word coverage can be measured
 *     (FTS rank alone cannot say "has 3 of the 4 words");
 *   - messages by id, for hits found by meaning alone (no FTS row to take a snippet from).
 * Both are scoped to the user and skip hidden rows, matching what the semantic source embeds.
 */
import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'

export interface MessageSearchRow {
  messageId: string
  sessionId: string
  role: string
  text: string
  snippet: string
  createdAt: string
}

/** Searchable text kept per candidate — enough for coverage and a snippet, bounded per row. */
const TEXT_CAP = 4000

const VISIBLE = sql`(
  coalesce(json_extract(m.payload_json, '$.isInternal'), 0) = 0
  AND coalesce(json_extract(m.payload_json, '$.uiOnly'), 0) = 0
  AND json_extract(m.payload_json, '$.systemNotice') IS NULL
)`

type Row = {
  id: string
  session_id: string
  role: string
  text: string
  snippet: string
  created_at: string
}

const toRow = (row: Row): MessageSearchRow => ({
  messageId: row.id,
  sessionId: row.session_id,
  role: row.role,
  text: row.text,
  snippet: row.snippet,
  createdAt: row.created_at,
})

export function createMessageSearchReads(db: Kysely<AppDatabase>) {
  return {
    /** FTS candidates for an OR-query (`ftsOrQuery`), best rank first. */
    async wordCandidates(
      userId: string,
      match: string,
      limit: number,
    ): Promise<MessageSearchRow[]> {
      if (!match) return []
      const result = await sql<Row>`
        SELECT m.id, m.session_id, m.role, m.created_at,
          substr(m.search_text, 1, ${TEXT_CAP}) AS text,
          snippet(agent_messages_fts, 0, '[', ']', '…', 20) AS snippet
        FROM agent_messages_fts
        JOIN agent_messages AS m ON m.rowid = agent_messages_fts.rowid
        WHERE agent_messages_fts MATCH ${match}
          AND m.user_id = ${userId}
          AND ${VISIBLE}
        ORDER BY agent_messages_fts.rank
        LIMIT ${limit}
      `.execute(db)
      return result.rows.map(toRow)
    },

    async byIds(userId: string, ids: readonly string[]): Promise<MessageSearchRow[]> {
      if (ids.length === 0) return []
      const result = await sql<Row>`
        SELECT m.id, m.session_id, m.role, m.created_at,
          substr(m.search_text, 1, ${TEXT_CAP}) AS text, '' AS snippet
        FROM agent_messages AS m
        WHERE m.user_id = ${userId} AND m.id IN (${sql.join([...ids])}) AND ${VISIBLE}
      `.execute(db)
      return result.rows.map(toRow)
    },
  }
}

export type MessageSearchReads = ReturnType<typeof createMessageSearchReads>
