import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { databaseApi } from '../api/databaseApi'
import type { DbColumnCatalog, DbSchemas, DbTableSchema } from '../dbClient'
import { getCachedTable } from './schemaKey'
import { COLUMN_LOAD_CONCURRENCY, schemaStore } from './schemaStore'

// Controllable fake for the network layer the store fetches through.
let schemasImpl: () => Promise<DbSchemas>
let tableSchemaImpl: (table?: string, schema?: string) => Promise<DbTableSchema>
const originalSchemas = databaseApi.schemas.bind(databaseApi)
const originalTableSchema = databaseApi.tableSchema.bind(databaseApi)
databaseApi.schemas = () => schemasImpl()
databaseApi.tableSchema = (_connectionId, table, schema) => tableSchemaImpl(table, schema)
// Default: an engine without a catalog read, so the per-table prefetch runs as before.
let columnCatalogImpl: () => Promise<DbColumnCatalog | null> = () => Promise.resolve(null)
const originalColumnCatalog = databaseApi.columnCatalog.bind(databaseApi)
databaseApi.columnCatalog = () => columnCatalogImpl()

const SCHEMAS: DbSchemas = { main: [{ name: 'users', type: 'table' }] }
const EMPTY_TABLE_SCHEMA: DbTableSchema = {
  name: 'table',
  type: 'table',
  columns: [],
  primaryKey: [],
  foreignKeys: [],
  indexes: [],
}

/** Subscribe and collect the snapshots pushed to listeners; returns [snapshots, unsubscribe]. */
function watch(id: string) {
  const seen: Array<ReturnType<typeof schemaStore.getSnapshot>> = []
  const unsub = schemaStore.subscribe(id, () => seen.push(schemaStore.getSnapshot(id)))
  return { seen, unsub }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  // No module reset API — use a fresh connection id per test to isolate store entries.
  tableSchemaImpl = () => Promise.resolve(EMPTY_TABLE_SCHEMA)
  columnCatalogImpl = () => Promise.resolve(null)
})

afterAll(() => {
  databaseApi.schemas = originalSchemas
  databaseApi.tableSchema = originalTableSchema
  databaseApi.columnCatalog = originalColumnCatalog
})

describe('schemaStore column catalog — one read instead of a read per table', () => {
  const many: DbSchemas = {
    public: Array.from({ length: 40 }, (_, index) => ({ name: `t${index}`, type: 'table' })),
    audit: [{ name: 't0', type: 'table' }],
  }

  it('fills the column vocabulary from the catalog and issues no per-table reads', async () => {
    const id = 'conn-catalog'
    let tableReads = 0
    schemasImpl = () => Promise.resolve(many)
    tableSchemaImpl = () => {
      tableReads += 1
      return Promise.resolve(EMPTY_TABLE_SCHEMA)
    }
    columnCatalogImpl = () =>
      Promise.resolve([
        { schema: 'public', table: 't0', columns: [{ name: 'id', dataType: 'int4', pk: true }] },
        { schema: 'audit', table: 't0', columns: [{ name: 'at', dataType: 'text', pk: false }] },
      ])
    const { unsub } = watch(id)
    await tick()
    await tick()
    const snap = schemaStore.getSnapshot(id)
    expect(getCachedTable(snap.columnCatalog, 't0', 'public')?.columns[0]?.name).toBe('id')
    expect(getCachedTable(snap.columnCatalog, 't0', 'audit')?.columns[0]?.name).toBe('at')
    // Structures stay a deliberate per-table read: the catalog never poses as one.
    expect(snap.tables).toEqual({})
    schemaStore.ensureColumns(id, [{ name: 't0', schema: 'public' }])
    await tick()
    expect(tableReads).toBe(0)
    unsub()
  })

  it('falls back to the per-table prefetch when the catalog read fails', async () => {
    const id = 'conn-catalog-fails'
    let tableReads = 0
    schemasImpl = () => Promise.resolve(many)
    tableSchemaImpl = () => {
      tableReads += 1
      return Promise.resolve(EMPTY_TABLE_SCHEMA)
    }
    columnCatalogImpl = () => Promise.reject(new Error('permission denied'))
    const { unsub } = watch(id)
    await tick()
    await tick()
    expect(tableReads).toBeGreaterThan(0)
    expect(schemaStore.getSnapshot(id).columnCatalog).toEqual({})
    unsub()
  })
})

describe('schemaStore.invalidate — reconnect after a dropped driver', () => {
  it('re-fetches on invalidate even after a cached connection_not_found error', async () => {
    const id = 'conn-reconnect'
    tableSchemaImpl = () => Promise.resolve(EMPTY_TABLE_SCHEMA)

    // 1) Driver is down: the first fetch fails and the error is cached with fetchStarted=true.
    schemasImpl = () => Promise.reject(new Error('connection_not_found'))
    const { seen } = watch(id)
    await tick()
    expect(schemaStore.getSnapshot(id).error).toBe('connection_not_found')
    expect(schemaStore.getSnapshot(id).schemas).toBeNull()

    // 2) Reconnect succeeds server-side. Without invalidate the one-shot fetch guard would
    //    keep serving the cached error; invalidate must re-introspect for the live subscriber.
    schemasImpl = () => Promise.resolve(SCHEMAS)
    schemaStore.invalidate(id)
    await tick()

    const snap = schemaStore.getSnapshot(id)
    expect(snap.error).toBeNull()
    expect(snap.schemas).toEqual(SCHEMAS)
    // The subscriber was notified of the recovery (not left on the stale error snapshot).
    expect(seen.at(-1)?.schemas).toEqual(SCHEMAS)
  })

  it('resets fetchStarted so a later subscribe re-fetches when there are no live listeners', async () => {
    const id = 'conn-no-listeners'
    // Prime the entry with a successful fetch, then drop the only subscriber.
    schemasImpl = () => Promise.resolve(SCHEMAS)
    const { unsub } = watch(id)
    await tick()
    expect(schemaStore.getSnapshot(id).schemas).toEqual(SCHEMAS)
    unsub()

    // Invalidate with no listeners: it should NOT fetch immediately, but clear the cache.
    let fetches = 0
    schemasImpl = () => {
      fetches += 1
      return Promise.resolve(SCHEMAS)
    }
    schemaStore.invalidate(id)
    await tick()
    expect(fetches).toBe(0)
    expect(schemaStore.getSnapshot(id).schemas).toBeNull()

    // The next subscribe (tree/console re-mount after reconnect) fetches fresh.
    const { unsub: unsub2 } = watch(id)
    await tick()
    expect(fetches).toBe(1)
    expect(schemaStore.getSnapshot(id).schemas).toEqual(SCHEMAS)
    unsub2()
  })

  it('is a no-op when nothing is cached for the connection', () => {
    expect(() => schemaStore.invalidate('never-seen')).not.toThrow()
  })

  it('does not let a pre-reload table response repopulate the cleared cache', async () => {
    const id = 'conn-global-refresh-race'
    let resolveOld!: (value: DbTableSchema) => void
    tableSchemaImpl = () =>
      new Promise((resolve) => {
        resolveOld = resolve
      })
    schemasImpl = () => Promise.resolve({})

    schemaStore.loadTable(id, 'users')
    schemaStore.reload(id)
    resolveOld({
      ...EMPTY_TABLE_SCHEMA,
      name: 'users',
      columns: [{ name: 'stale', dataType: 'text', nullable: true, pk: false }],
    })
    await tick()

    expect(schemaStore.getSnapshot(id).tables).toEqual({})
  })

  it('does not let an older schemas response replace a newer reload', async () => {
    const id = 'conn-schema-refresh-race'
    const resolvers: Array<(value: DbSchemas) => void> = []
    const prefetched: string[] = []
    schemasImpl = () =>
      new Promise((resolve) => {
        resolvers.push(resolve)
      })
    tableSchemaImpl = (table = '') => {
      prefetched.push(table)
      return Promise.resolve({ ...EMPTY_TABLE_SCHEMA, name: table })
    }

    const { unsub } = watch(id)
    schemaStore.reload(id)
    expect(resolvers).toHaveLength(2)

    const fresh: DbSchemas = { main: [{ name: 'fresh', type: 'table' }] }
    resolvers[1]!(fresh)
    await tick()
    resolvers[0]!({ main: [{ name: 'stale', type: 'table' }] })
    await tick()

    expect(schemaStore.getSnapshot(id).schemas).toEqual(fresh)
    expect(prefetched).toEqual(['fresh'])
    unsub()
  })
})

describe('schemaStore.ensureColumns — capped search prefetch', () => {
  it('parks the remaining prefetch when its last consumer leaves and resumes on subscribe', async () => {
    const id = 'conn-prefetch-visibility'
    const schemas: DbSchemas = {
      main: Array.from({ length: 8 }, (_, index) => ({ name: `t${index}`, type: 'table' })),
    }
    const resolvers: Array<() => void> = []
    let calls = 0
    schemasImpl = () => Promise.resolve(schemas)
    tableSchemaImpl = (name = '') => {
      calls += 1
      return new Promise((resolve) => {
        resolvers.push(() => resolve({ ...EMPTY_TABLE_SCHEMA, name }))
      })
    }

    const { unsub } = watch(id)
    await tick()
    expect(calls).toBe(COLUMN_LOAD_CONCURRENCY)

    unsub()
    resolvers.splice(0).forEach((resolve) => resolve())
    await tick()
    expect(calls).toBe(COLUMN_LOAD_CONCURRENCY)

    const { unsub: resumeUnsub } = watch(id)
    await tick()
    expect(calls).toBe(COLUMN_LOAD_CONCURRENCY * 2)
    resolvers.splice(0).forEach((resolve) => resolve())
    await tick()
    expect(calls).toBe(8)
    resolvers.splice(0).forEach((resolve) => resolve())
    await tick()
    resumeUnsub()
  })

  it('keeps equal table names from different schemas as independent objects', async () => {
    const id = 'conn-schema-collision'
    tableSchemaImpl = (name = '', schema) =>
      Promise.resolve({
        ...EMPTY_TABLE_SCHEMA,
        name,
        schema,
        columns: [
          {
            name: schema === 'audit' ? 'audit_id' : 'public_id',
            dataType: 'uuid',
            nullable: false,
            pk: true,
          },
        ],
      })

    schemaStore.ensureColumns(id, [
      { name: 'events', schema: 'public' },
      { name: 'events', schema: 'audit' },
    ])
    await tick()

    const tables = schemaStore.getSnapshot(id).tables
    expect(getCachedTable(tables, 'events', 'public')?.columns[0].name).toBe('public_id')
    expect(getCachedTable(tables, 'events', 'audit')?.columns[0].name).toBe('audit_id')
    expect(Object.keys(tables)).toHaveLength(2)
  })

  it('loads columns for every requested table but never exceeds the concurrency cap', async () => {
    const id = 'conn-ensure-cap'
    let inFlight = 0
    let peak = 0
    const resolvers: Array<() => void> = []
    tableSchemaImpl = () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      return new Promise((resolve) => {
        resolvers.push(() => {
          inFlight -= 1
          resolve(EMPTY_TABLE_SCHEMA)
        })
      })
    }

    const wanted = Array.from({ length: 20 }, (_, i) => ({ name: `t${i}` }))
    schemaStore.ensureColumns(id, wanted)
    await tick()
    // The queue drains COLUMN_LOAD_CONCURRENCY at a time — the rest wait.
    expect(peak).toBe(COLUMN_LOAD_CONCURRENCY)
    expect(inFlight).toBe(COLUMN_LOAD_CONCURRENCY)

    // Each resolution frees a slot and pumps the next queued table; drain to completion.
    while (resolvers.length > 0) {
      resolvers.splice(0, resolvers.length).forEach((r) => r())
      await tick()
    }
    expect(peak).toBe(COLUMN_LOAD_CONCURRENCY) // never burst past the cap while draining
    expect(Object.keys(schemaStore.getSnapshot(id).tables).sort()).toEqual(
      wanted.map((w) => w.name).sort(),
    )
  })

  it('skips tables already loaded/loading — no duplicate fetch', async () => {
    const id = 'conn-ensure-dedup'
    let calls = 0
    tableSchemaImpl = () => {
      calls += 1
      return Promise.resolve(EMPTY_TABLE_SCHEMA)
    }

    schemaStore.ensureColumns(id, [{ name: 'a' }, { name: 'b' }])
    await tick()
    expect(calls).toBe(2)

    // Re-asking for the same tables plus a new one only fetches the new one.
    schemaStore.ensureColumns(id, [{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    await tick()
    expect(calls).toBe(3)

    // A prior loadTable and ensureColumns share the dedup set.
    schemaStore.loadTable(id, 'd')
    schemaStore.ensureColumns(id, [{ name: 'd' }])
    await tick()
    expect(calls).toBe(4)
  })

  it('discards an older in-flight structure after reloadTable starts a fresh read', async () => {
    const id = 'conn-table-refresh-race'
    const resolvers: Array<(value: DbTableSchema) => void> = []
    tableSchemaImpl = () =>
      new Promise((resolve) => {
        resolvers.push(resolve)
      })

    schemaStore.loadTable(id, 'users', 'public')
    schemaStore.reloadTable(id, 'users', 'public')
    expect(resolvers).toHaveLength(2)

    resolvers[1]!({
      ...EMPTY_TABLE_SCHEMA,
      name: 'users',
      schema: 'public',
      columns: [{ name: 'fresh', dataType: 'text', nullable: true, pk: false }],
    })
    await tick()
    resolvers[0]!({
      ...EMPTY_TABLE_SCHEMA,
      name: 'users',
      schema: 'public',
      columns: [{ name: 'stale', dataType: 'text', nullable: true, pk: false }],
    })
    await tick()

    expect(
      getCachedTable(schemaStore.getSnapshot(id).tables, 'users', 'public')?.columns[0].name,
    ).toBe('fresh')
  })
})

describe('schemaStore — a failed per-object read is visible, not a permanent spinner', () => {
  it('records why the object could not be read and notifies subscribers', async () => {
    const id = 'conn-table-error'
    schemasImpl = () => Promise.resolve(SCHEMAS)
    tableSchemaImpl = () => Promise.reject(new Error('permission denied for table users'))

    const { seen } = watch(id)
    schemaStore.loadTable(id, 'users')
    await tick()

    const snap = schemaStore.getSnapshot(id)
    // Not in `tables` — so every consumer's `getTable` is still undefined. The point is
    // that the REASON is now available alongside it, which is what lets those consumers
    // render an error instead of reading the absence as "still loading".
    expect(getCachedTable(snap.tables, 'users')).toBeUndefined()
    expect(snap.tableErrors.users).toBe('permission denied for table users')
    // The failure must reach live subscribers: a commit-less catch left the last rendered
    // snapshot on screen forever.
    expect(seen.at(-1)?.tableErrors.users).toBe('permission denied for table users')
  })

  it('keys the error the same way as the table, so a schema-qualified read is not lost', async () => {
    const id = 'conn-table-error-qualified'
    schemasImpl = () => Promise.resolve(SCHEMAS)
    tableSchemaImpl = () => Promise.reject(new Error('relation does not exist'))

    // No subscriber on purpose: subscribing kicks off the connection fetch, whose eager
    // prefetch loads the same object under its BARE key (SCHEMAS has one namespace), which
    // would mask whether the qualified call keyed its own failure correctly.
    schemaStore.loadTable(id, 'users', 'public')
    await tick()

    expect(schemaStore.getSnapshot(id).tableErrors.users).toBeUndefined()
    expect(schemaStore.getSnapshot(id).tableErrors[JSON.stringify(['public', 'users'])]).toBe(
      'relation does not exist',
    )
  })

  it('reloadTable clears the recorded failure before re-reading, and a success clears it', async () => {
    const id = 'conn-table-retry'
    schemasImpl = () => Promise.resolve(SCHEMAS)
    tableSchemaImpl = () => Promise.reject(new Error('deadlock detected'))

    const { seen } = watch(id)
    schemaStore.loadTable(id, 'users')
    await tick()
    expect(schemaStore.getSnapshot(id).tableErrors.users).toBe('deadlock detected')

    // Retry: the error has to disappear SYNCHRONOUSLY, before the new request settles —
    // consumers branch on the error ahead of the spinner, so a still-set error would keep
    // the error card up for the whole retry and make the button look inert.
    const named: DbTableSchema = { ...EMPTY_TABLE_SCHEMA, name: 'users' }
    tableSchemaImpl = () => Promise.resolve(named)
    schemaStore.reloadTable(id, 'users')
    expect(schemaStore.getSnapshot(id).tableErrors.users).toBeUndefined()
    expect(seen.at(-1)?.tableErrors.users).toBeUndefined()

    await tick()
    const snap = schemaStore.getSnapshot(id)
    expect(getCachedTable(snap.tables, 'users')).toEqual(named)
    expect(snap.tableErrors.users).toBeUndefined()
  })

  it('drops a stale rejection: a re-read in flight owns the error slot', async () => {
    const id = 'conn-table-stale-reject'
    schemasImpl = () => Promise.resolve(SCHEMAS)

    // First read hangs, then rejects AFTER a reload has bumped the object's revision.
    let rejectFirst: (cause: Error) => void = () => {}
    tableSchemaImpl = () => new Promise<DbTableSchema>((_res, rej) => (rejectFirst = rej))
    watch(id)
    schemaStore.loadTable(id, 'users')
    await tick()

    const named: DbTableSchema = { ...EMPTY_TABLE_SCHEMA, name: 'users' }
    tableSchemaImpl = () => Promise.resolve(named)
    schemaStore.reloadTable(id, 'users')
    await tick()
    expect(getCachedTable(schemaStore.getSnapshot(id).tables, 'users')).toEqual(named)

    // The abandoned attempt must not stamp an error over the fresh success.
    rejectFirst(new Error('cancelled by newer read'))
    await tick()
    const snap = schemaStore.getSnapshot(id)
    expect(snap.tableErrors.users).toBeUndefined()
    expect(getCachedTable(snap.tables, 'users')).toEqual(named)
  })

  it('a connection-wide reload forgets per-object failures', async () => {
    const id = 'conn-table-error-reload'
    schemasImpl = () => Promise.resolve(SCHEMAS)
    tableSchemaImpl = () => Promise.reject(new Error('io error'))

    watch(id)
    schemaStore.loadTable(id, 'users')
    await tick()
    expect(schemaStore.getSnapshot(id).tableErrors.users).toBe('io error')

    tableSchemaImpl = () => Promise.resolve(EMPTY_TABLE_SCHEMA)
    schemaStore.reload(id)
    expect(schemaStore.getSnapshot(id).tableErrors).toEqual({})
  })
})

describe('schemaStore eager prefetch — one shared concurrency budget', () => {
  /** A connection with more tables than the prefetch cap, in one namespace. */
  const wideSchemas = (count: number): DbSchemas => ({
    main: Array.from({ length: count }, (_, i) => ({ name: `t${i}`, type: 'table' as const })),
  })

  it('does not flood the driver when a connection with many tables opens', async () => {
    const id = 'conn-prefetch-cap'
    let inFlight = 0
    let peak = 0
    const resolvers: Array<() => void> = []
    schemasImpl = () => Promise.resolve(wideSchemas(40))
    tableSchemaImpl = () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      return new Promise((resolve) => {
        resolvers.push(() => {
          inFlight -= 1
          resolve(EMPTY_TABLE_SCHEMA)
        })
      })
    }

    // Subscribing is what a sidebar mount does: it fetches the tree, and the tree's arrival
    // kicks off the eager column prefetch.
    watch(id)
    await tick()

    // The prefetch used to call loadTable in a bare loop, so ALL of it went out at once —
    // 150 concurrent introspections on a connection whose PostgreSQL pool is max:1, with the
    // browser's ~6-per-host limit queueing every other request in the app behind them. It
    // now shares the same budget as the search-driven loader.
    expect(peak).toBeLessThanOrEqual(COLUMN_LOAD_CONCURRENCY)

    while (resolvers.length > 0) {
      resolvers.splice(0, resolvers.length).forEach((r) => r())
      await tick()
    }
    // Capping is not skipping: every table still gets its columns.
    expect(peak).toBeLessThanOrEqual(COLUMN_LOAD_CONCURRENCY)
    expect(Object.keys(schemaStore.getSnapshot(id).tables)).toHaveLength(40)
  })

  it('stops at the prefetch cap, and an interactive read still goes out immediately', async () => {
    const id = 'conn-prefetch-limit'
    let inFlight = 0
    const resolvers: Array<() => void> = []
    schemasImpl = () => Promise.resolve(wideSchemas(200))
    tableSchemaImpl = () => {
      inFlight += 1
      return new Promise((resolve) => {
        resolvers.push(() => {
          inFlight -= 1
          resolve(EMPTY_TABLE_SCHEMA)
        })
      })
    }

    watch(id)
    await tick()
    const queuedByPrefetch = inFlight
    expect(queuedByPrefetch).toBeLessThanOrEqual(COLUMN_LOAD_CONCURRENCY)

    // A user expanding a node must not wait behind a 150-item prefetch: loadTable is the
    // interactive path and stays direct.
    schemaStore.loadTable(id, 'picked-by-hand')
    await tick()
    expect(inFlight).toBe(queuedByPrefetch + 1)

    while (resolvers.length > 0) {
      resolvers.splice(0, resolvers.length).forEach((r) => r())
      await tick()
    }
    // PREFETCH_CAP tables, plus the one the user asked for by hand.
    expect(Object.keys(schemaStore.getSnapshot(id).tables)).toHaveLength(151)
  })
})

describe('mergeColumnSources', () => {
  it('lets a full structure win over the catalog entry for the same key', async () => {
    const { mergeColumnSources } = await import('./schemaKey')
    const merged = mergeColumnSources<{ columns: string[] }>(
      { a: { columns: ['thin'] }, b: { columns: ['b'] } },
      { a: { columns: ['full'] } },
    )
    expect(merged).toEqual({ a: { columns: ['full'] }, b: { columns: ['b'] } })
  })
})
