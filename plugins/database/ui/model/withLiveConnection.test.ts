import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { DbConnectionInfo } from '../dbClient'
import { databaseApi, DbApiError } from '../api/databaseApi'
import {
  getConnectionsSnapshot,
  resetConnectionsStore,
  updateConnections,
} from './connectionsStore'
import { transactionStore } from './sql-console/transactionStore'
import { TRANSACTION_LOST_MESSAGE, withLiveConnection } from './withLiveConnection'

const row = (id: string, extra: Partial<DbConnectionInfo> = {}): DbConnectionInfo => ({
  id,
  name: id,
  dialect: 'sqlite',
  connected: true,
  readonly: false,
  createdAt: 1,
  ...extra,
})
const gone = () =>
  new DbApiError('That database connection is no longer available.', 'connection_not_found')

const originalReconnect = databaseApi.reconnect.bind(databaseApi)
let reconnects = 0
beforeEach(() => {
  resetConnectionsStore()
  reconnects = 0
  databaseApi.reconnect = async (id) => {
    reconnects += 1
    return row(id)
  }
})
afterEach(() => {
  databaseApi.reconnect = originalReconnect
})

/** A request that fails `failures` times with `error`, then answers. */
function flaky(failures: number, error: () => Error = gone) {
  const calls = { count: 0 }
  const request = async () => {
    calls.count += 1
    if (calls.count <= failures) throw error()
    return 'rows'
  }
  return { calls, request }
}

describe('withLiveConnection — a backend restart is one reconnect away, not a dead end', () => {
  test('the server forgot the live driver: reconnect, then run the statement once more', async () => {
    updateConnections(() => [row('c1')])
    const { calls, request } = flaky(1)
    expect(await withLiveConnection('c1', request)).toBe('rows')
    expect(reconnects).toBe(1)
    expect(calls.count).toBe(2)
    expect(getConnectionsSnapshot().connections[0]?.connected).toBe(true)
  })

  test('retries exactly once: still gone after a good reconnect is the answer', async () => {
    updateConnections(() => [row('c1')])
    const { calls, request } = flaky(2)
    await expect(withLiveConnection('c1', request)).rejects.toThrow('no longer available')
    expect(calls.count).toBe(2)
  })

  test('an open transaction is never replayed outside itself', async () => {
    updateConnections(() => [row('c1')])
    const unsubscribe = transactionStore.subscribe('c1', () => {})
    transactionStore.syncConnection(row('c1', { txOpen: true }))
    expect(transactionStore.getSnapshot('c1').txOpen).toBe(true)
    const { calls, request } = flaky(1)
    await expect(withLiveConnection('c1', request)).rejects.toThrow(TRANSACTION_LOST_MESSAGE)
    // Reconnected, so the next Run works — but this statement did not run in autocommit.
    expect(reconnects).toBe(1)
    expect(calls.count).toBe(1)
    expect(transactionStore.getSnapshot('c1').txOpen).toBe(false)
    unsubscribe()
  })

  test('a failed reconnect surfaces the original error and runs nothing again', async () => {
    updateConnections(() => [row('c1')])
    databaseApi.reconnect = async () => {
      reconnects += 1
      throw new DbApiError('Could not reach the database host.', 'host_unreachable')
    }
    const { calls, request } = flaky(1)
    await expect(withLiveConnection('c1', request)).rejects.toThrow('no longer available')
    expect(calls.count).toBe(1)
  })

  test('any other failure is the statement’s own and is not retried', async () => {
    updateConnections(() => [row('c1')])
    const { calls, request } = flaky(1, () => new DbApiError('syntax error', 'syntax_error'))
    await expect(withLiveConnection('c1', request)).rejects.toThrow('syntax error')
    expect(reconnects).toBe(0)
    expect(calls.count).toBe(1)
  })
})
