/**
 * How long "this delivery was admitted once" is remembered.
 *
 * A receipt (`agent_delivery_receipts`, written with the wake row by `wake-queue-store.ts`) is what
 * makes a second admission of the same once-ever delivery a duplicate. Kept forever, the table
 * grows by one row per delegated child for the life of the install; dropped too early, a sweep that
 * still looks at the child re-sends its report. So the two are one horizon:
 *
 *   receipts older than the horizon are pruned → the recovery sweep never considers a child that
 *   settled before it (`recover-delegation.ts`) → a pruned receipt can never be missed.
 *
 * The order is safe because a receipt is always written AFTER its child settled (the live path
 * wakes once the child is terminal; the sweep waits a grace period on top), so a child leaves the
 * sweep's window no later than its receipt leaves the table.
 */
import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../../db/types'

export const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** The oldest moment still inside the horizon, as the ISO text both tables store. */
export const receiptHorizon = (now: number): string =>
  new Date(now - RECEIPT_RETENTION_MS).toISOString()

/**
 * Record that a once-ever delivery was DECIDED without being sent.
 *
 * The recovery sweep re-sends any settled child run whose key has no receipt — it reads "no
 * receipt" as "the process died before the report was admitted". A run whose report was skipped
 * on purpose (a stopped run, a person's own dialog with the child: `run/child-run-report.ts`)
 * also has no receipt, so without this the sweep would send, half a minute later, exactly the
 * report the live seam decided against. Same table, same key, same horizon: to the sweep, a
 * decided delivery and an admitted one are both done.
 */
export async function recordDecidedDelivery(
  db: Kysely<AppDatabase>,
  receipt: { deliveryKey: string; userId: string; sessionId: string },
): Promise<void> {
  await db
    .insertInto('agent_delivery_receipts')
    .values({
      delivery_key: receipt.deliveryKey,
      user_id: receipt.userId,
      session_id: receipt.sessionId,
      created_at: new Date().toISOString(),
    })
    .onConflict((oc) => oc.column('delivery_key').doNothing())
    .execute()
}

/** Drop receipts past the horizon; answers how many went. */
export async function pruneDeliveryReceipts(
  db: Kysely<AppDatabase>,
  now = Date.now(),
): Promise<number> {
  const result = await db
    .deleteFrom('agent_delivery_receipts')
    .where('created_at', '<', receiptHorizon(now))
    .executeTakeFirst()
  return Number(result.numDeletedRows)
}
