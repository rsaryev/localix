import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import { deserializeMessagePayload } from '../../db'
import type { PersistedMessage } from './contracts'
import type { mapMessage } from './repository-mappers'
import type { SessionLeafOps } from './repository-tree'
import type { MessageParseCache } from './message-parse-cache'

export function createMessageBranchQueries(
  db: Kysely<AppDatabase>,
  leaf: SessionLeafOps,
  cache: MessageParseCache,
) {
  const { resolveActiveLeaf } = leaf
  const { parseRowsCached } = cache
  return {
    async listMessages(userId: string, sessionId: string): Promise<PersistedMessage[]> {
      type MessageRow = Parameters<typeof mapMessage>[0] & {
        sequence: number
        parent_id: string | null
      }
      type BranchMessageRow = MessageRow & {
        sibling_count: number
        sibling_index: number
      }

      // Resolve the leaf before reading payloads. The recursive branch query
      // returns only root→leaf payload rows; sibling metadata is counted from
      // indexed ids/parent ids/sequences, so abandoned tool-result blobs never
      // cross the SQLite boundary or enter the parse cache.
      const activeLeaf = await resolveActiveLeaf(userId, sessionId)
      // No leaf means no messages — `resolveActiveLeaf` repairs a pointer that merely could
      // not be walked, so reaching here with rows in the table is not a state that exists.
      if (!activeLeaf) return []
      let branchRows: BranchMessageRow[] = []
      {
        // Two costs used to grow faster than the history did — measured at 4 ms for 400 rows
        // and 62 ms for 2000 (×5 rows, ×15 time), on the path EVERY run starts with:
        //
        //   - the recursive walk carried a `visited` string of every id seen so far as its
        //     cycle guard, so each step concatenated and `instr`-scanned O(depth) bytes:
        //     quadratic in history length. The guard is now the row count — a walk cannot be
        //     longer than the session has messages — and a cycle is detected below in JS,
        //     which truncates exactly where the old guard did;
        //
        // The sibling metadata stays a window pass over the session's rows: measured, that
        // is O(n log n) and cheap (7 ms at 2000), while the "obvious" replacement — a GROUP BY
        // plus one correlated `sequence <` count per branch row — was 209 ms, because the
        // (session_id, parent_id) index cannot serve the sequence range. Same rows, same
        // order, same metadata (the straightforward implementation in repository-messages.test.ts
        // is the oracle); 62 ms → ~8 ms at 2000 rows.
        // The depth cap is fetched ONCE and bound as a value. Written inline as a scalar
        // subquery it was re-evaluated on every recursion step — a full count per row, which
        // is the quadratic cost this rewrite exists to remove (measured: 211 ms at 2000 rows).
        const depthCap = await sql<{ n: number }>`
          SELECT count(*) AS n FROM agent_messages
          WHERE session_id = ${sessionId} AND user_id = ${userId}
        `
          .execute(db)
          .then((r) => r.rows[0]?.n ?? 0)
        const result = await sql<BranchMessageRow>`
          SELECT message.id,
                 message.session_id,
                 message.user_id,
                 message.sequence,
                 message.payload_json,
                 message.parent_id,
                 message.created_at,
                 message.updated_at,
                 metadata.sibling_count,
                 metadata.sibling_index
          FROM (
            WITH RECURSIVE active_branch(id, parent_id, depth) AS (
              SELECT leaf.id, leaf.parent_id, 0
              FROM agent_messages AS leaf
              WHERE leaf.id = ${activeLeaf}
                AND leaf.user_id = ${userId}
                AND leaf.session_id = ${sessionId}
              UNION ALL
              SELECT parent.id, parent.parent_id, child.depth + 1
              FROM agent_messages AS parent
              JOIN active_branch AS child ON parent.id = child.parent_id
              WHERE parent.user_id = ${userId}
                AND parent.session_id = ${sessionId}
                AND child.depth < ${depthCap}
            )
            SELECT id, depth
            FROM active_branch
          ) AS branch
          JOIN agent_messages AS message ON message.id = branch.id
          JOIN (
            SELECT id,
                   count(*) OVER (PARTITION BY parent_id) AS sibling_count,
                   row_number() OVER (PARTITION BY parent_id ORDER BY sequence) - 1
                     AS sibling_index
            FROM agent_messages
            WHERE user_id = ${userId}
              AND session_id = ${sessionId}
          ) AS metadata ON metadata.id = message.id
          ORDER BY branch.depth ASC
        `.execute(db)
        // Leaf-first (depth ASC), then reversed into chronological order. A corrupted parent
        // chain that loops re-emits ids until the depth cap; keeping the FIRST occurrence of
        // each in leaf-first order keeps the copy nearest the leaf — exactly where the old
        // `visited` guard stopped the walk — and says so rather than silently swallowing it.
        const seen = new Set<string>()
        branchRows = result.rows
          .filter((row) => {
            if (seen.has(row.id)) return false
            seen.add(row.id)
            return true
          })
          .reverse()
        if (branchRows.length !== result.rows.length) {
          console.warn(
            `[chat-repository] session ${sessionId}: parent chain loops (${result.rows.length - branchRows.length} repeated rows dropped)`,
          )
        }
      }
      if (branchRows.length === 0) return []

      // Hot path: this runs at EVERY run start. Reuse parsed payloads for rows
      // whose stored JSON is unchanged instead of re-parsing the whole history.
      const payloads = parseRowsCached(sessionId, branchRows)
      const toMessage = (row: MessageRow): PersistedMessage => ({
        id: row.id,
        sessionId: row.session_id,
        userId: row.user_id,
        payload: payloads.get(row.id) ?? deserializeMessagePayload(row.payload_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })

      // The tree stores only conversation messages, so the leaf→root path IS the
      // message list in chronological order (a `/clear` is a payload contextBoundary
      // flag, and the model's view lives in agent_message_model_context — neither is
      // a tree entry of its own).
      //
      // Branch metadata: a message has alternatives when it shares a parent_id
      // with siblings (e.g. regenerations). Siblings are ordered by sequence so
      // the index is stable — computed here so every consumer (UI switcher) gets
      // it without hydrating sibling payloads.
      return branchRows.map((row) => {
        const msg = toMessage(row)
        if (row.sibling_count > 1) {
          msg.branch = { index: row.sibling_index, count: row.sibling_count }
        }
        return msg
      })
    },
  }
}
