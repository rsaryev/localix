/**
 * Each engine's compile-check answer, mapped without a live server: the error shapes below are
 * the ones measured against PostgreSQL 17, MySQL 8.0, SQL Server 2022 and ClickHouse 26.7.
 */
import { describe, expect, it } from 'bun:test'
import {
  CLICKHOUSE_EXPLAIN_PREFIX,
  clickHouseExplainText,
  clickHouseValidationFromError,
} from './clickhouse-validate'
import { createExclusiveQueue } from './exclusive-queue'
import { isStandaloneMssqlDdl, mssqlDescribeText, mssqlValidationFromRows } from './mssql-validate'
import { enforceReadOnlySessions } from './mysql'
import { compileMysqlStatement, mysqlValidationFromError } from './mysql-validate'
import { compilePgStatement, pgValidationFromError } from './postgres-validate'
import { sqliteValidationFromError } from './sqlite-validate'
import { boundedValidation, utf16OffsetFromCodePoints, utf16OffsetFromUtf8 } from './validation'

describe('offset units', () => {
  it('maps UTF-8 bytes and code points onto UTF-16 offsets', () => {
    const text = 'é🙂x'
    expect(utf16OffsetFromUtf8(text, 2)).toBe(1) // after é (2 bytes)
    expect(utf16OffsetFromUtf8(text, 6)).toBe(3) // after 🙂 (4 bytes, 2 units)
    expect(utf16OffsetFromCodePoints(text, 2)).toBe(3)
    expect(utf16OffsetFromCodePoints(text, 9)).toBeUndefined()
  })
})

describe('boundedValidation', () => {
  it('answers busy when the engine is slower than the bound, never an error', async () => {
    const verdict = await boundedValidation(() => new Promise(() => {}), undefined, 10)
    expect(verdict).toEqual({ ok: true, skipped: 'busy' })
  })
})

describe('exclusive queue tryRun', () => {
  it('runs only while the connection is idle', async () => {
    const queue = createExclusiveQueue()
    expect(await queue.tryRun(() => 1)).toBe(1)
    const release = await queue.acquire()
    expect(await queue.tryRun(() => 2)).toBeUndefined()
    release()
    expect(await queue.tryRun(() => 3)).toBe(3)
  })
})

describe('postgres', () => {
  const server = (code: string, position?: string) =>
    Object.assign(new Error('boom'), { code, severity: 'ERROR', position })

  it('turns the 1-based character position into a UTF-16 offset', () => {
    const sql = "SELECT '🙂', nope FROM u"
    expect(pgValidationFromError(sql, server('42703', '13'))).toEqual({
      ok: false,
      message: 'boom',
      code: '42703',
      offset: sql.indexOf('nope'),
      semantic: true,
    })
    expect(pgValidationFromError('SELEC 1', server('42601', '1'))).toMatchObject({
      offset: 0,
      code: '42601',
    })
    expect(pgValidationFromError('SELEC 1', server('42601', '1'))).not.toHaveProperty('semantic')
  })

  it('gives no verdict for a failure that is not the server judging the SQL', () => {
    expect(pgValidationFromError('SELECT 1', new Error('connect ECONNREFUSED'))).toBeNull()
  })

  it('describes (never executes) and cancels on abort', async () => {
    let cancelled = false
    const sent: string[] = []
    const client = {
      unsafe(text: string) {
        sent.push(text)
        return {
          describe() {
            return Object.assign(new Promise<never>(() => {}), {
              cancel: () => {
                cancelled = true
              },
            })
          },
        }
      },
    }
    const controller = new AbortController()
    void compilePgStatement(client, 'SELECT 1', controller.signal)
    controller.abort()
    expect(sent).toEqual(['SELECT 1'])
    expect(cancelled).toBe(true)
  })
})

describe('mysql', () => {
  const server = (errno: number, code: string, message: string) =>
    Object.assign(new Error(message), { errno, code, sqlState: '42000' })

  it('locates a parse error from the echoed rest of the text', () => {
    const sql = 'SELECT 1,\n  SELEC 2'
    const err = server(1064, 'ER_PARSE_ERROR', "…to use near 'SELEC 2' at line 2")
    expect(mysqlValidationFromError(sql, err)).toMatchObject({
      ok: false,
      code: 'ER_PARSE_ERROR',
      offset: sql.indexOf('SELEC 2'),
    })
  })

  it('treats a statement outside the prepared protocol as no verdict', () => {
    const err = server(1295, 'ER_UNSUPPORTED_PS', 'not supported')
    expect(mysqlValidationFromError('BEGIN', err)).toEqual({ ok: true, skipped: 'unsupported' })
  })

  it('marks a name failure semantic', () => {
    const err = server(1146, 'ER_NO_SUCH_TABLE', "Table 'x.nope' doesn't exist")
    expect(mysqlValidationFromError('SELECT * FROM nope', err)).toMatchObject({ semantic: true })
  })

  it('evicts the prepared statement through unprepare, never a bare close', async () => {
    const calls: string[] = []
    const verdict = await compileMysqlStatement(
      {
        async prepare(sql) {
          calls.push(`prepare ${sql}`)
        },
        unprepare(sql) {
          calls.push(`unprepare ${sql}`)
        },
      },
      'SELECT ?',
    )
    expect(verdict).toEqual({ ok: true })
    expect(calls).toEqual(['prepare SELECT ?', 'unprepare SELECT ?'])
  })

  it('makes every pooled session read-only, not only the first', () => {
    let listener:
      | ((c: { query(sql: string, cb: (e: unknown) => void): unknown }) => void)
      | undefined
    enforceReadOnlySessions({
      on: (_event, fn) => {
        listener = fn
      },
    })
    const sent: string[] = []
    const session = { query: (sql: string) => sent.push(sql) }
    listener!(session)
    listener!(session)
    expect(sent).toEqual(['SET SESSION TRANSACTION READ ONLY', 'SET SESSION TRANSACTION READ ONLY'])
  })
})

describe('mssql', () => {
  it('skips the analyzer summary rows and classifies the real error', () => {
    expect(
      mssqlValidationFromRows([
        { error_number: 102, error_message: "Incorrect syntax near 'WHERE'." },
        { error_number: 11501, error_message: 'The batch could not be analyzed…' },
      ]),
    ).toEqual({ ok: false, message: "Incorrect syntax near 'WHERE'.", code: '102' })
    expect(
      mssqlValidationFromRows([{ error_number: 208, error_message: "Invalid object name 'x'." }]),
    ).toMatchObject({ semantic: true, code: '208' })
    expect(mssqlValidationFromRows([])).toEqual({ ok: true })
  })

  it('recognizes batches the analyzer cannot wrap, and binds ? like the driver', () => {
    expect(isStandaloneMssqlDdl('CREATE OR ALTER PROCEDURE p AS SELECT 1')).toBe(true)
    expect(isStandaloneMssqlDdl('-- c\nCREATE VIEW v AS SELECT 1')).toBe(true)
    expect(isStandaloneMssqlDdl('CREATE TABLE t(a int)')).toBe(false)
    expect(mssqlDescribeText("SELECT ? WHERE n = 'why?'")).toBe(
      "SELECT @__localix_p0 WHERE n = 'why?'",
    )
  })
})

describe('clickhouse', () => {
  const syntax = (position: number) =>
    Object.assign(new Error(`Syntax error: failed at position ${position} (x): …`), { code: '62' })

  it('subtracts the EXPLAIN prefix from the 1-based byte position', () => {
    const sql = "SELECT 'é', 1 +"
    const prefix = Buffer.byteLength(CLICKHOUSE_EXPLAIN_PREFIX)
    // ClickHouse reported "end of query" at byte position 29 for this exact text.
    expect(prefix + Buffer.byteLength(sql) + 1).toBe(29)
    expect(clickHouseValidationFromError(sql, syntax(29))).toMatchObject({
      ok: false,
      offset: sql.length,
    })
  })

  it('reads any code other than SYNTAX_ERROR as a statement that parsed', () => {
    const unsetParam = Object.assign(new Error('Substitution `x` is not set.'), { code: '456' })
    expect(clickHouseValidationFromError('SELECT {x:Int64}', unsetParam)).toEqual({ ok: true })
  })

  it('rewrites portable ? placeholders so they are not a syntax error', () => {
    expect(clickHouseExplainText("SELECT ? , '?'")).toBe("EXPLAIN AST SELECT {p0:String} , '?'")
  })
})

describe('sqlite', () => {
  it('treats parser messages as syntax and everything else as semantic', () => {
    const syntax = Object.assign(new Error('near "SELEC": syntax error'), {
      byteOffset: 0,
      errno: 1,
    })
    expect(sqliteValidationFromError('SELEC 1', syntax)).toEqual({
      ok: false,
      message: 'near "SELEC": syntax error',
      offset: 0,
      code: '1',
    })
    const unknown = Object.assign(new Error('no such table: nope'), { byteOffset: -1, errno: 1 })
    expect(sqliteValidationFromError('SELECT * FROM nope', unknown)).toMatchObject({
      semantic: true,
    })
    expect(sqliteValidationFromError('SELECT * FROM nope', unknown)).not.toHaveProperty('offset')
  })
})
