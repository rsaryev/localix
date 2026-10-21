import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../../db/types'
import type { WakeQueueStore } from './wake-queue-store-contracts'

/** Throwing this private sentinel rolls a band write back as an ordinary `false`. */
const partial = new Error('queue band changed')

type BandWrites = Pick<WakeQueueStore, 'renew' | 'fail' | 'retry' | 'removeMany'>

/**
 * The band writes beside claim and ack: keeping a lease alive through a long delivery, parking a
 * band that failed every retry (`dead-letter.ts`), putting it back, and removing a whole batch.
 * Each is all-or-nothing over its ids, like the claim that made the band.
 */
export function createBandWrites(db: Kysely<AppDatabase>): BandWrites {
  const allOrNothing = async (
    ids: readonly string[],
    write: (trx: Kysely<AppDatabase>) => Promise<{ count: bigint | number }>,
  ): Promise<boolean> => {
    if (ids.length === 0) return false
    return db
      .transaction()
      .execute(async (trx) => {
        if (Number((await write(trx)).count) !== ids.length) throw partial
        return true
      })
      .catch((error: unknown) => {
        if (error === partial) return false
        throw error
      })
  }
  const updated = (result: { numUpdatedRows: bigint }) => ({ count: result.numUpdatedRows })

  return {
    renew: (userId, sessionId, ids, leaseOwner, leaseExpiresAt) =>
      allOrNothing(ids, async (trx) =>
        updated(
          await trx
            .updateTable('agent_queue_items')
            .set({ lease_expires_at: leaseExpiresAt })
            .where('user_id', '=', userId)
            .where('session_id', '=', sessionId)
            .where('lease_owner', '=', leaseOwner)
            .where('state', '=', 'leased')
            .where('id', 'in', [...ids])
            .executeTakeFirst(),
        ),
      ),

    fail: (userId, sessionId, ids, leaseOwner, failure) =>
      allOrNothing(ids, async (trx) =>
        updated(
          await trx
            .updateTable('agent_queue_items')
            .set({ state: 'failed', failure, lease_owner: null, lease_expires_at: null })
            .where('user_id', '=', userId)
            .where('session_id', '=', sessionId)
            .where('lease_owner', '=', leaseOwner)
            .where('state', '=', 'leased')
            .where('id', 'in', [...ids])
            .executeTakeFirst(),
        ),
      ),

    retry: (userId, sessionId, ids) =>
      allOrNothing(ids, async (trx) =>
        updated(
          await trx
            .updateTable('agent_queue_items')
            .set({ state: 'pending', failure: null })
            .where('user_id', '=', userId)
            .where('session_id', '=', sessionId)
            .where('state', '=', 'failed')
            .where('id', 'in', [...ids])
            .executeTakeFirst(),
        ),
      ),

    removeMany: (userId, sessionId, ids) =>
      allOrNothing(ids, async (trx) => {
        const result = await trx
          .deleteFrom('agent_queue_items')
          .where('user_id', '=', userId)
          .where('session_id', '=', sessionId)
          .where('state', 'in', ['pending', 'failed'])
          .where('id', 'in', [...ids])
          .executeTakeFirst()
        return { count: result.numDeletedRows }
      }),
  }
}
