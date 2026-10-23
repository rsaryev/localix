/**
 * Run one MySQL statement holding at most `RESULT_ROW_CAP`+1 rows.
 *
 * The promise API (`conn.query()` / `conn.execute()`) resolves with every row in one array, so a
 * `SELECT *` on a large table was materialized whole in the API process. The callback connection
 * underneath it streams: without a callback, `query`/`execute` return an emitter of `fields`,
 * one `result` per row (or the ResultSetHeader of a write), `end` and `error`.
 *
 * Rows past the cap are dropped as they arrive, so memory is bounded either way. Whether reading
 * may STOP is the caller's decision (`stop`), because the only way to stop mysql2 mid-result is
 * to destroy the connection: that is right for a standalone read (the same move abort already
 * makes) and wrong inside a transaction or for a write, which therefore drain to the end.
 *
 * Parameterized statements keep the binary prepared protocol (`execute`), parameter-free ones
 * the text protocol (`query`) — the same split, for the same reason, as `runMysqlStatement`.
 */
import { createRowCollector } from '../../shared/result-cap'

type Listener = (...args: never[]) => void

/** The event surface of a mysql2 core Query / Execute (structural, for tests). */
export interface MysqlRowEmitter {
  on(event: 'fields', fn: (fields: Array<{ name: string }>) => void): MysqlRowEmitter
  on(event: 'result', fn: (row: unknown) => void): MysqlRowEmitter
  on(event: 'end', fn: () => void): MysqlRowEmitter
  on(event: 'error', fn: (error: unknown) => void): MysqlRowEmitter
  on(event: string, fn: Listener): MysqlRowEmitter
}

export interface MysqlStreamingConnection {
  query(options: { sql: string; rowsAsArray: true }): MysqlRowEmitter
  execute(options: { sql: string; rowsAsArray: true; values: unknown[] }): MysqlRowEmitter
}

export interface MysqlCollected {
  /** Column packets when the statement returned rows; absent for a write. */
  fields?: Array<{ name: string }>
  rows: unknown[][]
  /** The write's header (`affectedRows`, `insertId`) when there were no fields. */
  header?: { affectedRows?: number; insertId?: number | string }
  truncated: boolean
}

export function streamMysqlRows(
  connection: MysqlStreamingConnection,
  text: string,
  params: unknown[],
  stop?: () => void,
): Promise<MysqlCollected> {
  return new Promise((resolve, reject) => {
    const collector = createRowCollector()
    let fields: Array<{ name: string }> | undefined
    let header: MysqlCollected['header']
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve({
        ...(fields ? { fields } : {}),
        rows: collector.rows,
        ...(header ? { header } : {}),
        truncated: collector.truncated,
      })
    }
    const emitter =
      params.length === 0
        ? connection.query({ sql: text, rowsAsArray: true })
        : connection.execute({ sql: text, rowsAsArray: true, values: params })
    emitter
      .on('fields', (packets) => {
        fields ??= packets
      })
      .on('result', (row) => {
        if (settled) return
        if (!fields) {
          header = row as MysqlCollected['header']
          return
        }
        if (collector.push(row as unknown[]) && stop) {
          // Resolve FIRST: destroying the connection makes it emit an error that is not one.
          finish()
          stop()
        }
      })
      .on('end', finish)
      .on('error', (error) => {
        if (settled) return
        settled = true
        reject(error)
      })
  })
}
