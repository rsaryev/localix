/**
 * Which session a unit of work runs on: the open manual transaction or the ordinary driver.
 *
 * Every query-shaped path (console query, script, browse, atomic batch, metadata) asks this
 * one question, and a wrong answer is a data bug, not a slowdown: work that escapes a manual
 * transaction onto the auto-commit path commits behind the user's back, and work that waits on
 * the wrong boundary deadlocks PostgreSQL's single pooled connection.
 */
import type { DbTransaction } from '../drivers/port'
import { DbError } from '../errors'
import type { LiveEntry } from './live-entry'

/**
 * Work arriving while Begin is acquiring a pinned connection belongs to that transaction;
 * work arriving while COMMIT/ROLLBACK is settling must start only after that boundary. Await
 * either shared lifecycle promise, but keep the wait abortable so the query timeout/cancel
 * contract covers slow transaction transitions. The transition itself continues independently.
 */
export async function waitForTransactionTransition(
  live: LiveEntry,
  signal?: AbortSignal,
): Promise<void> {
  const transition = live.openingTx ?? live.settlingTx
  if (!transition) return
  if (!signal) {
    await transition
    return waitForTransactionTransition(live)
  }
  if (signal.aborted) throw signal.reason ?? new DbError('cancelled')

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(signal.reason ?? new DbError('cancelled'))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    transition.then(
      () => {
        cleanup()
        resolve()
      },
      (err) => {
        cleanup()
        reject(err)
      },
    )
  })
  return waitForTransactionTransition(live, signal)
}

/**
 * Choose the ordinary driver or atomically enqueue work on the current manual transaction.
 * The loop closes the tiny race where settlement starts after an awaited transition check:
 * a caller either owns a FIFO slot before `activeTx` is cleared, or observes `settlingTx`
 * and retries after the boundary. It can never escape onto the auto-commit driver midway.
 */
export async function runWithTransaction<T>(
  live: LiveEntry,
  inTransaction: (tx: DbTransaction) => Promise<T>,
  outsideTransaction: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  while (true) {
    await waitForTransactionTransition(live, signal)
    // With no transition, the helper above has nothing to await and therefore cannot
    // observe an already-aborted caller. Never invoke a driver for work cancelled before
    // dispatch: a driver may ignore AbortSignal and still apply a write before we notice.
    if (signal?.aborted) throw signal.reason ?? new DbError('cancelled')
    if (live.closing) throw new DbError('cancelled')
    // A transition can be installed after the awaited helper returned but before this
    // continuation resumed. Recheck before selecting a runner.
    if (live.openingTx || live.settlingTx) continue
    const tx = live.activeTx
    if (!tx) return outsideTransaction()
    const queue = live.activeTxQueue
    return queue ? queue.run(() => inTransaction(tx), signal) : inTransaction(tx)
  }
}

/** Register non-cancellable work so teardown drains it before closing the driver. */
export function startOperation(live: LiveEntry, operations = live.inflightOperations): () => void {
  if (live.closing) throw new DbError('cancelled')
  let markComplete = () => {}
  const completed = new Promise<void>((resolve) => {
    markComplete = resolve
  })
  operations.add(completed)
  return () => {
    operations.delete(completed)
    markComplete()
  }
}
