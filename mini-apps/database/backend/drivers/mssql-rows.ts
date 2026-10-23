/**
 * Run one SQL Server request holding at most `RESULT_ROW_CAP`+1 rows.
 *
 * `await request.query()` accumulates every row of every recordset before it resolves. In
 * stream mode the same Request emits `recordset` (the column list), one `row` per row,
 * `rowsaffected`, `error` and `done` instead, and keeps nothing — so rows past the cap are
 * dropped as they arrive and memory is bounded whatever the statement returns.
 *
 * Only the FIRST recordset's rows are kept, as `result.recordset` always gave the console.
 *
 * `mayStop` lets a standalone read end early with `request.cancel()` — the attention packet
 * abort already sends. A write, or anything inside a transaction, is drained instead: an
 * attention aborts the running statement, and a cut-off `INSERT … OUTPUT` would roll back rows
 * the user was about to be told were written.
 */
import { createRowCollector } from '../../shared/result-cap'

/** The event surface of an mssql Request in stream mode (structural, for tests). */
export interface MssqlStreamingRequest {
  stream: boolean
  on(event: 'recordset', fn: (columns: Array<{ name: string }>) => void): unknown
  on(event: 'row', fn: (row: unknown[]) => void): unknown
  on(event: 'rowsaffected', fn: (count: number) => void): unknown
  on(event: 'error', fn: (error: unknown) => void): unknown
  on(event: 'done', fn: () => void): unknown
  query(command: string): unknown
  cancel(): unknown
}

export interface MssqlCollected {
  /** The first recordset's columns; absent when the batch returned no recordset. */
  columns?: Array<{ name: string }>
  rows: unknown[][]
  rowsAffected: number
  truncated: boolean
}

export function streamMssqlRows(
  request: MssqlStreamingRequest,
  command: string,
  mayStop: boolean,
): Promise<MssqlCollected> {
  return new Promise((resolve, reject) => {
    const collector = createRowCollector()
    let columns: Array<{ name: string }> | undefined
    let recordsets = 0
    let rowsAffected = 0
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve({
        ...(columns ? { columns } : {}),
        rows: collector.rows,
        rowsAffected,
        truncated: collector.truncated,
      })
    }
    request.stream = true
    request.on('recordset', (recordsetColumns) => {
      recordsets++
      if (recordsets === 1) columns = recordsetColumns
    })
    request.on('row', (row) => {
      if (settled || recordsets !== 1) return
      if (collector.push(row) && mayStop) {
        // Resolve FIRST: the cancel makes the request emit an error that is not one.
        finish()
        request.cancel()
      }
    })
    request.on('rowsaffected', (count) => {
      rowsAffected += count
    })
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    request.on('done', finish)
    request.query(command)
  })
}
