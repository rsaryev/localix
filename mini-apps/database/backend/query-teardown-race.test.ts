import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { DbConnectionConfig } from './contracts'
import { driverFlags, type DbDriver, type DbTableSchema, type DbTransaction } from './drivers/port'
import { createDatabaseService } from './service'
import { createConnectionStore, type ConnectionStore } from './store'

describe('query teardown race', () => {
  test('disconnect aborts and drains a running query before closing its driver', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-query-teardown-'))
    let queryStarted = () => {}
    const queryReached = new Promise<void>((resolve) => {
      queryStarted = resolve
    })
    let querySettled = false
    let closedBeforeQuerySettled = false

    const createDriver = (): DbDriver => ({
      getFlags: () => driverFlags('postgres'),
      async query(sql, _params, signal) {
        if (sql === 'SELECT 1') {
          return { columns: [], rows: [], durationMs: 0 }
        }
        queryStarted()
        try {
          await new Promise<void>((_resolve, reject) => {
            const onAbort = () => reject(signal?.reason ?? new Error('cancelled'))
            if (signal?.aborted) onAbort()
            else signal?.addEventListener('abort', onAbort, { once: true })
          })
          return { columns: [], rows: [], durationMs: 0 }
        } finally {
          querySettled = true
        }
      },
      browse: async () => ({ columns: [], rows: [], durationMs: 0 }),
      schemas: async () => ({}),
      tableSchema: async (): Promise<DbTableSchema> => ({
        name: 't',
        type: 'table',
        columns: [],
        primaryKey: [],
        foreignKeys: [],
        indexes: [],
      }),
      async close() {
        closedBeforeQuerySettled = !querySettled
      },
    })
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
    const connection = await service.connect('u', {
      config: { dialect: 'postgres', host: 'localhost' } as DbConnectionConfig,
    })

    const pendingQuery = service.query('u', connection.id, 'SELECT slow', undefined, {
      timeoutMs: 0,
    })
    await queryReached
    const disconnect = service.disconnect('u', connection.id)

    expect(pendingQuery).rejects.toMatchObject({ code: 'cancelled' })
    expect(await disconnect).toBe(true)
    expect(querySettled).toBe(true)
    expect(closedBeforeQuerySettled).toBe(false)
    expect(await service.query('u', connection.id, 'SELECT after')).toBeNull()
  })

  test('disconnect drains an atomic batch before closing its driver', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-batch-teardown-'))
    let batchStarted = () => {}
    const batchReached = new Promise<void>((resolve) => {
      batchStarted = resolve
    })
    let releaseBatch = () => {}
    const batchMayFinish = new Promise<void>((resolve) => {
      releaseBatch = resolve
    })
    let batchSettled = false
    let closedBeforeBatchSettled = false

    const createDriver = (): DbDriver => ({
      getFlags: () => driverFlags('postgres'),
      async query() {
        return { columns: [], rows: [], durationMs: 0 }
      },
      async transaction(statements) {
        batchStarted()
        try {
          await batchMayFinish
          return statements.map(() => ({ columns: [], rows: [], durationMs: 0 }))
        } finally {
          batchSettled = true
        }
      },
      browse: async () => ({ columns: [], rows: [], durationMs: 0 }),
      schemas: async () => ({}),
      tableSchema: async (): Promise<DbTableSchema> => ({
        name: 't',
        type: 'table',
        columns: [],
        primaryKey: [],
        foreignKeys: [],
        indexes: [],
      }),
      async close() {
        closedBeforeBatchSettled = !batchSettled
      },
    })
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
    const connection = await service.connect('u', {
      config: { dialect: 'postgres', host: 'localhost' } as DbConnectionConfig,
    })

    const pendingBatch = service.executeBatch('u', connection.id, [{ sql: 'UPDATE slow' }])
    await batchReached
    const disconnect = service.disconnect('u', connection.id)
    releaseBatch()

    expect(await pendingBatch).toMatchObject({ results: [{ rows: [] }] })
    expect(await disconnect).toBe(true)
    expect(batchSettled).toBe(true)
    expect(closedBeforeBatchSettled).toBe(false)
  })

  test('disconnect drains a structured browse before closing its driver', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-browse-teardown-'))
    let browseStarted = () => {}
    const browseReached = new Promise<void>((resolve) => {
      browseStarted = resolve
    })
    let releaseBrowse = () => {}
    const browseMayFinish = new Promise<void>((resolve) => {
      releaseBrowse = resolve
    })
    let browseSettled = false
    let closedBeforeBrowseSettled = false

    const createDriver = (): DbDriver => ({
      getFlags: () => driverFlags('postgres'),
      async query() {
        return { columns: [], rows: [], durationMs: 0 }
      },
      async browse() {
        browseStarted()
        try {
          await browseMayFinish
          return { columns: [{ name: 'id' }], rows: [[1]], durationMs: 0 }
        } finally {
          browseSettled = true
        }
      },
      schemas: async () => ({}),
      tableSchema: async (): Promise<DbTableSchema> => ({
        name: 't',
        type: 'table',
        columns: [],
        primaryKey: [],
        foreignKeys: [],
        indexes: [],
      }),
      async close() {
        closedBeforeBrowseSettled = !browseSettled
      },
    })
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
    const connection = await service.connect('u', {
      config: { dialect: 'postgres', host: 'localhost' } as DbConnectionConfig,
    })

    const pendingBrowse = service.browse('u', connection.id, {
      table: 'slow',
      limit: 100,
      offset: 0,
    })
    await browseReached
    const disconnect = service.disconnect('u', connection.id)
    releaseBrowse()

    // A browse is cancellable now (the query's path), so disconnect aborts it: the result of a
    // driver that ignores the signal is discarded, yet the driver is still drained before close.
    expect(pendingBrowse).rejects.toMatchObject({ code: 'cancelled' })
    expect(await disconnect).toBe(true)
    expect(browseSettled).toBe(true)
    expect(closedBeforeBrowseSettled).toBe(false)
  })

  test('disconnect releases a manual transaction before draining queued metadata', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-metadata-teardown-'))
    let metadataStarted = () => {}
    const metadataReached = new Promise<void>((resolve) => {
      metadataStarted = resolve
    })
    let releaseMetadata = () => {}
    const transactionReleased = new Promise<void>((resolve) => {
      releaseMetadata = resolve
    })
    let metadataSettled = false
    let closedBeforeMetadataSettled = false
    let rollbacks = 0

    const createDriver = (): DbDriver => ({
      getFlags: () => driverFlags('postgres'),
      async query() {
        return { columns: [], rows: [], durationMs: 0 }
      },
      browse: async () => ({ columns: [], rows: [], durationMs: 0 }),
      async beginTransaction(): Promise<DbTransaction> {
        return {
          query: async () => ({ columns: [], rows: [], durationMs: 0 }),
          commit: async () => {},
          async rollback() {
            rollbacks += 1
            releaseMetadata()
          },
        }
      },
      async schemas() {
        metadataStarted()
        try {
          await transactionReleased
          return {}
        } finally {
          metadataSettled = true
        }
      },
      tableSchema: async (): Promise<DbTableSchema> => ({
        name: 't',
        type: 'table',
        columns: [],
        primaryKey: [],
        foreignKeys: [],
        indexes: [],
      }),
      async close() {
        closedBeforeMetadataSettled = !metadataSettled
      },
    })
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
    const connection = await service.connect('u', {
      config: { dialect: 'postgres', host: 'localhost' } as DbConnectionConfig,
    })
    expect(await service.beginTx('u', connection.id)).toMatchObject({ txOpen: true })

    const metadata = service.schemas('u', connection.id)
    await metadataReached
    const disconnect = service.disconnect('u', connection.id)

    expect(await metadata).toEqual({ schemas: {} })
    expect(await disconnect).toBe(true)
    expect(rollbacks).toBe(1)
    expect(metadataSettled).toBe(true)
    expect(closedBeforeMetadataSettled).toBe(false)
  })

  test('a stale failed ping cannot delete the driver installed by reconnect', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-ping-reconnect-'))
    let firstProbeCalls = 0
    let stalePingStarted = () => {}
    const stalePingReached = new Promise<void>((resolve) => {
      stalePingStarted = resolve
    })
    let failStalePing = () => {}
    const stalePingMayFail = new Promise<void>((resolve) => {
      failStalePing = resolve
    })
    const closed: number[] = []
    let driverNumber = 0

    const createDriver = (): DbDriver => {
      const number = ++driverNumber
      return {
        getFlags: () => driverFlags('postgres'),
        async probe() {
          if (number !== 1 || ++firstProbeCalls === 1) return
          stalePingStarted()
          await stalePingMayFail
          throw new Error('old connection failed')
        },
        async query() {
          return { columns: [{ name: 'driver' }], rows: [[number]], durationMs: 0 }
        },
        browse: async () => ({ columns: [], rows: [], durationMs: 0 }),
        schemas: async () => ({}),
        tableSchema: async (): Promise<DbTableSchema> => ({
          name: 't',
          type: 'table',
          columns: [],
          primaryKey: [],
          foreignKeys: [],
          indexes: [],
        }),
        async close() {
          closed.push(number)
        },
      }
    }
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
    const connection = await service.connect('u', {
      config: { dialect: 'postgres', host: 'localhost' } as DbConnectionConfig,
    })

    const stalePing = service.ping('u', connection.id)
    await stalePingReached
    expect(await service.reconnect('u', connection.id)).toMatchObject({ connected: true })
    failStalePing()

    expect(await stalePing).toBe(true)
    expect(await service.query('u', connection.id, 'SELECT driver')).toMatchObject({
      result: { rows: [[2]] },
    })
    expect(await service.list('u')).toEqual([
      expect.objectContaining({ id: connection.id, connected: true }),
    ])
    expect(closed).toEqual([1])
    await service.closeAll()
    expect(closed).toEqual([1, 2])
  })

  test('Begin uses the replacement driver when reconnect wins during the store read', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-begin-reconnect-'))
    const baseStore = createConnectionStore({ dir: path.join(dir, 'store') })
    let blockNextGet = false
    let storeReadStarted = () => {}
    const storeReadReached = new Promise<void>((resolve) => {
      storeReadStarted = resolve
    })
    let releaseStoreRead = () => {}
    const storeReadMayFinish = new Promise<void>((resolve) => {
      releaseStoreRead = resolve
    })
    const store: ConnectionStore = {
      ...baseStore,
      async get(userId, id) {
        if (blockNextGet) {
          blockNextGet = false
          storeReadStarted()
          await storeReadMayFinish
        }
        return baseStore.get(userId, id)
      },
    }
    const began: number[] = []
    const closed: number[] = []
    let driverNumber = 0

    const createDriver = (): DbDriver => {
      const number = ++driverNumber
      return {
        getFlags: () => driverFlags('postgres'),
        async query() {
          return { columns: [], rows: [], durationMs: 0 }
        },
        browse: async () => ({ columns: [], rows: [], durationMs: 0 }),
        async beginTransaction(): Promise<DbTransaction> {
          began.push(number)
          return {
            query: async () => ({ columns: [], rows: [], durationMs: 0 }),
            commit: async () => {},
            rollback: async () => {},
          }
        },
        schemas: async () => ({}),
        tableSchema: async (): Promise<DbTableSchema> => ({
          name: 't',
          type: 'table',
          columns: [],
          primaryKey: [],
          foreignKeys: [],
          indexes: [],
        }),
        async close() {
          closed.push(number)
        },
      }
    }
    const service = createDatabaseService({ store, createDriver })
    const connection = await service.connect('u', {
      config: { dialect: 'postgres', host: 'localhost' } as DbConnectionConfig,
    })

    blockNextGet = true
    const begin = service.beginTx('u', connection.id)
    await storeReadReached
    await service.reconnect('u', connection.id)
    releaseStoreRead()

    expect(await begin).toMatchObject({ connected: true, txOpen: true })
    expect(began).toEqual([2])
    expect(closed).toEqual([1])
    await service.rollbackTx('u', connection.id)
    await service.closeAll()
    expect(closed).toEqual([1, 2])
  })
})
