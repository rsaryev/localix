import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { DbResultSet } from '../dbClient'
import { databaseApi } from '../api/databaseApi'
import type { SqlConsoleState } from './useSqlConsole'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('SQL console connection scope', () => {
  test('cancels and rejects a late result when a SQL file switches connections', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useSqlConsole } = await import('./useSqlConsole')
    const originalQuery = databaseApi.query.bind(databaseApi)
    const originalCancel = databaseApi.cancel.bind(databaseApi)
    const oldResult = deferred<DbResultSet>()
    const newResult = deferred<DbResultSet>()
    const cancelled: string[] = []
    databaseApi.query = (connectionId) =>
      connectionId === 'old' ? oldResult.promise : newResult.promise
    databaseApi.cancel = async (connectionId) => {
      cancelled.push(connectionId)
      return 1
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let state: SqlConsoleState | null = null

    function Harness({ connectionId }: { connectionId: string }) {
      const latest = useSqlConsole(connectionId, { dialect: 'sqlite', dbLabel: connectionId })
      React.useEffect(() => {
        state = latest
      })
      return null
    }

    try {
      await act(async () => root.render(<Harness connectionId="old" />))
      let oldRun!: Promise<boolean>
      await act(async () => {
        oldRun = state!.runSql('SELECT old')
        await Promise.resolve()
      })

      await act(async () => root.render(<Harness connectionId="new" />))
      expect(cancelled).toEqual(['old'])
      expect(state!.running).toBe(false)
      expect(state!.outcome).toBeNull()

      let newRun!: Promise<boolean>
      await act(async () => {
        newRun = state!.runSql('SELECT new')
        await Promise.resolve()
        newResult.resolve({
          columns: [{ name: 'value' }],
          rows: [['new']],
          durationMs: 1,
        })
        await newRun
      })
      expect(state!.sortedRows).toEqual([{ value: 'new' }])

      await act(async () => {
        oldResult.resolve({
          columns: [{ name: 'value' }],
          rows: [['old']],
          durationMs: 2,
        })
        await oldRun
      })
      expect(await oldRun).toBe(false)
      expect(state!.sortedRows).toEqual([{ value: 'new' }])
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.query = originalQuery
      databaseApi.cancel = originalCancel
    }
  })
})

describe('SQL console last failure', () => {
  test('keeps the failed statement and the ENGINE text, and the next run clears it', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useSqlConsole } = await import('./useSqlConsole')
    const { DbApiError } = await import('../api/databaseApi')
    const originalQuery = databaseApi.query.bind(databaseApi)
    let fail = true
    databaseApi.query = async () => {
      if (fail) {
        throw new DbApiError('The query failed.', 'query_failed', 'no such table: usres')
      }
      return { columns: [{ name: 'n' }], rows: [[1]], durationMs: 1 }
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let state: SqlConsoleState | null = null
    function Harness() {
      // A connection id no other test uses: `transactionStore` is module-global, and another
      // file in the same `bun test` process that leaves `c1` in manual mode makes this run open a
      // real transaction (a network call) before the statement, so the failure never records.
      const latest = useSqlConsole('last-failure-conn', {
        dialect: 'sqlite',
        dbLabel: 'last-failure',
      })
      React.useEffect(() => {
        state = latest
      })
      return null
    }
    try {
      await act(async () => root.render(<Harness />))
      await act(async () => {
        await state!.runSql('  SELECT * FROM usres  ')
      })
      // The friendly sentence names nothing; the editor needs the engine's words.
      expect(state!.lastFailure).toEqual({
        sql: 'SELECT * FROM usres',
        message: 'no such table: usres',
      })
      fail = false
      await act(async () => {
        await state!.runSql('SELECT 1')
      })
      expect(state!.lastFailure).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.query = originalQuery
    }
  })
})
