import { sql, type Kysely } from 'kysely'

import { backoffMs } from '@localixai/agent/backoff'
import type { AppDatabase } from './types'

/** 5ms, then 10ms: lock contention between local writers clears in milliseconds. */
const SQLITE_BUSY_BACKOFF = { baseMs: 5, maxMs: 20 }

/** Tables whose globally unique canonical id is derived from a numeric `seq`. */
type RefSeqTable = 'agent_sessions' | 'projects'

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return true
  const message = (error as { message?: unknown }).message
  return (
    typeof message === 'string' &&
    (message.includes('SQLITE_BUSY') ||
      message.includes('SQLITE_LOCKED') ||
      message.includes('database is locked'))
  )
}

/** Retry a complete SQLite write transaction after transient lock/snapshot contention. */
export async function retrySqliteBusy<T>(operation: () => Promise<T>): Promise<T> {
  const attempts = 3
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt + 1 >= attempts || !isSqliteBusy(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt, SQLITE_BUSY_BACKOFF)))
    }
  }
}

/** Reserve while the caller already owns a write transaction. */
export async function nextRefSeqInTransaction(
  db: Kysely<AppDatabase>,
  table: RefSeqTable,
): Promise<number> {
  const updated = await db
    .updateTable('ref_sequence_counters')
    .set({ last_value: sql<number>`last_value + 1` })
    .where('scope', '=', table)
    .executeTakeFirst()
  if (Number(updated.numUpdatedRows) !== 1) {
    throw new Error(`Missing ref sequence counter for ${table}; database migration is incomplete`)
  }
  const row = await db
    .selectFrom('ref_sequence_counters')
    .select('last_value')
    .where('scope', '=', table)
    .executeTakeFirstOrThrow()
  const seq = Number(row.last_value)
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error(`Failed to allocate a valid ${table} sequence`)
  }
  return seq
}

/**
 * Atomically reserve the next global sequence for a canonical ref-bearing table.
 * The write transaction owns both the counter increment and its returned value.
 */
export async function nextRefSeq(db: Kysely<AppDatabase>, table: RefSeqTable): Promise<number> {
  return retrySqliteBusy(() =>
    db.transaction().execute((transaction) => nextRefSeqInTransaction(transaction, table)),
  )
}
