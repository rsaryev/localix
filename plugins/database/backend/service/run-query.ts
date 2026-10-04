/**
 * Query-execution paths over one live entry: the `query` run (read-only guard, timeout,
 * external-cancel chaining, abort-wins semantics — for one statement or, via
 * `run-script.ts`, a multi-statement text) and the atomic batch.
 * Stateless — the caller supplies the {@link LiveEntry}.
 */
import type { BatchResponse, BrowseResponse, QueryResponse } from '../contracts'
import { DbError, mapDbError, statementFailureOf, withStatementFailure } from '../errors'
import { runScript, scriptStatements } from './run-script'
import { runWithTransaction, startOperation, waitForTransactionTransition } from './tx-routing'
import { isReadOnlyInput } from '../read-only'
import type { BatchStatement, DbBrowseRequest } from '../drivers/port'
import { buildSqlBrowseQuery } from '../drivers/sql-browse'
import type { LiveEntry } from './live-entry'
import { recordRecentQuery } from '../recent-query-context'

/** Default per-query wall-clock cap. A query exceeding it is cancelled with a `timeout`. */
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000

/** Options for a single query run. */
export interface QueryOptions {
  /** Wall-clock cap in ms. `0` (or negative) disables the timeout. Defaults to {@link DEFAULT_QUERY_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Caller-provided signal; aborting it cancels the query (mapped to a `cancelled` error). */
  signal?: AbortSignal
}

/**
 * Run an introspection read without letting teardown close the driver underneath it.
 * Metadata uses the ordinary driver, so closeLive drains it only after releasing a pinned
 * manual transaction that may be holding the driver's sole connection.
 */
export async function runMetadata<T>(live: LiveEntry, read: () => Promise<T>): Promise<T> {
  const finish = startOperation(live, live.inflightMetadata)
  try {
    await waitForTransactionTransition(live)
    if (live.closing) throw new DbError('cancelled')
    return await read()
  } catch (err) {
    throw mapDbError(err)
  } finally {
    finish()
  }
}

/**
 * The one cancellable path: a wall-clock cap, an external signal chained in, registration in
 * `live.inflight` (so Stop aborts it and teardown aborts-then-awaits it), and abort-wins
 * semantics. Browse used to bypass all of it — a slow grid page held PostgreSQL's single
 * connection with no timeout, Stop did nothing to it, and disconnect waited until it finished.
 */
async function runCancellable<T>(
  live: LiveEntry,
  opts: QueryOptions | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false

  // Chain a caller-provided signal so an external cancel also aborts this run.
  const external = opts?.signal
  const onExternalAbort = () => controller.abort(external?.reason)
  if (external) {
    if (external.aborted) controller.abort(external.reason)
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort(new DbError('timeout'))
        }, timeoutMs)
      : undefined

  let markComplete = () => {}
  const completed = new Promise<void>((resolve) => {
    markComplete = resolve
  })
  live.inflight.set(controller, completed)
  try {
    const result = await work(controller.signal)
    // Guard against a driver that RESOLVES a query we asked to abort: some engines
    // don't reject on interrupt (e.g. MySQL `KILL QUERY` makes `SLEEP()` return 1
    // instead of erroring; or the statement finishes in the abort race window). In
    // that case the timeout/cancel must still win — returning the (possibly partial)
    // result would silently ignore the user's Stop / the wall-clock cap. Agnostic:
    // every dialect + caller (console route, the `database_client` tool's query) lands here.
    if (timedOut) throw new DbError('timeout')
    if (controller.signal.aborted) throw new DbError('cancelled')
    return result
  } catch (err) {
    // A script's timeout/cancel still says which statement it stopped at.
    const failure = statementFailureOf(err)
    const located = (e: DbError) => (failure ? withStatementFailure(e, failure) : e)
    if (timedOut) throw located(new DbError('timeout', undefined, { cause: err }))
    // Aborted for any non-timeout reason (explicit cancel or external signal).
    if (controller.signal.aborted) {
      throw located(new DbError('cancelled', undefined, { cause: err }))
    }
    throw mapDbError(err)
  } finally {
    if (timer) clearTimeout(timer)
    if (external) external.removeEventListener('abort', onExternalAbort)
    live.inflight.delete(controller)
    markComplete()
  }
}

export async function runQuery(
  live: LiveEntry,
  sql: string,
  params?: unknown[],
  opts?: QueryOptions,
): Promise<QueryResponse> {
  // Read-only guard-rail (primary enforcement point): on a connection the user marked
  // read-only, reject any input that is not a pure read BEFORE it reaches the driver.
  // This single check covers every ENGINE (each family's classifier speaks its own
  // language — see `../read-only`) AND every caller of the query path: the console
  // `query` route and the `database_client` tool's query both land here.
  if (live.readonly && !isReadOnlyInput(live.flags.kind, sql)) {
    throw new DbError('readonly_blocked')
  }
  const script = scriptStatements(live, sql)
  if (script) {
    // Which statement owns which value cannot be decided without guessing.
    if (params?.length) throw new DbError('script_params')
    const outcome = await runCancellable(live, opts, (signal) =>
      runWithTransaction(
        live,
        (tx) => runScript(script, (text, p, s) => tx.query(text, p, s), signal),
        () => {
          const driver = live.driver
          if (driver.session) return driver.session((run) => runScript(script, run, signal), signal)
          return runScript(script, (text, p, s) => driver.query(text, p, s), signal)
        },
        signal,
      ),
    )
    for (const statement of script) {
      live.recentQueries = recordRecentQuery(live.recentQueries, statement.text, live.flags.kind)
    }
    return outcome
  }
  // A query that arrives during Begin must wait for that same pinned transaction instead
  // of escaping through auto-commit. Then route through the open manual transaction when
  // one exists; otherwise use the driver's normal path. All guards apply to both.
  const result = await runCancellable(live, opts, (signal) =>
    runWithTransaction(
      live,
      (tx) => tx.query(sql, params, signal),
      () => live.driver.query(sql, params, signal),
      signal,
    ),
  )
  live.recentQueries = recordRecentQuery(live.recentQueries, sql, live.flags.kind)
  return { result }
}

export async function runBatch(
  live: LiveEntry,
  statements: BatchStatement[],
): Promise<BatchResponse> {
  // Read-only guard-rail (same as `query`, per statement): a batch is writes, so on a
  // read-only connection reject before touching the driver.
  if (live.readonly) {
    for (const statement of statements) {
      if (!isReadOnlyInput(live.flags.kind, statement.sql)) throw new DbError('readonly_blocked')
    }
  }
  const finish = startOperation(live)
  try {
    // Same Begin race as runQuery: an immediately-following grid commit belongs to the
    // transaction being opened, never to a separate driver transaction/auto-commit path.
    // A manual transaction already owns the connection. Starting the driver's separate
    // batch transaction here would either nest BEGIN (SQLite/DuckDB) or wait forever for
    // the only pooled connection (PostgreSQL max:1). Keep every statement inside the
    // existing transaction; the user's later Commit/Rollback remains authoritative.
    return await runWithTransaction(
      live,
      async (tx) => {
        const results = []
        for (const statement of statements) {
          results.push(await tx.query(statement.sql, statement.params))
        }
        return { results }
      },
      async () => {
        if (live.driver.transaction) {
          const results = await live.driver.transaction(statements)
          return { results }
        }
        // The public batch contract is all-or-nothing. Executing sequentially here would
        // let an early mutation persist when a later statement fails.
        throw new DbError('tx_unsupported')
      },
    )
  } catch (err) {
    throw mapDbError(err)
  } finally {
    finish()
  }
}

/**
 * Structured table browsing follows the same pinned connection as console SQL. Besides
 * making uncommitted rows visible, this avoids waiting forever on PostgreSQL's max:1 pool
 * and on the exclusive SQLite/DuckDB connection lease while a manual transaction is open.
 * A browse is a read, so it is safe to cancel and takes the query's timeout/Stop path.
 */
export async function runBrowse(
  live: LiveEntry,
  request: DbBrowseRequest,
  opts?: QueryOptions,
): Promise<BrowseResponse> {
  const result = await runCancellable(live, opts, (signal) =>
    runWithTransaction(
      live,
      (tx) => tx.query(buildSqlBrowseQuery(live.flags.dialect, request), undefined, signal),
      () => live.driver.browse(request, signal),
      signal,
    ),
  )
  return { result }
}
