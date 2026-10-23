import { describe, expect, it } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DbConnectionConfig } from './contracts'
import { driverFlags } from './drivers/port'
import type { DbDriver, DbTableSchema, DbTransaction } from './drivers/port'
import { createDatabaseService } from './service'
import { createConnectionStore } from './store'

describe('manual transaction settlement races', () => {
  it('keeps following queries and Begin behind an in-flight COMMIT', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-tx-settle-'))
    const driverQueries: string[] = []
    const txQueries: string[] = []
    let beginCalls = 0
    let commitStarted = () => {}
    const commitReached = new Promise<void>((resolve) => {
      commitStarted = resolve
    })
    let releaseCommit = () => {}
    const commitMayFinish = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })

    const createDriver = (): DbDriver => ({
      getFlags: () => driverFlags('mysql'),
      query: async (sql) => {
        driverQueries.push(sql)
        return { columns: [], rows: [], durationMs: 0 }
      },
      browse: async () => ({ columns: [], rows: [], durationMs: 0 }),
      async beginTransaction(): Promise<DbTransaction> {
        beginCalls++
        return {
          query: async (sql) => {
            txQueries.push(sql)
            return { columns: [], rows: [], durationMs: 0 }
          },
          async commit() {
            commitStarted()
            await commitMayFinish
          },
          async rollback() {},
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
      async close() {},
    })
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
    const connection = await service.connect('u', {
      config: {
        dialect: 'mysql',
        host: 'localhost',
      } as DbConnectionConfig,
    })
    await service.beginTx('u', connection.id)

    const commit = service.commitTx('u', connection.id)
    await commitReached
    const query = service.query('u', connection.id, 'SELECT after_commit', undefined, {
      timeoutMs: 0,
    })
    const nextBegin = service.beginTx('u', connection.id)

    await Promise.resolve()
    expect(driverQueries).toEqual(['SELECT 1'])
    expect(beginCalls).toBe(1)

    releaseCommit()
    await Promise.all([commit, query, nextBegin])
    expect([...driverQueries, ...txQueries]).toContain('SELECT after_commit')
    expect(beginCalls).toBe(2)
    await service.rollbackTx('u', connection.id)
  })

  it('serializes concurrent transaction queries before COMMIT', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-tx-query-settle-'))
    const events: string[] = []
    let firstStarted = () => {}
    const firstReached = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    let releaseFirst = () => {}
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const createDriver = (): DbDriver => ({
      getFlags: () => driverFlags('mysql'),
      query: async () => ({ columns: [], rows: [], durationMs: 0 }),
      browse: async () => ({ columns: [], rows: [], durationMs: 0 }),
      async beginTransaction(): Promise<DbTransaction> {
        return {
          async query(sql) {
            events.push(`${sql}:start`)
            if (sql === 'first') {
              firstStarted()
              await firstMayFinish
            }
            events.push(`${sql}:end`)
            return { columns: [], rows: [], durationMs: 0 }
          },
          async commit() {
            events.push('commit')
          },
          async rollback() {},
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
      async close() {},
    })
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
    const connection = await service.connect('u', {
      config: { dialect: 'mysql', host: 'localhost' } as DbConnectionConfig,
    })
    await service.beginTx('u', connection.id)

    const first = service.query('u', connection.id, 'first', undefined, { timeoutMs: 0 })
    await firstReached
    const second = service.query('u', connection.id, 'second', undefined, { timeoutMs: 0 })
    const commit = service.commitTx('u', connection.id)

    // Wait until settlement has claimed the boundary (`txOpen:false`). Neither the second
    // query nor COMMIT may overlap the still-running first request on the pinned connection.
    while ((await service.list('u'))[0]?.txOpen) await Promise.resolve()
    expect(events).toEqual(['first:start'])

    releaseFirst()
    await Promise.all([first, second, commit])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end', 'commit'])
  })
})
