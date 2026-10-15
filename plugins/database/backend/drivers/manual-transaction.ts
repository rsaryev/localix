import type { DbStatementRunner, DbTransaction } from './port'

export interface ManualTransactionSession {
  /** Runs one statement on the pinned session. */
  query: DbStatementRunner
  commit(): Promise<void> | void
  rollback(): Promise<void> | void
  /** Return the pinned session to its pool or lock; called exactly once, after either end. */
  release?(): void
}

/**
 * The one lifecycle every SQL driver's "Tx: Manual" handle shares: `commit`/`rollback` are
 * idempotent, a failed COMMIT is followed by a best-effort ROLLBACK and still rethrows, a ROLLBACK
 * never throws, and the pinned session is released exactly once whichever way it ends.
 */
export function makeManualTransaction(session: ManualTransactionSession): DbTransaction {
  let done = false
  const rollbackQuietly = async () => {
    try {
      await session.rollback()
    } catch {
      // Best effort: the engine aborts the transaction itself when the session goes away.
    }
  }
  return {
    query: session.query,
    async commit() {
      if (done) return
      done = true
      try {
        await session.commit()
      } catch (err) {
        await rollbackQuietly()
        throw err
      } finally {
        session.release?.()
      }
    },
    async rollback() {
      if (done) return
      done = true
      try {
        await rollbackQuietly()
      } finally {
        session.release?.()
      }
    },
  }
}
