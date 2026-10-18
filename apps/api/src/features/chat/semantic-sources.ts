/**
 * Chat's two semantic sources — the conversation data the semantic index embeds:
 *   - `chat.messages`: the searchable text of every user and assistant message (the same
 *     `search_text` full-text search reads), scoped by project;
 *   - `chat.sessions`: conversation titles, scoped by project.
 *
 * Chat owns these rows, so it owns how they are read; the index only pages through them.
 * Hidden rows — wake prompts (`isInternal`), UI-only notices and system notices — are returned
 * with empty text, which the index treats as "nothing to embed" (and deletes a stale vector).
 * Change capture is the outbox triggers in the `semantic_index` migration; a key `read` does
 * not return was deleted.
 */
import { sql, type Kysely, type RawBuilder } from 'kysely'
import type { SemanticSource, SemanticSourceItem } from '@localixai/plugin-sdk/backend'
import type { AppDatabase } from '../../db/types'

export const MESSAGES_COLLECTION = 'chat.messages'
export const SESSIONS_COLLECTION = 'chat.sessions'

interface MessageRow {
  rowid: number
  id: string
  user_id: string
  project_id: string | null
  text: string
  hidden: number
}

/** One expression shared by scan, read and count, so they agree on what is hidden. */
const HIDDEN = sql<number>`(
  coalesce(json_extract(m.payload_json, '$.isInternal'), 0) = 1
  OR coalesce(json_extract(m.payload_json, '$.uiOnly'), 0) = 1
  OR json_extract(m.payload_json, '$.systemNotice') IS NOT NULL
)`

const toMessageItem = (row: MessageRow): SemanticSourceItem => ({
  key: row.id,
  userId: row.user_id,
  text: row.hidden ? '' : row.text,
  scope: row.project_id,
})

export function createMessagesSemanticSource(db: Kysely<AppDatabase>): SemanticSource {
  const select = (where: RawBuilder<unknown>, limit: number | null) => sql<MessageRow>`
    SELECT m.rowid AS rowid, m.id, m.user_id, s.project_id, m.search_text AS text, ${HIDDEN} AS hidden
    FROM agent_messages AS m
    JOIN agent_sessions AS s ON s.id = m.session_id
    WHERE m.role IN ('user', 'assistant') AND ${where}
    ORDER BY m.rowid
    ${limit === null ? sql`` : sql`LIMIT ${limit}`}
  `
  return {
    collection: MESSAGES_COLLECTION,
    version: 1,
    async scan(cursor, limit) {
      const after = cursor ? Number(cursor) : 0
      const rows = (await select(sql`m.rowid > ${after}`, limit).execute(db)).rows
      return {
        items: rows.map(toMessageItem),
        next: rows.length < limit ? null : String(rows[rows.length - 1]!.rowid),
      }
    },
    async read(keys) {
      if (keys.length === 0) return []
      const rows = (await select(sql`m.id IN (${sql.join(keys)})`, null).execute(db)).rows
      return rows.map(toMessageItem)
    },
    async count() {
      const row = await sql<{ n: number }>`
        SELECT count(*) AS n FROM agent_messages AS m WHERE m.role IN ('user', 'assistant')
      `.execute(db)
      return Number(row.rows[0]?.n ?? 0)
    },
  }
}

export function createSessionsSemanticSource(db: Kysely<AppDatabase>): SemanticSource {
  const base = () =>
    db.selectFrom('agent_sessions').select(['id', 'user_id', 'project_id', 'title'])
  const toItem = (row: {
    id: string
    user_id: string
    project_id: string | null
    title: string
  }) => ({
    key: row.id,
    userId: row.user_id,
    text: row.title,
    scope: row.project_id,
    task: 'search' as const,
  })
  return {
    collection: SESSIONS_COLLECTION,
    version: 1,
    async scan(cursor, limit) {
      let q = base().orderBy('id').limit(limit)
      if (cursor) q = q.where('id', '>', cursor)
      const rows = await q.execute()
      return {
        items: rows.map(toItem),
        next: rows.length < limit ? null : rows[rows.length - 1]!.id,
      }
    },
    async read(keys) {
      if (keys.length === 0) return []
      return (await base().where('id', 'in', keys).execute()).map(toItem)
    },
    async count() {
      const row = await db
        .selectFrom('agent_sessions')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst()
      return Number(row?.n ?? 0)
    },
  }
}
