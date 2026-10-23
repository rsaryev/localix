import { describe, expect, it } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DbConnectionConfig } from './contracts'
import { driverFlags } from './drivers/port'
import type { DbDriver, DbTableSchema, DbTransaction } from './drivers/port'
import { createDatabaseService } from './service'
import { createConnectionStore } from './store'

describe('manual transaction lifecycle races', () => {
  const config = {
    dialect: 'sqlite',
    file: '/tx-race.db',
  } as unknown as DbConnectionConfig

  async function fixture() {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-tx-race-'))
    let beginCalls = 0
    let commits = 0
    let rollbacks = 0
    let closes = 0
    const driverQueries: string[] = []
    const txQueries: string[] = []
    let beginStarted = () => {}
    const beginReached = new Promise<void>((resolve) => {
      beginStarted = resolve
    })
    let releaseBegin = () => {}
    const beginMayFinish = new Promise<void>((resolve) => {
      releaseBegin = resolve
    })
    const createDriver = (): DbDriver => ({
      // The REAL flags for the dialect, not a hand-written literal: a stub that states
      // its own subset of `DriverFlags` drifts the moment a flag is added, and the service
      // under test branches on them.
      getFlags: () => driverFlags('sqlite'),
      query: async (sql) => {
        driverQueries.push(sql)
        return { columns: [], rows: [], durationMs: 0 }
      },
      // Part of `DbDriver`, and previously absent: the two earlier type errors masked it,
      // so completing them surfaced a third. Unused by these races, but the stub must
      // satisfy the port it claims to be.
      browse: async () => ({ columns: [], rows: [], durationMs: 0 }),
      transaction: async (statements) => {
        driverQueries.push(...statements.map((statement) => statement.sql))
        return statements.map(() => ({ columns: [], rows: [], durationMs: 0 }))
      },
      async beginTransaction(): Promise<DbTransaction> {
        beginCalls += 1
        beginStarted()
        await beginMayFinish
        let done = false
        return {
          query: async (sql) => {
            txQueries.push(sql)
            return { columns: [], rows: [], durationMs: 0 }
          },
          async commit() {
            if (done) return
            done = true
            commits += 1
          },
          async rollback() {
            if (done) return
            done = true
            rollbacks += 1
          },
        }
      },
      async close() {
        closes += 1
      },
      schemas: async () => ({}),
      // A complete `DbTableSchema`: `{}` type-checked only because the return was widened,
      // and the service reads `columns`/`primaryKey` off it.
      tableSchema: async (): Promise<DbTableSchema> => ({
        name: 't',
        type: 'table',
        columns: [],
        primaryKey: [],
        foreignKeys: [],
        indexes: [],
      }),
    })
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
    const connection = await service.connect('u', { config })
    return {
      service,
      connection,
      beginReached,
      releaseBegin,
      queries: () => ({ driverQueries, txQueries }),
      counts: () => ({ beginCalls, commits, rollbacks, closes }),
    }
  }

  it('coalesces concurrent Begin requests onto one pinned transaction', async () => {
    const { service, connection, beginReached, releaseBegin, counts } = await fixture()
    const first = service.beginTx('u', connection.id)
    const second = service.beginTx('u', connection.id)
    await beginReached
    releaseBegin()

    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ txOpen: true }),
      expect.objectContaining({ txOpen: true }),
    ])
    expect(counts().beginCalls).toBe(1)
    await service.rollbackTx('u', connection.id)
    expect(counts().rollbacks).toBe(1)
  })

  it('settles the shared transaction when Commit arrives during Begin', async () => {
    const { service, connection, beginReached, releaseBegin, counts } = await fixture()
    const begin = service.beginTx('u', connection.id)
    await beginReached
    const commit = service.commitTx('u', connection.id)
    releaseBegin()

    await Promise.all([begin, commit])
    expect(counts()).toMatchObject({ beginCalls: 1, commits: 1, rollbacks: 0 })
    expect(await service.list('u')).toEqual([
      expect.objectContaining({ id: connection.id, connected: true, txOpen: false }),
    ])
  })

  it('rolls back a transaction whose Begin resolves during disconnect', async () => {
    const { service, connection, beginReached, releaseBegin, counts } = await fixture()
    const begin = service.beginTx('u', connection.id)
    await beginReached
    const disconnect = service.disconnect('u', connection.id)
    releaseBegin()

    expect(await begin).toMatchObject({ connected: false, txOpen: false })
    expect(await disconnect).toBe(true)
    expect(counts()).toEqual({ beginCalls: 1, commits: 0, rollbacks: 1, closes: 1 })
    expect(await service.list('u')).toEqual([
      expect.objectContaining({ id: connection.id, connected: false, txOpen: false }),
    ])
  })

  it('cancels a queued batch when disconnect invalidates its pending Begin', async () => {
    const { service, connection, beginReached, releaseBegin, queries, counts } = await fixture()
    const begin = service.beginTx('u', connection.id)
    await beginReached
    const batch = service.executeBatch('u', connection.id, [
      { sql: 'INSERT INTO items VALUES (2)' },
    ])
    const disconnect = service.disconnect('u', connection.id)
    releaseBegin()

    expect(batch).rejects.toMatchObject({ code: 'cancelled' })
    expect(await begin).toMatchObject({ connected: false, txOpen: false })
    expect(await disconnect).toBe(true)
    expect(queries()).toEqual({ driverQueries: ['SELECT 1'], txQueries: [] })
    expect(counts()).toEqual({ beginCalls: 1, commits: 0, rollbacks: 1, closes: 1 })
  })

  it('keeps query and batch calls that arrive during Begin inside the opened transaction', async () => {
    const { service, connection, beginReached, releaseBegin, queries } = await fixture()
    const begin = service.beginTx('u', connection.id)
    await beginReached
    const query = service.query('u', connection.id, 'UPDATE items SET value = 1', undefined, {
      timeoutMs: 0,
    })
    const batch = service.executeBatch('u', connection.id, [
      { sql: 'INSERT INTO items VALUES (2)' },
      { sql: 'DELETE FROM items WHERE id = 3' },
    ])

    // Neither operation may escape to the driver's ordinary auto-commit/batch path while
    // beginTransaction() is still pending. SELECT 1 is the connect-time probe.
    expect(queries()).toEqual({ driverQueries: ['SELECT 1'], txQueries: [] })
    releaseBegin()
    await Promise.all([begin, query, batch])

    const after = queries()
    expect(after.driverQueries).toEqual(['SELECT 1'])
    expect(after.txQueries).toHaveLength(3)
    expect(after.txQueries).toContain('UPDATE items SET value = 1')
    // Separate requests may interleave, but statements within the batch retain their order.
    expect(after.txQueries.indexOf('INSERT INTO items VALUES (2)')).toBeLessThan(
      after.txQueries.indexOf('DELETE FROM items WHERE id = 3'),
    )
    await service.rollbackTx('u', connection.id)
  })

  it('keeps query timeout effective while it waits for a pending Begin', async () => {
    const { service, connection, beginReached, releaseBegin, queries } = await fixture()
    const begin = service.beginTx('u', connection.id)
    await beginReached

    // No `await`: bun's `.rejects` matchers settle themselves, and every other
    // `.rejects` assertion in this repo is written without one (apps/api lib tests,
    // packages, other mini apps). Awaiting a non-Thenable is what oxlint flags.
    expect(
      service.query('u', connection.id, 'SELECT slow_work', undefined, { timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'timeout' })
    expect(queries()).toEqual({ driverQueries: ['SELECT 1'], txQueries: [] })

    // Begin remains independently owned by its request; finish and clean it up after the
    // timed-out follower has stopped waiting.
    releaseBegin()
    await begin
    await service.rollbackTx('u', connection.id)
  })
})
