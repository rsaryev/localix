/**
 * Read a postgres.js `.values()` query holding at most `RESULT_ROW_CAP`+1 rows.
 *
 * Awaiting the query builds every row into one array — a `SELECT *` on a large table landed in
 * the API process whole. postgres.js has two ways not to:
 *
 *  - `.cursor(n, fn)` runs a row-limited Execute, so the SERVER stops after n rows and the portal
 *    is closed. It needs the extended protocol, which takes one statement, so it is used for a
 *    single statement that only reads — closing a portal mid-way changes nothing about a read;
 *  - `.forEach(fn)` hands rows over one at a time without keeping them. Everything else (a
 *    script, a write with `RETURNING`) runs to its end this way and only the first rows are kept:
 *    a write is never stopped part-way, and a transaction is never broken by a cancel.
 *
 * Both shapes answer what `shapePgValuesResult` needs: the awaited value (its `columns` and
 * `count`), with the collected rows beside it.
 */
import { createRowCollector, RESULT_ROW_CAP } from '../../shared/result-cap'

type PgColumns = Array<{ name: string }> | undefined

/** The slice of a postgres.js pending query this reads through (structural, for tests). */
export interface PgRowSource {
  cursor(
    rows: number,
    fn: (batch: unknown[][] & { columns?: PgColumns }) => unknown,
  ): PromiseLike<unknown>
  forEach(fn: (row: unknown[], result: unknown) => void): PromiseLike<unknown>
}

export interface PgCollected {
  /** The awaited result — `columns`/`count` as postgres.js reports them. */
  result: unknown
  rows: unknown[][]
  truncated: boolean
}

export async function collectPgRows(
  source: PgRowSource,
  mayUseCursor: boolean,
  close: unknown,
): Promise<PgCollected> {
  const collector = createRowCollector()
  if (mayUseCursor) {
    let columns: PgColumns
    const result = await source.cursor(RESULT_ROW_CAP + 1, (batch) => {
      columns ??= batch.columns
      for (const row of batch) collector.push(row)
      return collector.truncated ? close : undefined
    })
    // A later batch is a fresh result without columns; the first batch (or, for zero rows, the
    // awaited result itself) carried them.
    const withColumns = Object.assign(result as object, {
      columns: (result as { columns?: PgColumns }).columns ?? columns,
    })
    return { result: withColumns, rows: collector.rows, truncated: collector.truncated }
  }
  let first: unknown
  const result = await source.forEach((row, owner) => {
    // A script yields several results; the console shows the first, as it always has.
    first ??= owner
    if (owner === first) collector.push(row)
  })
  return { result, rows: collector.rows, truncated: collector.truncated }
}
