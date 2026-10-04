import { sql, type Kysely } from 'kysely'

import type { AppDatabase, StoredMessagePatch, StoredMessagePayload } from '../../db'
import { deserializeMessagePayload, mergeMessagePayload, serializeMessagePayload } from '../../db'
import type { PersistedMessage } from './contracts'
import { mapMessage } from './repository-mappers'
import type { SessionLeafOps } from './repository-tree'
import { syncMessageUsage } from './repository-usage-sync'
import { createBoundedCache } from '../../lib/bounded-cache'

// Message reads and writes: the branch-aware transcript reads, the bounded digest
// projections, tool-call lookups, and the insert/merge/delete writes. Split out of
// repository.ts. The leaf pointer ops arrive from the tree module so inserts and the
// branch view advance the same pointer, and the cross-run parse cache is created once
// per repository instance below.

/** Cached parse of one message row: content hash + length guard the reuse. */
interface ParsedRow {
  hash: number | bigint
  len: number
  payload: StoredMessagePayload
}

/** Sessions whose parsed rows are retained across listMessages calls (LRU). */
const PARSED_ROW_CACHE_SESSIONS = 6

export function createMessageQueries(db: Kysely<AppDatabase>, leaf: SessionLeafOps) {
  const { currentLeaf, setLeaf, resolveActiveLeaf } = leaf

  // Cross-run parse cache for listMessages. Every run start (user turn, wake,
  // loop tick, each sub-agent's own run) re-reads the session's full history and
  // used to JSON.parse EVERY row's payload again — O(session bytes) of
  // synchronous CPU on the one thread all sessions share, several times over
  // when a batch of sub-agents launches together. Rows are immutable-by-
  // discipline once parsed (see StoredMessagePatch — consumers never mutate a
  // read payload), so the parsed object is reused as long as the row's stored
  // JSON is provably unchanged: a 64-bit content hash + exact length must both
  // match, and ANY writer — including one that edits payload_json directly,
  // outside updateMessage — changes the JSON and therefore misses the cache
  // into an honest re-parse.
  //
  // Sharing one parsed object across runs also makes the object-identity memos
  // downstream (VBC token estimation in @localixai/agent context/tokens.ts)
  // effective across runs instead of within one. Reads accumulate: an active-branch read
  // retains already visited sibling branches, so switching away and back preserves the same
  // parsed objects. Deleted rows are dropped by the WRITER that deletes them
  // (`deleteMessages` clears the session's map) rather than as a side effect of a read
  // taking a different shape, which is what the removed linear-fallback read used to do. The
  // session LRU remains capped to PARSED_ROW_CACHE_SESSIONS sessions.
  const parsedRowCache = createBoundedCache<string, Map<string, ParsedRow>>({
    maxEntries: PARSED_ROW_CACHE_SESSIONS,
  })

  const parseRowsCached = (
    sessionId: string,
    rows: ReadonlyArray<{ id: string; payload_json: string }>,
  ): Map<string, StoredMessagePayload> => {
    const prev = parsedRowCache.get(sessionId)
    const next = new Map(prev)
    const payloads = new Map<string, StoredMessagePayload>()
    for (const row of rows) {
      const hash = Bun.hash(row.payload_json)
      const len = row.payload_json.length
      const cached = prev?.get(row.id)
      const payload =
        cached?.hash === hash && cached.len === len
          ? cached.payload
          : deserializeMessagePayload(row.payload_json)
      next.set(row.id, { hash, len, payload })
      payloads.set(row.id, payload)
    }
    parsedRowCache.set(sessionId, next)
    return payloads
  }

  const insertMessages = async (inputs: readonly PersistedMessage[]): Promise<void> => {
    if (inputs.length === 0) return
    const sessionId = inputs[0]!.sessionId
    if (inputs.some((input) => input.sessionId !== sessionId)) {
      throw new Error('insertMessages requires one session')
    }
    await db.transaction().execute(async (trx) => {
      // Capture display data from the persisted assignment in the same transaction as the
      // message. Registry deletion or later membership changes cannot rewrite authorship.
      const participants = await trx
        .selectFrom('conversation_participants as participant')
        .innerJoin('agent_sessions as session', 'session.id', 'participant.session_id')
        .select(['participant.agent_id', 'participant.handle', 'session.user_id'])
        .where('participant.session_id', '=', sessionId)
        .execute()
      const row = await trx
        .selectFrom('agent_messages')
        .select(trx.fn.max('sequence').as('max_seq'))
        .where('session_id', '=', sessionId)
        .executeTakeFirst()
      let sequence = (row?.max_seq ?? -1) + 1
      let parentId = await currentLeaf(sessionId, trx)
      for (const input of inputs) {
        const participant = participants.find(
          (member) =>
            member.user_id === input.userId && input.payload.from === `agent:${member.agent_id}`,
        )
        const payloadJson = serializeMessagePayload({
          ...input.payload,
          ...(input.payload.authorSnapshot
            ? {}
            : participant
              ? { authorSnapshot: { handle: participant.handle } }
              : {}),
        })
        // Inserts are already complete records (the streaming assistant slot is
        // inserted empty). Seed the ordinary search projection in the same write;
        // later streaming checkpoints update payload_json without touching it.
        await sql`
          INSERT INTO agent_messages (
            id,
            session_id,
            user_id,
            sequence,
            role,
            payload_json,
            search_text,
            parent_id,
            created_at,
            updated_at
          )
          VALUES (
            ${input.id},
            ${input.sessionId},
            ${input.userId},
            ${sequence},
            ${input.payload.role},
            ${payloadJson},
            coalesce(json_extract(${payloadJson}, '$.content'), ''),
            ${parentId},
            ${input.createdAt},
            ${input.updatedAt}
          )
        `.execute(trx)
        if (input.payload.role === 'assistant' && input.payload.usage) {
          await syncMessageUsage(trx, input.id, input.payload)
        }
        sequence += 1
        parentId = input.id
      }
      await setLeaf(sessionId, parentId, trx)
    })
  }
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
      // The Bun/SQLite adapter only returns rows when SELECT is the leading
      // keyword, so wrap the CTE snapshot instead of starting the statement
      // with WITH (the same constraint applies to session ancestry above).
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

    async getMessage(
      userId: string,
      sessionId: string,
      id: string,
    ): Promise<PersistedMessage | null> {
      const row = await db
        .selectFrom('agent_messages')
        .selectAll()
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('id', '=', id)
        .executeTakeFirst()

      return row ? mapMessage(row) : null
    },

    async insertMessage(input: PersistedMessage): Promise<void> {
      await insertMessages([input])
    },

    /** Atomically append a related message batch (e.g. user + assistant turn preamble). */
    async insertMessages(inputs: readonly PersistedMessage[]): Promise<void> {
      await insertMessages(inputs)
    },

    /**
     * WHOLESALE REPLACE — `payload_json` is overwritten with exactly what you pass. This is the
     * ONLY write in the chat tree that replaces an object rather than merging into it
     * (`updateSession` is a per-field patch; every other write touches one scalar column), so it
     * is the only one where a caller can destroy state it never knew about.
     *
     * `StoredMessagePayload` is WIDE (isInternal, origin, uiOnly, contextBoundary,
     * pinned, commandOrigin, voice, timing,
     * providerMeta, review, bindings, items…) and every one of those fields is
     * OPTIONAL — so a caller that builds a fresh payload literal instead of merging into the
     * loaded row type-checks perfectly while silently deleting whatever it left out.
     *
     * CONTRACT for callers: either
     *   (a) read-modify-write — `{ ...loaded.payload, <your field> }` (session-status.ts,
     *       service/review-ops.ts), or
     *   (b) be the row's SOLE AUTHOR for its whole lifetime, so nothing else can put a field on
     *       it that you would drop (the run's own assistant row, via message-persistence.ts).
     *
     * Constructing a fresh payload for a row someone else may also write is the bug: the second
     * writer's field is gone on your next flush, with no type error and no test failure.
     */
    /**
     * MERGE a patch into a message's stored payload. Returns the merged payload actually
     * written (so the caller publishes what the row now holds), or `null` when the row is
     * gone — which, like the plain `UPDATE` this replaced, is a no-op, not an error.
     *
     * It takes a {@link StoredMessagePatch}, not a payload, and that is the whole design:
     * `StoredMessagePayload` requires `id` and `role`, the patch type declares both
     * `?: never`, so a WHOLE rebuilt record is rejected by the compiler at every call site.
     * A writer can only express the delta it authored; everything else on the row — written
     * by an author it has never heard of — is supplied here, from the row. See the long note
     * on `StoredMessagePatch` for the four bugs this closes.
     *
     * Read-merge-write runs in ONE transaction, so a concurrent writer cannot land between
     * the SELECT and the UPDATE and be overwritten. (The old two-statement dance in
     * `child-sessions.ts` — read the row, merge, write — had exactly that window; it is gone
     * because the merge lives here now.)
     *
     * `known` is a STREAMING-FLUSH fast path: the exact `{ payloadJson, payload }` this
     * writer got back from its previous update. When the row's stored JSON is byte-identical
     * to `known.payloadJson` (no other author wrote in between), the merge base is
     * `known.payload` and the O(payload) `JSON.parse` is skipped — a string compare replaces
     * it. Any mismatch (a foreign write — anything editing payload_json directly) falls back to
     * parsing the row, so the hint can never resurrect stale state; it only skips work when
     * provably safe. Returns the written `{ payload, payloadJson }` so the caller can carry
     * the hint forward.
     */
    async updateMessage(
      userId: string,
      sessionId: string,
      id: string,
      patch: StoredMessagePatch,
      updatedAt: string,
      known?: { payloadJson: string; payload: StoredMessagePayload },
    ): Promise<{ payload: StoredMessagePayload; payloadJson: string } | null> {
      return await db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('agent_messages')
          .select(['payload_json'])
          .where('user_id', '=', userId)
          .where('session_id', '=', sessionId)
          .where('id', '=', id)
          .executeTakeFirst()
        if (!row) return null

        const stored =
          known && known.payloadJson === row.payload_json
            ? known.payload
            : deserializeMessagePayload(row.payload_json)
        const merged = mergeMessagePayload(stored, patch)
        const payloadJson = serializeMessagePayload(merged)
        // providerMeta is attached exactly once by the in-process successful
        // finalizer. It is the repository-local signal for the final usage sync;
        // the durable run/session terminal triggers own the search projection.
        const finalizing = stored.providerMeta === undefined && merged.providerMeta !== undefined
        await trx
          .updateTable('agent_messages')
          .set({
            payload_json: payloadJson,
            updated_at: updatedAt,
          })
          .where('user_id', '=', userId)
          .where('session_id', '=', sessionId)
          .where('id', '=', id)
          .execute()
        await syncMessageUsage(trx, id, merged, stored, finalizing)
        return { payload: merged, payloadJson }
      })
    },

    async deleteMessagesByIds(userId: string, sessionId: string, ids: string[]): Promise<void> {
      if (ids.length === 0) return
      await db.transaction().execute(async (trx) => {
        // Expand to full subtrees: a deleted message may have children in OTHER
        // branches (e.g. regenerated siblings hanging under a rolled-back user
        // message). Deleting only the active-path ids would orphan those rows —
        // unreachable from any leaf but still in the table.
        const rows = await trx
          .selectFrom('agent_messages')
          .select(['id', 'parent_id'])
          .where('session_id', '=', sessionId)
          .execute()
        const childrenByParent = new Map<string, string[]>()
        for (const row of rows) {
          if (!row.parent_id) continue
          const list = childrenByParent.get(row.parent_id) ?? []
          list.push(row.id)
          childrenByParent.set(row.parent_id, list)
        }
        const toDelete = new Set<string>()
        const queue = [...ids]
        while (queue.length > 0) {
          const id = queue.pop() as string
          if (toDelete.has(id)) continue
          toDelete.add(id)
          queue.push(...(childrenByParent.get(id) ?? []))
        }
        await trx
          .deleteFrom('agent_messages')
          .where('user_id', '=', userId)
          .where('session_id', '=', sessionId)
          .where('id', 'in', [...toDelete])
          .execute()
        // Repair the tree leaf if it was deleted (e.g. rollback drops the tail):
        // point it at the highest-sequence remaining message, or null when empty.
        const leaf = await currentLeaf(sessionId, trx)
        if (leaf && toDelete.has(leaf)) {
          const tail = await trx
            .selectFrom('agent_messages')
            .select('id')
            .where('session_id', '=', sessionId)
            .orderBy('sequence', 'desc')
            .limit(1)
            .executeTakeFirst()
          await setLeaf(sessionId, tail?.id ?? null, trx)
        }
        // The parsed-payload cache accumulates across reads, so the writer that removes rows
        // is what drops them. It used to happen incidentally, when a read took the linear
        // shape and rebuilt the map; that read no longer exists.
        parsedRowCache.delete(sessionId)
      })
    },
  }
}
