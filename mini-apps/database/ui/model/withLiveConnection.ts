/**
 * Run one request against a connection, and survive the backend having forgotten it.
 *
 * The defect: the backend's live drivers live in memory. An API restart or a mini app reload
 * empties that registry while the saved connection — and this UI's row, still "connected" —
 * survive, so the next Run answered `connection_not_found` and asked for a reconnect by hand, for a
 * connection one reconnect away from working. The shape is "reconnect and retry".
 *
 * Why retrying is safe: that code is the server refusing BEFORE any driver is reached — nothing
 * ran, so re-sending a write cannot apply it twice. Exactly once: a connection still gone after a
 * successful reconnect is gone for a reason, and that error is the answer.
 *
 * The one case that must not retry: a manual transaction was open. It ended with the old driver,
 * and a retry would run the statement in autocommit on the fresh one — outside the transaction the
 * person believes they are in. So it reconnects (the next Run works) and says what was lost.
 */
import { DbApiError } from '../api/databaseApi'
import { reviveConnection } from './connectionsActions'
import { transactionStore } from './sql-console/transactionStore'

export const TRANSACTION_LOST_MESSAGE =
  'The connection was restarted, and its open transaction ended with it — nothing in it was ' +
  'committed. The connection is back; run the transaction again.'

export async function withLiveConnection<T>(id: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    if (!(error instanceof DbApiError) || error.code !== 'connection_not_found') throw error
    const transactionWasOpen = transactionStore.getSnapshot(id).txOpen
    const live = await reviveConnection(id)
    if (!live) throw error
    if (transactionWasOpen) throw new DbApiError(TRANSACTION_LOST_MESSAGE)
    return request()
  }
}
