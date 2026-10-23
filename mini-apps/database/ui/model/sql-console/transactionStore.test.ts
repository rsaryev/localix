import { afterEach, describe, expect, test } from 'bun:test'
import type { DbConnectionInfo } from '../../dbClient'
import { databaseApi } from '../../api/databaseApi'
import { transactionStore } from './transactionStore'

const originalList = databaseApi.list.bind(databaseApi)
const originalBegin = databaseApi.beginTx.bind(databaseApi)
const originalCommit = databaseApi.commitTx.bind(databaseApi)
const originalRollback = databaseApi.rollbackTx.bind(databaseApi)

afterEach(() => {
  databaseApi.list = originalList
  databaseApi.beginTx = originalBegin
  databaseApi.commitTx = originalCommit
  databaseApi.rollbackTx = originalRollback
})

function connection(id: string, txOpen: boolean): DbConnectionInfo {
  return {
    id,
    name: id,
    dialect: 'sqlite',
    connected: true,
    readonly: false,
    txOpen,
    createdAt: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('transactionStore', () => {
  test('shares one deduplicated BEGIN across consoles for the same connection', async () => {
    const id = 'shared-begin'
    const begun = deferred<DbConnectionInfo>()
    let beginCalls = 0
    let firstUpdates = 0
    let secondUpdates = 0
    const unsubscribeFirst = transactionStore.subscribe(id, () => {
      firstUpdates += 1
    })
    const unsubscribeSecond = transactionStore.subscribe(id, () => {
      secondUpdates += 1
    })
    databaseApi.beginTx = () => {
      beginCalls += 1
      return begun.promise
    }

    transactionStore.setMode(id, 'manual')
    const first = transactionStore.ensureOpen(id)
    const second = transactionStore.ensureOpen(id)

    expect(beginCalls).toBe(1)
    expect(transactionStore.getSnapshot(id)).toMatchObject({
      txMode: 'manual',
      txOpen: false,
      txBusy: true,
    })
    expect(firstUpdates).toBeGreaterThan(0)
    expect(secondUpdates).toBeGreaterThan(0)

    begun.resolve(connection(id, true))
    await Promise.all([first, second])

    expect(transactionStore.getSnapshot(id)).toEqual({
      txMode: 'manual',
      txOpen: true,
      txBusy: false,
      txNotice: 'BEGIN',
    })
    unsubscribeFirst()
    unsubscribeSecond()
  })

  test('hydrates a server transaction as manual after every console was closed', async () => {
    const id = 'hydrated-open'
    databaseApi.list = async () => [connection(id, true)]

    await transactionStore.refresh(id)

    expect(transactionStore.getSnapshot(id)).toMatchObject({
      txMode: 'manual',
      txOpen: true,
    })
  })

  test('opens the next manual transaction after an in-flight commit boundary', async () => {
    const id = 'commit-then-run'
    const committed = deferred<DbConnectionInfo>()
    const events: string[] = []
    databaseApi.list = async () => [connection(id, true)]
    databaseApi.commitTx = async () => {
      events.push('commit:start')
      const result = await committed.promise
      events.push('commit:end')
      return result
    }
    databaseApi.beginTx = async () => {
      events.push('begin')
      return connection(id, true)
    }
    await transactionStore.refresh(id)

    const commit = transactionStore.settle(id, 'commit')
    const nextRun = transactionStore.ensureOpen(id)
    committed.resolve(connection(id, false))
    await Promise.all([commit, nextRun])

    expect(events).toEqual(['commit:start', 'commit:end', 'begin'])
    expect(transactionStore.getSnapshot(id)).toMatchObject({
      txMode: 'manual',
      txOpen: true,
      txBusy: false,
      txNotice: 'BEGIN',
    })
  })

  test('refuses Auto while BEGIN is unresolved', async () => {
    const id = 'mode-during-begin'
    const begun = deferred<DbConnectionInfo>()
    databaseApi.beginTx = () => begun.promise
    transactionStore.setMode(id, 'manual')

    const opening = transactionStore.ensureOpen(id)
    transactionStore.setMode(id, 'auto')
    expect(transactionStore.getSnapshot(id).txMode).toBe('manual')

    begun.resolve(connection(id, true))
    await opening
  })

  test('drops a closed driver transaction and begins again after reconnect', async () => {
    const id = 'reconnect-after-open'
    let beginCalls = 0
    databaseApi.list = async () => [connection(id, true)]
    databaseApi.beginTx = async () => {
      beginCalls += 1
      return connection(id, true)
    }
    await transactionStore.refresh(id)

    transactionStore.markClosed(id)
    transactionStore.syncConnection(connection(id, false))
    expect(transactionStore.getSnapshot(id)).toMatchObject({
      txMode: 'manual',
      txOpen: false,
    })

    await transactionStore.ensureOpen(id)
    expect(beginCalls).toBe(1)
    expect(transactionStore.getSnapshot(id).txOpen).toBe(true)
  })

  test('does not let an older hydration close a newly opened transaction', async () => {
    const id = 'stale-hydration'
    const listed = deferred<DbConnectionInfo[]>()
    databaseApi.list = () => listed.promise
    databaseApi.beginTx = async () => connection(id, true)

    const hydration = transactionStore.refresh(id)
    transactionStore.setMode(id, 'manual')
    await transactionStore.ensureOpen(id)
    listed.resolve([connection(id, false)])
    await hydration

    expect(transactionStore.getSnapshot(id)).toMatchObject({
      txMode: 'manual',
      txOpen: true,
    })
  })

  test('does not report BEGIN when the driver closed during the request', async () => {
    const id = 'closed-during-begin'
    databaseApi.beginTx = async () => ({ ...connection(id, false), connected: false })
    transactionStore.setMode(id, 'manual')

    expect(transactionStore.ensureOpen(id)).rejects.toThrow(
      'The database connection closed before the transaction began.',
    )

    expect(transactionStore.getSnapshot(id)).toMatchObject({
      txOpen: false,
      txBusy: false,
      txNotice: null,
    })
  })
})
