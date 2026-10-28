import { sql, type Kysely } from 'kysely'
import type { AppDatabase, StoredMessagePatch, StoredMessagePayload } from '../../db'
import { deserializeMessagePayload, mergeMessagePayload, serializeMessagePayload } from '../../db'
import type { PersistedMessage } from './contracts'
import type { SessionLeafOps } from './repository-tree'
import { syncMessageUsage } from './repository-usage-sync'
import type { MessageParseCache } from './message-parse-cache'
import { recordCoreChanges } from '../changes/core-entities'

export function createMessageWriteQueries(
  db: Kysely<AppDatabase>,
  leaf: SessionLeafOps,
  cache: MessageParseCache,
) {
  const { currentLeaf, setLeaf } = leaf
  const insertMessages = async (inputs: readonly PersistedMessage[]): Promise<void> => {
    if (inputs.length === 0) return
    const sessionId = inputs[0]!.sessionId
    if (inputs.some((input) => input.sessionId !== sessionId)) {
      throw new Error('insertMessages requires one session')
    }
    await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('agent_messages')
        .select(trx.fn.max('sequence').as('max_seq'))
        .where('session_id', '=', sessionId)
        .executeTakeFirst()
      let sequence = (row?.max_seq ?? -1) + 1
      let parentId = await currentLeaf(sessionId, trx)
      for (const input of inputs) {
        const payloadJson = serializeMessagePayload(input.payload)
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
      await recordCoreChanges(
        trx,
        inputs.map((input) => ({
          entity: 'chat.message' as const,
          op: 'upserted' as const,
          ref: { id: input.id, userId: input.userId, sessionId },
        })),
      )
    })
  }
  return {
    async insertMessage(input: PersistedMessage): Promise<void> {
      await insertMessages([input])
    },

    /** Atomically append a related message batch (e.g. user + assistant turn preamble). */
    async insertMessages(inputs: readonly PersistedMessage[]): Promise<void> {
      await insertMessages(inputs)
    },

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
        // An edit, a foreign write, a turn's end (its usage moved: the ledger follows) or the
        // final flush is a change consumers re-read. The streaming checkpoints between (each
        // carrying the `known` hint of the previous one) are not: they would announce one notice
        // per flush of a reply still being written.
        const usageMoved =
          merged.role === 'assistant' &&
          JSON.stringify(merged.usage) !== JSON.stringify(stored.usage)
        if (!known || finalizing || usageMoved)
          await recordCoreChanges(trx, {
            entity: 'chat.message',
            op: 'upserted',
            ref: { id, userId, sessionId },
          })
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
        await recordCoreChanges(
          trx,
          [...toDelete].map((messageId) => ({
            entity: 'chat.message' as const,
            op: 'deleted' as const,
            ref: { id: messageId, userId, sessionId },
          })),
        )
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
        cache.invalidateSession(sessionId)
      })
    },
  }
}
