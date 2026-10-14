import type { Transaction } from 'kysely'

import type { AppDatabase } from '../../db/types'
import { INBOX_CAP, INBOX_RETENTION_MS, type InboxChange, type InboxEntry } from './contracts'
import { isPending } from './projection'
import type { NotificationRepository } from './repository'

/**
 * What keeps the journal from growing for as long as the app is installed.
 *
 * A row leaves once it is past the retention horizon AND no longer stands for anything open; the
 * inbox is also held to `INBOX_CAP` rows per user, oldest settled first. Pending work and problems
 * still true are never pruned for age, and go last under the cap — the rows the journal exists to
 * keep. Each pruned row is removed THROUGH the journal (a `removed` event), so an open window drops
 * it too. Events older than the horizon then go: the projection is the state, the events only its
 * history, and a client whose cursor predates them simply re-reads in full (`floor`).
 */

const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60_000

export async function pruneJournal(
  trx: Transaction<AppDatabase>,
  repo: NotificationRepository,
  now: number,
): Promise<Map<string, InboxChange[]>> {
  const horizon = now - INBOX_RETENTION_MS
  const removed = new Map<string, InboxChange[]>()
  const users = await trx.selectFrom('notification_inbox').select('user_id').distinct().execute()

  for (const { user_id: userId } of users) {
    const entries = await repo.all(trx, userId)
    const drop = new Set<InboxEntry>(
      entries.filter((entry) => entry.lastSeenAt < horizon && !isPending(entry)),
    )
    const kept = entries
      .filter((entry) => !drop.has(entry))
      .sort((left, right) => left.lastSeenAt - right.lastSeenAt)
    let excess = kept.length - INBOX_CAP
    for (const pass of [false, true]) {
      for (const entry of kept) {
        if (excess <= 0) break
        if (isPending(entry) !== pass || drop.has(entry)) continue
        drop.add(entry)
        excess -= 1
      }
    }
    const changes: InboxChange[] = []
    for (const entry of drop) {
      const change = await repo.remove(trx, userId, 'server', entry.key, now)
      if (change) changes.push(change)
    }
    if (changes.length) removed.set(userId, changes)
  }

  await trx
    .deleteFrom('notification_events')
    .where('recorded_at', '<', new Date(horizon).toISOString())
    .execute()
  await trx
    .deleteFrom('notification_op_receipts')
    .where('created_at', '<', new Date(now - RECEIPT_RETENTION_MS).toISOString())
    .execute()
  return removed
}
