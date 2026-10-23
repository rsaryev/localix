import { afterAll, describe, expect, it } from 'bun:test'
import { databaseApi } from '../api/databaseApi'
import type { DbSchemas, DbTableSchema } from '../dbClient'
import { entries } from './schemaEntry'
import { getCachedTable } from './schemaKey'
import { COLUMN_LOAD_CONCURRENCY, schemaStore } from './schemaStore'

/**
 * Commit coalescing and queue dedupe. Each column load used to copy the whole `tables` map and
 * notify every subscriber on its own — a prefetch of 150 tables re-rendered the tree 150 times and
 * a column search over 5,000 was O(n²) in copying — and `ensureColumns` deduped with a linear scan
 * of the queue per wanted table.
 */

const originalSchemas = databaseApi.schemas.bind(databaseApi)
const originalTableSchema = databaseApi.tableSchema.bind(databaseApi)
afterAll(() => {
  databaseApi.schemas = originalSchemas
  databaseApi.tableSchema = originalTableSchema
})

const tick = () => new Promise((r) => setTimeout(r, 0))
const structure = (name: string): DbTableSchema => ({
  name,
  type: 'table',
  columns: [{ name: 'id', dataType: 'int', nullable: false, pk: true }],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: [],
})

describe('schemaStore — one snapshot per batch of arrived structures', () => {
  it('commits once for many table reads that settle in the same task', async () => {
    const id = 'coalesce-same-task'
    // An empty tree: no eager prefetch, so every table read below is ours.
    databaseApi.schemas = () => Promise.resolve({ main: [] } as DbSchemas)
    const pending: Array<() => void> = []
    databaseApi.tableSchema = (_c, table) =>
      new Promise((resolve) => pending.push(() => resolve(structure(table))))

    let notifications = 0
    const unsub = schemaStore.subscribe(id, () => (notifications += 1))
    await tick()
    const afterTree = notifications
    const before = schemaStore.getSnapshot(id).tables

    for (let i = 0; i < 50; i++) schemaStore.loadTable(id, `t${i}`)
    for (const settle of pending) settle()
    await tick()

    expect(notifications - afterTree).toBe(1)
    const snap = schemaStore.getSnapshot(id)
    expect(snap.tables).not.toBe(before)
    expect(Object.keys(snap.tables)).toHaveLength(50)
    expect(getCachedTable(snap.tables, 't49')?.name).toBe('t49')
    unsub()
  })

  it('drops a staged structure when the object is re-read before the batch commits', async () => {
    const id = 'coalesce-reload-table'
    databaseApi.schemas = () => Promise.resolve({ main: [] } as DbSchemas)
    let settleFirst: (() => void) | undefined
    let reads = 0
    databaseApi.tableSchema = (_c, table) => {
      reads += 1
      if (reads === 1)
        return new Promise(
          (resolve) => (settleFirst = () => resolve({ ...structure(table), name: 'stale' })),
        )
      return new Promise(() => {})
    }
    const unsub = schemaStore.subscribe(id, () => {})
    await tick()
    schemaStore.loadTable(id, 'users')
    await tick()
    settleFirst!()
    // The stale response resolves and stages; the re-read lands in the same task.
    await Promise.resolve()
    schemaStore.reloadTable(id, 'users')
    await tick()
    expect(getCachedTable(schemaStore.getSnapshot(id).tables, 'users')).toBeUndefined()
    unsub()
  })
})

describe('schemaStore.ensureColumns — keyed queue dedupe', () => {
  it('queues each object once however often a search asks for it', async () => {
    const id = 'dedupe-keyed'
    databaseApi.schemas = () => Promise.resolve({ main: [] } as DbSchemas)
    let requests = 0
    databaseApi.tableSchema = () => {
      requests += 1
      return new Promise(() => {})
    }
    const unsub = schemaStore.subscribe(id, () => {})
    await tick()
    const wanted = Array.from({ length: 40 }, (_, i) => ({ name: `t${i}` }))
    schemaStore.ensureColumns(id, [...wanted, ...wanted])
    schemaStore.ensureColumns(id, wanted)
    const entry = entries.get(id)!
    // A full lane in flight, the rest waiting exactly once each.
    const waiting = 40 - COLUMN_LOAD_CONCURRENCY
    expect(requests).toBe(COLUMN_LOAD_CONCURRENCY)
    expect(entry.columnQueue.length - entry.columnHead).toBe(waiting)
    expect(entry.queuedKeys.size).toBe(waiting)
    unsub()
  })

  it('stays linear on a very large request (a column search over every table)', async () => {
    const id = 'dedupe-linear'
    databaseApi.schemas = () => Promise.resolve({ main: [] } as DbSchemas)
    databaseApi.tableSchema = () => new Promise(() => {})
    const unsub = schemaStore.subscribe(id, () => {})
    await tick()
    const wanted = Array.from({ length: 20_000 }, (_, i) => ({ name: `t${i}`, schema: 's' }))
    const started = performance.now()
    schemaStore.ensureColumns(id, wanted)
    schemaStore.ensureColumns(id, wanted)
    // The scan-per-table version spent ~2×10⁸ key comparisons here — seconds, not milliseconds.
    expect(performance.now() - started).toBeLessThan(500)
    unsub()
  })
})
