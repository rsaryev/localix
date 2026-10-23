import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'bun:test'
import { RESULT_ROW_CAP } from '../../shared/result-cap'
import { buildMysqlPoolOptions, runMysqlObjectRows } from './mysql'
import {
  runAbortableMysqlStatement,
  runAbortableMysqlTransactionStatement,
  runMysqlStatement,
} from './mysql-statement'

type Executor = Parameters<typeof runMysqlStatement>[0]
type ObjectExecutor = Parameters<typeof runMysqlObjectRows>[0]

/**
 * A mysql2 core Query as the driver sees it: an emitter. `play` emits the given events on the
 * next tick, the way the socket would, so the caller has attached its listeners first.
 */
function fakeQuery(play: (query: EventEmitter) => void = (q) => q.emit('end')): EventEmitter {
  const query = new EventEmitter()
  queueMicrotask(() => play(query))
  return query
}

describe('runMysqlStatement', () => {
  it('uses the binary execute protocol whenever values are bound', async () => {
    const calls: Array<{ method: 'query' | 'execute'; options: unknown }> = []
    const executor = {
      connection: {
        query(options: unknown) {
          calls.push({ method: 'query', options })
          return fakeQuery()
        },
        execute(options: unknown) {
          calls.push({ method: 'execute', options })
          return fakeQuery()
        },
      },
    } as unknown as Executor

    const sql = "SELECT 'literal ?' AS note, ? AS value # comment ?"
    await runMysqlStatement(executor, sql, ['SECRET-TOKEN'])

    expect(calls).toEqual([
      {
        method: 'execute',
        options: { sql, rowsAsArray: true, values: ['SECRET-TOKEN'] },
      },
    ])
  })

  it('keeps parameter-free and administrative SQL on the text protocol', async () => {
    const calls: string[] = []
    const executor = {
      connection: {
        query() {
          calls.push('query')
          return fakeQuery()
        },
        execute() {
          calls.push('execute')
          return fakeQuery()
        },
      },
    } as unknown as Executor

    await runMysqlStatement(executor, 'SHOW TABLES')
    expect(calls).toEqual(['query'])
  })

  it('reports a write by its header, not as a result set', async () => {
    const executor = {
      connection: {
        query: () =>
          fakeQuery((q) => {
            q.emit('fields', undefined)
            q.emit('result', { affectedRows: 3, insertId: 7 })
            q.emit('end')
          }),
      },
    } as unknown as Executor
    expect(await runMysqlStatement(executor, 'DELETE FROM t')).toEqual({
      rows: [],
      header: { affectedRows: 3, insertId: 7 },
      truncated: false,
    })
  })
})

describe('the row cap', () => {
  /** Emits `count` rows (or until the connection is destroyed) and counts what was sent. */
  function rowSource(count: number) {
    const state = { sent: 0, destroyed: false }
    const executor = {
      connection: {
        query: () =>
          fakeQuery((q) => {
            q.emit('fields', [{ name: 'n' }])
            for (let n = 0; n < count && !state.destroyed; n++) {
              state.sent++
              q.emit('result', [n])
            }
            if (state.destroyed) q.emit('error', new Error('socket closed'))
            else q.emit('end')
          }),
      },
      destroy() {
        state.destroyed = true
      },
    } as unknown as Parameters<typeof runAbortableMysqlStatement>[0]
    return { executor, state }
  }

  it('a read stops one row past the cap by destroying its pinned connection', async () => {
    const { executor, state } = rowSource(RESULT_ROW_CAP * 3)
    const collected = await runAbortableMysqlStatement(executor, 'SELECT n FROM big')
    expect(collected.rows).toHaveLength(RESULT_ROW_CAP)
    expect(collected.truncated).toBe(true)
    expect(state).toEqual({ sent: RESULT_ROW_CAP + 1, destroyed: true })
  })

  it('a write that returns rows is drained to its end, never cut off', async () => {
    const { executor, state } = rowSource(RESULT_ROW_CAP + 50)
    const collected = await runAbortableMysqlStatement(executor, 'CALL fill_and_report()')
    expect(collected.rows).toHaveLength(RESULT_ROW_CAP)
    expect(collected.truncated).toBe(true)
    expect(state).toEqual({ sent: RESULT_ROW_CAP + 50, destroyed: false })
  })

  it('a result at the cap is whole', async () => {
    const { executor } = rowSource(RESULT_ROW_CAP)
    const collected = await runAbortableMysqlStatement(executor, 'SELECT n FROM t')
    expect(collected.truncated).toBe(false)
  })
})

describe('runAbortableMysqlStatement', () => {
  it('destroys the pinned connection on abort instead of dispatching a delayed KILL', async () => {
    let fail = (_error: Error) => {}
    const calls: string[] = []
    const executor = {
      connection: {
        query() {
          calls.push('query')
          const query = new EventEmitter()
          fail = (error) => query.emit('error', error)
          return query
        },
        execute() {
          throw new Error('unexpected execute')
        },
      },
      destroy() {
        calls.push('destroy')
        fail(new Error('socket closed'))
      },
    } as unknown as Parameters<typeof runAbortableMysqlStatement>[0]
    const controller = new AbortController()

    const query = runAbortableMysqlStatement(executor, 'SELECT SLEEP(10)', [], controller.signal)
    await Promise.resolve()
    controller.abort(new Error('cancelled'))

    expect(query).rejects.toThrow('socket closed')
    expect(calls).toEqual(['query', 'destroy'])
  })

  it('does not dispatch when the signal is already aborted', async () => {
    const calls: string[] = []
    const executor = {
      connection: {
        query() {
          calls.push('query')
          return fakeQuery()
        },
        execute() {
          calls.push('execute')
          return fakeQuery()
        },
      },
      destroy() {
        calls.push('destroy')
      },
    } as unknown as Parameters<typeof runAbortableMysqlStatement>[0]
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    expect(runAbortableMysqlStatement(executor, 'SELECT 1', [], controller.signal)).rejects.toThrow(
      'cancelled',
    )
    expect(calls).toEqual([])
  })
})

describe('runAbortableMysqlTransactionStatement', () => {
  it('waits for KILL completion before handing the pinned thread back to transaction work', async () => {
    let fail = (_error: Error) => {}
    let finishKill = () => {}
    let settled = false
    const calls: string[] = []
    const executor = {
      connection: {
        query() {
          calls.push('query')
          // Wired synchronously: the abort below lands before any microtask runs.
          const query = new EventEmitter()
          fail = (error) => query.emit('error', error)
          return query
        },
        execute() {
          throw new Error('unexpected execute')
        },
      },
    } as unknown as Executor
    const killQuery = async (threadId: number) => {
      calls.push(`kill:${threadId}`)
      fail(new Error('query interrupted'))
      await new Promise<void>((resolve) => {
        finishKill = resolve
      })
    }
    const controller = new AbortController()

    const query = runAbortableMysqlTransactionStatement(
      executor,
      killQuery,
      41,
      'SELECT SLEEP(10)',
      [],
      controller.signal,
    ).finally(() => {
      settled = true
    })
    controller.abort(new Error('cancelled'))
    await Promise.resolve()
    await Promise.resolve()

    expect(calls).toEqual(['query', 'kill:41'])
    expect(settled).toBe(false)
    finishKill()
    expect(query).rejects.toThrow('query interrupted')
    expect(settled).toBe(true)
  })
})

describe('runMysqlObjectRows', () => {
  it('keeps catalog aliases name-keyed while still binding values through execute', async () => {
    const calls: Array<{ method: 'query' | 'execute'; options: unknown }> = []
    const rows = [{ TABLE_NAME: 'users' }]
    const executor = {
      async query(options: unknown) {
        calls.push({ method: 'query', options })
        return [rows, []]
      },
      async execute(options: unknown) {
        calls.push({ method: 'execute', options })
        return [rows, []]
      },
    } as unknown as ObjectExecutor

    expect(await runMysqlObjectRows(executor, 'SHOW TABLES')).toBe(rows)
    expect(
      await runMysqlObjectRows(executor, 'SELECT * FROM t WHERE schema_name = ?', ['app']),
    ).toBe(rows)
    expect(calls).toEqual([
      { method: 'query', options: { sql: 'SHOW TABLES' } },
      {
        method: 'execute',
        options: { sql: 'SELECT * FROM t WHERE schema_name = ?', values: ['app'] },
      },
    ])
  })
})

describe('buildMysqlPoolOptions', () => {
  it('preserves unsafe BIGINT values in URL and field connection modes', () => {
    expect(buildMysqlPoolOptions({ url: 'mysql://u:p@db.example/app' })).toMatchObject({
      uri: 'mysql://u:p@db.example/app',
      supportBigNumbers: true,
    })
    expect(
      buildMysqlPoolOptions({
        host: 'db.example',
        port: 3306,
        user: 'u',
        password: 'p',
        database: 'app',
      }),
    ).toMatchObject({
      host: 'db.example',
      port: 3306,
      user: 'u',
      password: 'p',
      database: 'app',
      supportBigNumbers: true,
    })
  })

  it('keeps custom TLS material beside a connection URL', () => {
    expect(
      buildMysqlPoolOptions({
        url: 'mysql://u:p@db.example/app',
        ssl: {
          ca: 'CA PEM',
          cert: 'CERT PEM',
          key: 'KEY PEM',
          rejectUnauthorized: false,
        },
      }),
    ).toMatchObject({
      uri: 'mysql://u:p@db.example/app',
      ssl: {
        ca: 'CA PEM',
        cert: 'CERT PEM',
        key: 'KEY PEM',
        rejectUnauthorized: false,
      },
    })
  })
})
