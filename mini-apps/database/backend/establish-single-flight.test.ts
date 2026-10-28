import { describe, expect, it } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DbConnectionConfig } from './contracts'
import type { DbDriver } from './drivers/port'
import { createDatabaseService } from './service'
import { createConnectionStore, type ConnectionStore } from './store'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

/**
 * Concurrency pin for the establish/live-map swap. The single-run-while-live leak was fixed
 * (close-before-replace); this covers the CONCURRENT case: two `reconnect`/`connect`/
 * `updateConfig` for the SAME id each `establish()` a driver, then the later `liveMap.set`
 * overwrites the earlier live entry WITHOUT closing it — leaking the DB pool + any SSH tunnel.
 *
 * Guarantee under test: at most ONE live driver per id at rest, and NO opened driver is ever
 * dropped from the map without being closed. With single-flight on establish, concurrent
 * callers requesting the same id+config share ONE establish (exactly one extra driver opened);
 * whatever count is opened, `opened - closed === 1` (only the current live driver survives).
 * Bun-observed: before the fix this reddened (multiple drivers opened, only one closed → leak).
 */
describe('establish single-flight (concurrent connect/reconnect/updateConfig)', () => {
  const sqliteConfig = { dialect: 'sqlite', file: '/x.db' } as unknown as DbConnectionConfig
  const otherConfig = { dialect: 'sqlite', file: '/y.db' } as unknown as DbConnectionConfig

  /** Fake driver factory that tracks every open + close and yields on probe (SELECT 1) so
   *  concurrent establishes genuinely interleave (the leak needs the await gap). */
  const trackingDrivers = () => {
    let serial = 0
    const opened = new Set<number>()
    const closed = new Set<number>()
    const createDriver = (): DbDriver => {
      const id = ++serial
      opened.add(id)
      return {
        getFlags: () => ({ dialect: 'sqlite', kind: 'sql', supportsMultipleSchemas: false }),
        // Async so `probeDriver` (SELECT 1) suspends — forces the concurrent establishes to race.
        query: async () => {
          await Promise.resolve()
          return { columns: [], rows: [], rowsAffected: 0, durationMs: 0 }
        },
        close: async () => {
          await Promise.resolve()
          closed.add(id)
        },
        schemas: async () => ({}),
        tableSchema: async () => ({}),
      } as unknown as DbDriver
    }
    /** Drivers opened but never closed AND not the last one still live. */
    const leaked = () => [...opened].filter((n) => !closed.has(n))
    return { opened, closed, leaked, createDriver }
  }

  const mkService = async (createDriver: () => DbDriver) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-sf-'))
    return createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
  }

  it('two concurrent connects to a new target create one saved id and one driver', async () => {
    const { opened, closed, createDriver } = trackingDrivers()
    const svc = await mkService(createDriver)
    const [first, second] = await Promise.all([
      svc.connect('u1', { config: sqliteConfig }),
      svc.connect('u1', { config: sqliteConfig }),
    ])

    expect(first.id).toBe(second.id)
    expect(await svc.list('u1')).toHaveLength(1)
    expect(opened.size).toBe(1)
    expect(closed.size).toBe(0)
  })

  it('serializes different credentials for one new target without creating duplicate ids', async () => {
    const { opened, closed, createDriver } = trackingDrivers()
    const svc = await mkService(createDriver)
    const firstConfig = {
      dialect: 'postgres',
      url: 'postgres://user:first@db.example/app',
    } as DbConnectionConfig
    const secondConfig = {
      dialect: 'postgres',
      url: 'postgres://user:second@db.example/app',
    } as DbConnectionConfig
    const [first, second] = await Promise.all([
      svc.connect('u1', { config: firstConfig }),
      svc.connect('u1', { config: secondConfig }),
    ])

    expect(first.id).toBe(second.id)
    expect(await svc.list('u1')).toHaveLength(1)
    expect(await svc.getConfig('u1', first.id)).toMatchObject({ config: secondConfig })
    expect(opened.size).toBe(2)
    expect(closed.size).toBe(1)
  })

  it('two concurrent reconnects for the same id open ONE driver, leak ZERO', async () => {
    const { opened, closed, createDriver } = trackingDrivers()
    const svc = await mkService(createDriver)
    const info = await svc.connect('u1', { config: sqliteConfig }) // opens #1
    const before = opened.size

    await Promise.all([svc.reconnect('u1', info.id), svc.reconnect('u1', info.id)])

    // Single-flight: the two concurrent reconnects share ONE establish → exactly one new driver.
    expect(opened.size - before).toBe(1)
    // No leak: exactly one driver survives (the live one); everything else is closed.
    expect(opened.size - closed.size).toBe(1)
  })

  it('connect + updateConfig racing the same id never leak a driver', async () => {
    const { opened, closed, leaked, createDriver } = trackingDrivers()
    const svc = await mkService(createDriver)
    const info = await svc.connect('u1', { config: sqliteConfig }) // opens #1

    // A reconnect (saved config) racing an updateConfig (a DIFFERENT config) for the same id:
    // they may each establish, but the swap must stay leak-safe — only the winner survives.
    await Promise.all([
      svc.reconnect('u1', info.id),
      svc.updateConfig('u1', info.id, { config: otherConfig }),
    ])

    // At rest: exactly one live driver, zero leaked.
    expect(leaked().length).toBe(1) // the sole survivor is "not closed" — that's the live one
    expect(opened.size - closed.size).toBe(1)
  })

  it('remove landing mid-establish leaves no orphaned live driver', async () => {
    const { opened, closed, createDriver } = trackingDrivers()
    const svc = await mkService(createDriver)
    const info = await svc.connect('u1', { config: sqliteConfig }) // opens #1

    // Kick off a reconnect (opens a new driver) and immediately remove the connection.
    await Promise.all([svc.reconnect('u1', info.id).catch(() => {}), svc.remove('u1', info.id)])

    // The connection is gone → NOTHING should stay live. Every opened driver is closed.
    expect(opened.size - closed.size).toBe(0)
    expect(await svc.list('u1')).toHaveLength(0)
  })

  it('closeAll vetoes and drains an establish that is still probing', async () => {
    let probeStarted = () => {}
    const probeReached = new Promise<void>((resolve) => {
      probeStarted = resolve
    })
    let releaseProbe = () => {}
    const probeMayFinish = new Promise<void>((resolve) => {
      releaseProbe = resolve
    })
    let opened = 0
    let closed = 0
    const createDriver = (): DbDriver => {
      opened += 1
      return {
        getFlags: () => ({ dialect: 'sqlite', kind: 'sql', supportsMultipleSchemas: false }),
        async query() {
          probeStarted()
          await probeMayFinish
          return { columns: [], rows: [], durationMs: 0 }
        },
        async close() {
          closed += 1
        },
        schemas: async () => ({}),
        tableSchema: async () => ({}),
      } as unknown as DbDriver
    }
    const svc = await mkService(createDriver)
    const connecting = svc.connect('u1', { config: sqliteConfig })
    await probeReached
    const closing = svc.closeAll()
    releaseProbe()

    const [info] = await Promise.all([connecting, closing])
    expect(info.connected).toBe(false)
    expect(opened).toBe(1)
    expect(closed).toBe(1)
  })

  it('remove is a persistence barrier against a config edit that arrives during teardown', async () => {
    const { opened, closed, createDriver } = trackingDrivers()
    const dir = await mkdtemp(path.join(tmpdir(), 'db-sf-'))
    const baseStore = createConnectionStore({ dir: path.join(dir, 'store') })
    let delayRemove = false
    let removeStarted = () => {}
    const removeReached = new Promise<void>((resolve) => {
      removeStarted = resolve
    })
    let releaseRemove = () => {}
    const removeMayFinish = new Promise<void>((resolve) => {
      releaseRemove = resolve
    })
    const store: ConnectionStore = {
      list: (userId) => baseStore.list(userId),
      get: (userId, id) => baseStore.get(userId, id),
      create: (userId, entity) => baseStore.create(userId, entity),
      updateById: (userId, id, patch) => baseStore.updateById(userId, id, patch),
      async remove(userId, id) {
        if (delayRemove) {
          removeStarted()
          await removeMayFinish
        }
        return baseStore.remove(userId, id)
      },
    }
    const svc = createDatabaseService({ store, createDriver })
    const info = await svc.connect('u1', { config: sqliteConfig })

    delayRemove = true
    const removal = svc.remove('u1', info.id)
    await removeReached
    const update = svc.updateConfig('u1', info.id, { config: otherConfig })
    // Give an incorrectly unbarriered edit enough time to read the still-present saved row,
    // establish a replacement, and persist it while remove() is paused in the store.
    await turns()
    releaseRemove()

    expect(await removal).toBe(true)
    expect(await update).toBeNull()
    expect(await svc.list('u1')).toEqual([])
    expect(await svc.query('u1', info.id, 'SELECT 1')).toBeNull()
    expect(opened.size).toBe(1)
    expect(closed.size).toBe(1)
  })

  it('disconnect during an update store write cannot resurrect the closed replacement', async () => {
    const { opened, closed, createDriver } = trackingDrivers()
    const dir = await mkdtemp(path.join(tmpdir(), 'db-sf-'))
    const baseStore = createConnectionStore({ dir: path.join(dir, 'store') })
    let delayUpdate = false
    let updateStarted = () => {}
    const updateReached = new Promise<void>((resolve) => {
      updateStarted = resolve
    })
    let releaseUpdate = () => {}
    const updateMayFinish = new Promise<void>((resolve) => {
      releaseUpdate = resolve
    })
    const store: ConnectionStore = {
      list: (userId) => baseStore.list(userId),
      get: (userId, id) => baseStore.get(userId, id),
      create: (userId, entity) => baseStore.create(userId, entity),
      remove: (userId, id) => baseStore.remove(userId, id),
      async updateById(userId, id, patch) {
        if (delayUpdate) {
          updateStarted()
          await updateMayFinish
        }
        return baseStore.updateById(userId, id, patch)
      },
    }
    const svc = createDatabaseService({ store, createDriver })
    const info = await svc.connect('u1', { config: sqliteConfig })

    delayUpdate = true
    const update = svc.updateConfig('u1', info.id, { config: otherConfig })
    await updateReached
    expect(await svc.disconnect('u1', info.id)).toBe(true)
    releaseUpdate()

    expect(await update).toMatchObject({ connected: false })
    expect(await svc.list('u1')).toEqual([
      expect.objectContaining({ id: info.id, connected: false }),
    ])
    expect(opened.size - closed.size).toBe(0)
  })

  it('reconnect cannot replace a pending config edit with the stale saved target', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-sf-'))
    const baseStore = createConnectionStore({ dir: path.join(dir, 'store') })
    let delayUpdate = false
    let updateStarted = () => {}
    const updateReached = new Promise<void>((resolve) => {
      updateStarted = resolve
    })
    let releaseUpdate = () => {}
    const updateMayFinish = new Promise<void>((resolve) => {
      releaseUpdate = resolve
    })
    const store: ConnectionStore = {
      list: (userId) => baseStore.list(userId),
      get: (userId, id) => baseStore.get(userId, id),
      create: (userId, entity) => baseStore.create(userId, entity),
      remove: (userId, id) => baseStore.remove(userId, id),
      async updateById(userId, id, patch) {
        if (delayUpdate) {
          updateStarted()
          await updateMayFinish
        }
        return baseStore.updateById(userId, id, patch)
      },
    }
    const createDriver = (config: DbConnectionConfig): DbDriver => {
      const file = 'file' in config ? config.file : ''
      let closed = false
      return {
        getFlags: () => ({ dialect: 'sqlite', kind: 'sql', supportsMultipleSchemas: false }),
        async query() {
          if (closed) throw new Error('closed driver')
          return {
            columns: [{ name: 'file' }],
            rows: [[file]],
            durationMs: 0,
          }
        },
        async close() {
          closed = true
        },
        schemas: async () => ({}),
        tableSchema: async () => ({}),
      } as unknown as DbDriver
    }
    const svc = createDatabaseService({ store, createDriver })
    const info = await svc.connect('u1', { config: sqliteConfig })

    delayUpdate = true
    const update = svc.updateConfig('u1', info.id, { config: otherConfig })
    await updateReached
    const reconnect = svc.reconnect('u1', info.id)
    releaseUpdate()
    await Promise.all([update, reconnect])

    expect(await svc.getConfig('u1', info.id)).toMatchObject({
      config: { file: '/y.db' },
    })
    expect((await svc.query('u1', info.id, 'SELECT 1'))?.result.rows).toEqual([['/y.db']])
  })
})
