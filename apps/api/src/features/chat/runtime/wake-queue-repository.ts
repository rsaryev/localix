import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../../db/types'
import { mapQueueRows, TURN_KINDS, type WakeQueueStore } from './wake-queue-store-contracts'
import { createBandWrites } from './wake-queue-store-parking'

export type { DurableQueueItem, WakeQueueStore } from './wake-queue-store-contracts'

/** Deterministic transcript ids close the insert→ack crash gap: after restart,
 * retrying the same delivery key addresses the same rows instead of duplicating
 * the user turn. The live adapter must treat an existing pair as committed. */
export function queueDeliveryMessageIds(deliveryKey: string): {
  userMessageId: string
  assistantMessageId: string
} {
  return {
    userMessageId: `queued-${deliveryKey}-user`,
    assistantMessageId: `queued-${deliveryKey}-assistant`,
  }
}

/** Throwing this private sentinel rolls a Kysely transaction back while exposing
 * an ordinary `false` conflict result to queue callers. */
const leaseConflict = new Error('queue lease conflict')

/** SQLite/Kysely adapter. Claim and acknowledgement are all-or-nothing bands. */
export function createDatabaseWakeQueueStore<TPayload = unknown>(
  db: Kysely<AppDatabase>,
): WakeQueueStore<TPayload> {
  return {
    async enqueue(item) {
      return db.transaction().execute(async (trx) => {
        // The producer says a delivery is once-ever; the store does not guess it from the key's
        // spelling. Same transaction as the row: an admission that fails leaves no receipt, so
        // the next attempt is not mistaken for a duplicate.
        if (item.receipt) {
          const receipt = await trx
            .insertInto('agent_delivery_receipts')
            .values({
              delivery_key: item.deliveryKey,
              user_id: item.userId,
              session_id: item.sessionId,
              created_at: new Date().toISOString(),
            })
            .onConflict((oc) => oc.column('delivery_key').doNothing())
            .executeTakeFirst()
          if (Number(receipt.numInsertedOrUpdatedRows) === 0) return false
        }
        await trx
          .insertInto('agent_queue_items')
          .values({
            id: item.id,
            user_id: item.userId,
            session_id: item.sessionId,
            priority: item.priority,
            kind: item.kind,
            payload_json: JSON.stringify(item.payload),
            delivery_key: item.deliveryKey,
            queued_at: item.queuedAt,
            lease_owner: item.leaseOwner ?? null,
            lease_expires_at: item.leaseExpiresAt ?? null,
            state: 'pending',
          })
          // A wake whose producer supplies a delivery key (a trigger fire's
          // `trg:<id>:<seq>`) uses it as the row id, so a retried fire racing the
          // first one hits this row; it is already the desired outcome and its
          // lease remains authoritative.
          .onConflict((oc) => oc.column('id').doNothing())
          .execute()
        return true
      })
    },

    async setPriorities(userId, sessionId, updates) {
      if (updates.length === 0) return true
      return db
        .transaction()
        .execute(async (trx) => {
          for (const update of updates) {
            const result = await trx
              .updateTable('agent_queue_items')
              .set({ priority: update.priority })
              .where('user_id', '=', userId)
              .where('session_id', '=', sessionId)
              .where('id', '=', update.id)
              .where('state', '=', 'pending')
              .executeTakeFirst()
            if (Number(result.numUpdatedRows) !== 1) throw leaseConflict
          }
          return true
        })
        .catch((error) => {
          if (error === leaseConflict) return false
          throw error
        })
    },

    async updatePending(userId, sessionId, id, priority, payload) {
      if (!Number.isFinite(priority)) throw new Error('Invalid priority')
      const result = await db
        .updateTable('agent_queue_items')
        .set({ priority, payload_json: JSON.stringify(payload) })
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('id', '=', id)
        .where('kind', 'in', [...TURN_KINDS])
        .where('state', '=', 'pending')
        .executeTakeFirst()
      return Number(result.numUpdatedRows) === 1
    },

    async listSession(userId, sessionId) {
      const rows = await db
        .selectFrom('agent_queue_items')
        .selectAll()
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('kind', 'in', [...TURN_KINDS])
        .orderBy('priority', 'asc')
        .orderBy('sequence', 'asc')
        .execute()
      return mapQueueRows<TPayload>(rows)
    },

    async listAll() {
      const rows = await db
        .selectFrom('agent_queue_items')
        .selectAll()
        .where('kind', 'in', [...TURN_KINDS])
        .orderBy('priority', 'asc')
        .orderBy('sequence', 'asc')
        .execute()
      return mapQueueRows<TPayload>(rows)
    },

    async claim(userId, sessionId, ids, leaseOwner, now, leaseExpiresAt, batchId) {
      if (ids.length === 0) return false
      return db
        .transaction()
        .execute(async (trx) => {
          const eligible = await trx
            .selectFrom('agent_queue_items')
            .select('id')
            .where('user_id', '=', userId)
            .where('session_id', '=', sessionId)
            .where('id', 'in', [...ids])
            .where((eb) =>
              eb.or([
                eb('state', '=', 'pending'),
                eb.and([eb('state', '=', 'leased'), eb('lease_expires_at', '<=', now)]),
              ]),
            )
            .execute()
          if (eligible.length !== ids.length) return false
          const result = await trx
            .updateTable('agent_queue_items')
            .set({
              state: 'leased',
              lease_owner: leaseOwner,
              lease_expires_at: leaseExpiresAt,
              // A band keeps the name it was first claimed under: a re-claim led by another of
              // its rows (reordered meanwhile) must not mint new transcript ids for it.
              ...(batchId ? { batch_id: sql<string>`coalesce(batch_id, ${batchId})` } : {}),
            })
            .where('user_id', '=', userId)
            .where('session_id', '=', sessionId)
            .where('id', 'in', [...ids])
            // Repeat eligibility on the write itself. The preflight above gives us
            // all-or-nothing band semantics; this predicate prevents a competing
            // owner from being overwritten if state changes before UPDATE wins.
            .where((eb) =>
              eb.or([
                eb('state', '=', 'pending'),
                eb.and([eb('state', '=', 'leased'), eb('lease_expires_at', '<=', now)]),
              ]),
            )
            .executeTakeFirst()
          // A race changing only part of the band must roll back the rows this
          // UPDATE did acquire; returning false would otherwise commit them.
          if (Number(result.numUpdatedRows) !== ids.length) throw leaseConflict
          return true
        })
        .catch((error: unknown) => {
          if (error === leaseConflict) return false
          throw error
        })
    },

    async ack(userId, sessionId, ids, leaseOwner, starting) {
      if (ids.length === 0) return false
      return db
        .transaction()
        .execute(async (trx) => {
          const rows = await trx
            .selectFrom('agent_queue_items')
            .select('id')
            .where('user_id', '=', userId)
            .where('session_id', '=', sessionId)
            .where('lease_owner', '=', leaseOwner)
            .where('state', '=', 'leased')
            .where('id', 'in', [...ids])
            .execute()
          if (rows.length !== ids.length) return false
          const result = await trx
            .deleteFrom('agent_queue_items')
            .where('user_id', '=', userId)
            .where('session_id', '=', sessionId)
            .where('lease_owner', '=', leaseOwner)
            .where('state', '=', 'leased')
            .where('id', 'in', [...ids])
            .executeTakeFirst()
          if (Number(result.numDeletedRows) !== ids.length) throw leaseConflict
          if (starting)
            await trx
              .insertInto('agent_turn_starts')
              .values({
                assistant_message_id: starting.assistantMessageId,
                user_id: userId,
                session_id: sessionId,
                agent_id: starting.agentId,
                created_at: starting.at,
              })
              .onConflict((oc) => oc.column('assistant_message_id').doNothing())
              .execute()
          return true
        })
        .catch((error: unknown) => {
          if (error === leaseConflict) return false
          throw error
        })
    },

    async turnStarted(assistantMessageId) {
      await db
        .deleteFrom('agent_turn_starts')
        .where('assistant_message_id', '=', assistantMessageId)
        .execute()
    },

    async release(userId, sessionId, ids, leaseOwner) {
      if (ids.length === 0) return
      await db
        .updateTable('agent_queue_items')
        .set({ state: 'pending', lease_owner: null, lease_expires_at: null })
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('lease_owner', '=', leaseOwner)
        .where('id', 'in', [...ids])
        .execute()
    },

    async remove(userId, sessionId, id) {
      const result = await db
        .deleteFrom('agent_queue_items')
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('id', '=', id)
        .where('state', 'in', ['pending', 'failed'])
        .executeTakeFirst()
      return Number(result.numDeletedRows) === 1
    },

    ...createBandWrites(db),

    async setPriority(userId, sessionId, id, priority) {
      if (!Number.isFinite(priority)) throw new Error('Invalid priority')
      const result = await db
        .updateTable('agent_queue_items')
        .set({ priority })
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('id', '=', id)
        .where('kind', 'in', [...TURN_KINDS])
        .where('state', '=', 'pending')
        .executeTakeFirst()
      return Number(result.numUpdatedRows) === 1
    },

    async recoverExpired(now) {
      const result = await db
        .updateTable('agent_queue_items')
        .set({ state: 'pending', lease_owner: null, lease_expires_at: null })
        .where('state', '=', 'leased')
        .where('lease_expires_at', '<=', now)
        .executeTakeFirst()
      return Number(result.numUpdatedRows)
    },

    async forgetSession(userId, sessionId) {
      // Kind-agnostic on purpose: this runs when the session itself is gone, so its
      // queued wake requests must go with it (the FK cascade would reach the same rows anyway).
      await db
        .deleteFrom('agent_queue_items')
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .execute()
    },
  }
}
