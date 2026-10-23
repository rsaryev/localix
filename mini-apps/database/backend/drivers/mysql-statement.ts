/**
 * How one USER statement runs on a pinned MySQL connection: which protocol carries it, how
 * abort reaches it, and when the row cap may end it early.
 *
 * Split from the driver because these three are one decision — "what may stop this statement"
 * — and each answer depends on the others: abort destroys a standalone connection but KILLs a
 * transaction's thread, and the row cap may stop only where abort would (`mysql-rows.ts`).
 */
import type mysql from 'mysql2/promise'
import { isReadOnlyStatementForDialect } from '../read-only/sql'
import { streamMysqlRows, type MysqlCollected, type MysqlStreamingConnection } from './mysql-rows'

/** A pinned connection a user statement streams through (its callback core, see mysql-rows). */
type MysqlStatementExecutor = { connection: MysqlStreamingConnection }

/**
 * A promise PoolConnection seen through its streaming callback core. mysql2's promise wrapper
 * exposes that core as `.connection` at runtime; its typings describe it as the callback
 * Connection, whose overloads the structural {@link MysqlStreamingConnection} narrows.
 */
export type StreamingPoolConnection = MysqlStatementExecutor & Pick<mysql.PoolConnection, 'destroy'>

/**
 * Keep bound values on MySQL's binary prepared-statement protocol.
 *
 * `connection.query({ values })` is a text-protocol convenience: mysql2 formats values
 * into the SQL before sending it. Besides exposing data in statement text/logs, that
 * formatter and the server do not agree on every dialect region (notably `#` comments and
 * executable MySQL version comments). `execute()` lets the server own placeholder parsing and
 * sends values separately. Parameter-free statements stay on `query()` because some
 * administrative SQL cannot be prepared and has nothing to bind.
 *
 * Rows STREAM through the connection's callback core and are capped as they arrive
 * (`mysql-rows.ts`); `stop` is how a caller that may end the read early does so.
 */
export function runMysqlStatement(
  executor: MysqlStatementExecutor,
  text: string,
  params: unknown[] = [],
  stop?: () => void,
): Promise<MysqlCollected> {
  return streamMysqlRows(executor.connection, text, params, stop)
}

/**
 * Cancel a standalone MySQL query by destroying its pinned pooled connection.
 *
 * A delayed cross-connection `KILL QUERY <threadId>` can race with release and cancel a
 * later request after the server reuses that id. PoolConnection.destroy() first removes
 * this exact connection from mysql2's pool, so its server thread cannot be handed off.
 */
export async function runAbortableMysqlStatement(
  executor: StreamingPoolConnection,
  text: string,
  params: unknown[] = [],
  signal?: AbortSignal,
): Promise<MysqlCollected> {
  signal?.throwIfAborted()
  const onAbort = () => executor.destroy()
  signal?.addEventListener('abort', onAbort, { once: true })
  // Past the row cap a standalone READ ends the way abort does — destroying this pinned
  // connection. A write is never cut off part-way; it drains to its end.
  const stop = isReadOnlyStatementForDialect(text, 'mysql') ? () => executor.destroy() : undefined
  try {
    return await runMysqlStatement(executor, text, params, stop)
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Interrupt one statement without releasing its manual-transaction connection.
 *
 * The caller serializes transaction work. Awaiting the control query in `finally` keeps
 * that invariant across cancellation: the same server thread cannot start the next
 * statement while a delayed KILL for the previous one is still in flight. The row cap never
 * stops a transaction's statement — destroying its connection would end the transaction.
 */
export async function runAbortableMysqlTransactionStatement(
  executor: MysqlStatementExecutor,
  killQuery: (threadId: number) => Promise<unknown>,
  threadId: number,
  text: string,
  params: unknown[] = [],
  signal?: AbortSignal,
): Promise<MysqlCollected> {
  signal?.throwIfAborted()
  let cancellation: Promise<unknown> | undefined
  const onAbort = () => {
    cancellation ??= killQuery(threadId).catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await runMysqlStatement(executor, text, params)
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await cancellation
  }
}
