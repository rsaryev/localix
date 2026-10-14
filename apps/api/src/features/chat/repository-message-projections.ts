import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import { deserializeMessagePayload } from '../../db'
import type { PersistedMessage } from './contracts'
import { mapMessage } from './repository-mappers'
import type { SessionLeafOps } from './repository-tree'

export function createMessageProjectionQueries(db: Kysely<AppDatabase>, leaf: SessionLeafOps) {
  const { resolveActiveLeaf } = leaf
  return {
    /**
     * Chat-nav's default session drill needs only a newest-first page plus an
     * honest has-more marker. Walking the branch for an exact total costs O(all
     * turns), so stop recursion after `limit + 1` visible rows instead. The
     * extra row proves truncation without hydrating the complete transcript.
     */
    async listRecentVisibleMessages(userId: string, sessionId: string, limit: number) {
      const pageLimit = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 1
      const fetchLimit = pageLimit + 1
      const activeLeaf = await resolveActiveLeaf(userId, sessionId)
      if (!activeLeaf) return { messages: [], hasMore: false }

      let rows: Parameters<typeof mapMessage>[0][]
      {
        const result = await sql<Parameters<typeof mapMessage>[0]>`
          SELECT message.id, message.session_id, message.user_id, message.payload_json,
                 message.created_at, message.updated_at
          FROM (
            WITH RECURSIVE active_branch(id, parent_id, depth, visible_count) AS (
              SELECT leaf.id, leaf.parent_id, 0,
                     CASE
                       WHEN leaf.role IN ('user', 'assistant')
                        AND coalesce(json_extract(leaf.payload_json, '$.uiOnly'), 0) <> 1
                       THEN 1 ELSE 0
                     END
              FROM agent_messages AS leaf
              WHERE leaf.id = ${activeLeaf}
                AND leaf.user_id = ${userId}
                AND leaf.session_id = ${sessionId}
              UNION ALL
              SELECT parent.id, parent.parent_id, child.depth + 1,
                     child.visible_count + CASE
                       WHEN parent.role IN ('user', 'assistant')
                        AND coalesce(json_extract(parent.payload_json, '$.uiOnly'), 0) <> 1
                       THEN 1 ELSE 0
                     END
              FROM agent_messages AS parent
              JOIN active_branch AS child ON parent.id = child.parent_id
              WHERE parent.user_id = ${userId}
                AND parent.session_id = ${sessionId}
                AND child.visible_count < ${fetchLimit}
            )
            SELECT id, depth
            FROM active_branch
          ) AS branch
          JOIN agent_messages AS message ON message.id = branch.id
          WHERE message.role IN ('user', 'assistant')
            AND coalesce(json_extract(message.payload_json, '$.uiOnly'), 0) <> 1
          ORDER BY branch.depth ASC
          LIMIT ${fetchLimit}
        `.execute(db)
        rows = result.rows
      }
      return {
        messages: rows.slice(0, pageLimit).map(mapMessage),
        hasMore: rows.length > pageLimit,
      }
    },

    /**
     * Latest non-empty assistant reply for runtime-owned autonomous sessions,
     * which are append-only linear chains (not branch-switchable UI chats). Keep
     * the content predicate and ordering in SQLite so a long run contributes one
     * parsed payload, not every historical row.
     */
    async getLatestAutonomousAssistantContentMessage(
      userId: string,
      sessionId: string,
    ): Promise<PersistedMessage | null> {
      const row = await db
        .selectFrom('agent_messages')
        .selectAll()
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('role', '=', 'assistant')
        .where(sql<boolean>`coalesce(json_extract(payload_json, '$.content'), '') <> ''`)
        .orderBy('sequence', 'desc')
        .limit(1)
        .executeTakeFirst()
      return row ? mapMessage(row) : null
    },

    /**
     * Compact session refs preserve the same active-branch semantics as
     * listMessages, but need only a count and a bounded visible tail. The recursive CTE keeps transcript bytes and parsing
     * off this path. The leaf is an enforced invariant (see `resolveActiveLeaf`), so there is
     * no second row set to fall back to.
     */
    async getSessionDigestMessages(userId: string, sessionId: string, tailLimit: number) {
      const result = await sql<{
        message_count: number
        recent_payloads: string
      }>`
        SELECT digest.*
        FROM (
          WITH RECURSIVE active_branch(id, parent_id, sequence, role, payload_json) AS (
            SELECT message.id, message.parent_id, message.sequence, message.role,
                   message.payload_json
            FROM agent_sessions AS session
            JOIN agent_messages AS message ON message.id = session.leaf_id
            WHERE session.user_id = ${userId}
              AND session.id = ${sessionId}
              AND message.user_id = ${userId}
              AND message.session_id = ${sessionId}
            UNION
            SELECT parent.id, parent.parent_id, parent.sequence, parent.role,
                   parent.payload_json
            FROM agent_messages AS parent
            JOIN active_branch AS child ON parent.id = child.parent_id
            WHERE parent.user_id = ${userId}
              AND parent.session_id = ${sessionId}
          ),
          scoped AS (
            SELECT id, parent_id, sequence, role, payload_json FROM active_branch
          )
          SELECT
            (SELECT count(*) FROM scoped) AS message_count,
            (
              SELECT coalesce(json_group_array(payload_json), '[]')
              FROM (
                SELECT payload_json
                FROM scoped
                WHERE role IN ('user', 'assistant')
                  AND coalesce(json_extract(payload_json, '$.uiOnly'), 0) <> 1
                ORDER BY sequence DESC
                LIMIT ${tailLimit}
              )
            ) AS recent_payloads
        ) AS digest
      `.execute(db)
      const row = result.rows[0]
      const payloadJson = JSON.parse(row?.recent_payloads ?? '[]') as string[]
      return {
        messageCount: Number(row?.message_count ?? 0),
        recentPayloads: payloadJson.map(deserializeMessagePayload).reverse(),
      }
    },

    /**
     * Recovery callers know the exact tool-call id. Find the first matching item on the
     * active branch inside SQLite, parsing only its owning message.
     */
    async findActiveBranchToolCallMessage(
      userId: string,
      sessionId: string,
      toolCallId: string,
      itemStatus?: string,
    ): Promise<PersistedMessage | null> {
      const statusPredicate = itemStatus
        ? sql`AND json_extract(item.value, '$.status') = ${itemStatus}`
        : sql``
      const result = await sql<Parameters<typeof mapMessage>[0]>`
        SELECT message.*
        FROM agent_messages AS message
        JOIN (
          WITH RECURSIVE active_branch(id, parent_id, sequence, payload_json) AS (
            SELECT entry.id, entry.parent_id, entry.sequence, entry.payload_json
            FROM agent_sessions AS session
            JOIN agent_messages AS entry ON entry.id = session.leaf_id
            WHERE session.user_id = ${userId}
              AND session.id = ${sessionId}
              AND entry.user_id = ${userId}
              AND entry.session_id = ${sessionId}
            UNION
            SELECT parent.id, parent.parent_id, parent.sequence, parent.payload_json
            FROM agent_messages AS parent
            JOIN active_branch AS child ON parent.id = child.parent_id
            WHERE parent.user_id = ${userId}
              AND parent.session_id = ${sessionId}
          ),
          scoped AS (
            SELECT id, sequence, payload_json FROM active_branch
          )
          SELECT scoped.id
          FROM scoped
          JOIN json_each(scoped.payload_json, '$.items') AS item
          WHERE json_extract(item.value, '$.toolCallId') = ${toolCallId}
          ${statusPredicate}
          ORDER BY scoped.sequence ASC
          LIMIT 1
        ) AS matched ON matched.id = message.id
        WHERE message.user_id = ${userId}
          AND message.session_id = ${sessionId}
      `.execute(db)
      const row = result.rows[0]
      return row ? mapMessage(row) : null
    },

    /**
     * Composer call refs may use a literal id prefix. Restrict JSON parsing to
     * active-branch messages containing a matching item; chronological order
     * lets the caller preserve its latest-copy-per-full-id rule.
     */
    async listActiveBranchToolCallMessagesByPrefix(
      userId: string,
      sessionId: string,
      toolCallPrefix: string,
    ): Promise<PersistedMessage[]> {
      const result = await sql<Parameters<typeof mapMessage>[0]>`
        SELECT message.*
        FROM agent_messages AS message
        JOIN (
          WITH RECURSIVE active_branch(id, parent_id, sequence, payload_json) AS (
            SELECT entry.id, entry.parent_id, entry.sequence, entry.payload_json
            FROM agent_sessions AS session
            JOIN agent_messages AS entry ON entry.id = session.leaf_id
            WHERE session.user_id = ${userId}
              AND session.id = ${sessionId}
              AND entry.user_id = ${userId}
              AND entry.session_id = ${sessionId}
            UNION
            SELECT parent.id, parent.parent_id, parent.sequence, parent.payload_json
            FROM agent_messages AS parent
            JOIN active_branch AS child ON parent.id = child.parent_id
            WHERE parent.user_id = ${userId}
              AND parent.session_id = ${sessionId}
          ),
          scoped AS (
            SELECT id, sequence, payload_json FROM active_branch
          )
          SELECT DISTINCT scoped.id, scoped.sequence
          FROM scoped
          JOIN json_each(scoped.payload_json, '$.items') AS item
          WHERE substr(
            json_extract(item.value, '$.toolCallId'),
            1,
            length(${toolCallPrefix})
          ) = ${toolCallPrefix}
        ) AS matched ON matched.id = message.id
        WHERE message.user_id = ${userId}
          AND message.session_id = ${sessionId}
        ORDER BY matched.sequence ASC
      `.execute(db)
      return result.rows.map(mapMessage)
    },
  }
}
