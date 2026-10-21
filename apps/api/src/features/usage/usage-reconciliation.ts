import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { selectLedgerSources, writeLedgerRows } from './ledger-rows'

export function createUsageReconciliation(db: Kysely<AppDatabase>) {
  return {
    /**
     * Write the chat-turn rows of these assistant messages, or of every assistant message of
     * these sessions, from the messages themselves (the usage-ledger projector). Idempotent: a
     * message written twice yields the same row. Returns the rows inserted or changed.
     */
    async projectMessages(scope: { messageIds?: string[]; sessionIds?: string[] }) {
      const messageIds = scope.messageIds ?? []
      const sessionIds = scope.sessionIds ?? []
      if (messageIds.length === 0 && sessionIds.length === 0) return 0
      const rows = await selectLedgerSources(
        db,
        { messageIds, sessionIds },
        // A session's messages: only those whose row disagrees (a run's end re-reads them all).
        messageIds.length === 0,
      )
      return writeLedgerRows(db, rows)
    },

    /**
     * One keyset page of the full reconcile: the next `limit` assistant messages after
     * `afterId`. The whole-table form was ONE synchronous statement — ~230–300 ms on a cold page
     * cache for a 60 MB database, every millisecond of it with the event loop held — so the page
     * bounds the ROWS SCANNED (ids first, off the assistant partial index), not the rows matched.
     * `maxBytes` also ends the window at the row whose payload crosses it (never below one row):
     * the cost is per BYTE parsed. `octet_length` reads the record header, not the text.
     * `lastId: null` means the scan is complete.
     */
    async reconcileAssistantMessagePage(page: {
      afterId: string | null
      limit: number
      maxBytes?: number
    }): Promise<{ repaired: number; lastId: string | null }> {
      const window = await db
        .selectFrom('agent_messages')
        .select(['id', sql<number>`octet_length(payload_json)`.as('bytes')])
        .where('role', '=', 'assistant')
        .$if(page.afterId !== null, (qb) => qb.where('id', '>', page.afterId!))
        .orderBy('id')
        .limit(page.limit)
        .execute()
      let lastId: string | undefined
      let bytes = 0
      for (const row of window) {
        if (lastId !== undefined && bytes + row.bytes > (page.maxBytes ?? Infinity)) break
        lastId = row.id
        bytes += row.bytes
      }
      if (lastId === undefined) return { repaired: 0, lastId: null }
      const rows = await selectLedgerSources(db, { afterId: page.afterId, throughId: lastId }, true)
      return { repaired: await writeLedgerRows(db, rows), lastId }
    },
  }
}
