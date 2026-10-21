import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import type { WakeShape } from './delivery'

/** Rows older than this are given up at boot: a wake that late answers nothing anymore. */
export const WAKE_OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * The durable side of wake delivery (`delivery.ts`): a keyed wake is recorded before it is sent,
 * and leaves when the session's queue admits it (`wake-queue-repository.ts`, `enqueue`, same
 * transaction) or delivery answers. What is left at boot was lost with the process.
 */
export function createWakeOutboxRepository<R extends WakeShape>(db: Kysely<AppDatabase>) {
  return {
    async record(request: R, at: string): Promise<void> {
      await db
        .insertInto('wake_outbox')
        .values({
          delivery_key: request.deliveryKey!,
          user_id: request.userId,
          session_id: request.sessionId,
          request_json: JSON.stringify(request),
          created_at: at,
        })
        .onConflict((oc) => oc.column('delivery_key').doNothing())
        .execute()
    },
    async remove(deliveryKey: string): Promise<void> {
      await db.deleteFrom('wake_outbox').where('delivery_key', '=', deliveryKey).execute()
    },
    /** What is left, oldest first; rows past the horizon are dropped instead. */
    async pending(now: number): Promise<R[]> {
      const horizon = new Date(now - WAKE_OUTBOX_MAX_AGE_MS).toISOString()
      await db.deleteFrom('wake_outbox').where('created_at', '<', horizon).execute()
      const rows = await db.selectFrom('wake_outbox').selectAll().orderBy('created_at').execute()
      return rows.map((row) => JSON.parse(row.request_json) as R)
    },
  }
}

export type WakeOutbox<R extends WakeShape = WakeShape> = ReturnType<
  typeof createWakeOutboxRepository<R>
>
