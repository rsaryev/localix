import { describe, expect, it } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DbConnectionConfig } from './contracts'
import type { DbDriver } from './drivers/port'
import { createDatabaseService } from './service'
import { createConnectionStore } from './store'

/**
 * Re-entrancy pin: `reconnect` against an id that is ALREADY live must close the stale
 * driver before swapping in the fresh one — the same close-before-replace discipline as
 * `connect`/`updateConfig`. Without it the prior driver + SSH tunnel leaked open when
 * reconnect re-entered a live id (a health-drop race, a double-fired auto-reconnect
 * effect, or two clients). Bun-observed.
 */
describe('reconnect close-before-replace', () => {
  const sqliteConfig = { dialect: 'sqlite', file: '/x.db' } as unknown as DbConnectionConfig

  const trackingDrivers = () => {
    let serial = 0
    const closed = new Set<number>()
    const opened = new Set<number>()
    const createDriver = (): DbDriver => {
      const id = ++serial
      opened.add(id)
      return {
        getFlags: () => ({ dialect: 'sqlite', kind: 'sql', supportsMultipleSchemas: false }),
        query: async () => ({ columns: [], rows: [], rowsAffected: 0, durationMs: 0 }),
        close: async () => {
          closed.add(id)
        },
        schemas: async () => ({}),
        tableSchema: async () => ({}),
      } as unknown as DbDriver
    }
    return { opened, closed, createDriver }
  }

  it('closes the prior live driver when reconnect re-enters a live id', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'db-reconnect-'))
    const { opened, closed, createDriver } = trackingDrivers()
    const svc = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver,
    })
    const info = await svc.connect('u1', { config: sqliteConfig })
    // Reconnect while the connection is still live — driver #1 must not leak.
    await svc.reconnect('u1', info.id)
    expect(opened.size).toBe(2) // #1 from connect, #2 from reconnect
    expect(closed.has(1)).toBe(true) // the stale driver was closed, not leaked
  })
})
