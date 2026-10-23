import { describe, expect, it } from 'bun:test'

import { createConnectionRegistry } from './connection-registry'
import type { ExchangeBackend } from './backend'
import type { TradingConnectionConfig } from './contracts'
import type { SavedTradingConnection, TradingConnectionStore } from './store'
import { exchangeInfo, stubExchangeBackend } from './testing/test-fixtures'

/**
 * CHARACTERIZATION of the driver-lifecycle rules that used to be reachable only THROUGH the
 * whole trading service — which is why the socket leak below went unnoticed until it was
 * measured against a live venue. Extracted, they can just be asserted.
 */

interface Built {
  config: TradingConnectionConfig
  closed: boolean
  probeFails?: boolean
}

function fakes(saved: SavedTradingConnection[] = []) {
  const built: Built[] = []
  const rows = new Map(saved.map((c) => [c.id, c]))

  const store: TradingConnectionStore = {
    list: async (_u) => [...rows.values()],
    get: async (_u, id) => rows.get(id) ?? null,
    create: async (_u, conn) => void rows.set(conn.id, conn),
    updateById: async (_u, id, patch) => {
      const prev = rows.get(id)
      if (!prev) return null
      const merged = { ...prev, ...patch, id: prev.id } as SavedTradingConnection
      rows.set(id, merged)
      return merged
    },
    remove: async (_u, id) => void rows.delete(id),
  }

  const createBackend = async (config: TradingConnectionConfig): Promise<ExchangeBackend> => {
    const entry: Built = { config, closed: false }
    built.push(entry)
    // Only the three lifecycle methods the registry exercises are stubbed; every other port
    // method throws, so an unexpected call is a loud failure rather than an `undefined`.
    return stubExchangeBackend({
      describe: () => exchangeInfo({ id: config.exchangeId, name: config.exchangeId }),
      probe: async () => {
        if (entry.probeFails) throw new Error('probe failed')
        return { credentialsChecked: false }
      },
      close: async () => void (entry.closed = true),
    })
  }

  return { store, createBackend, built, rows }
}

const conn = (id: string): SavedTradingConnection => ({
  id,
  name: id,
  createdAt: 0,
  config: { exchangeId: 'fake' } as TradingConnectionConfig,
})

describe('createConnectionRegistry — one driver per connection, always closable', () => {
  it('single-flights concurrent first-accesses into ONE driver', async () => {
    // THE BUG THIS EXISTS FOR: without the memo, three concurrent readers each build a full
    // driver and only the last is registered — the other two are live exchange clients that
    // nothing can ever close. Measured against a venue: 3 built, closeAll closed 1.
    const { store, createBackend, built } = fakes([conn('c1')])
    const registry = createConnectionRegistry({ store, createBackend })

    const [a, b, c] = await Promise.all([
      registry.require('u', 'c1'),
      registry.require('u', 'c1'),
      registry.require('u', 'c1'),
    ])

    expect(built).toHaveLength(1)
    expect(a).toBe(b)
    expect(b).toBe(c)

    await registry.closeAll()
    expect(built.filter((x) => x.closed)).toHaveLength(1)
  })

  it('closes — never registers — a driver whose connection was removed mid-establish', async () => {
    const { store, createBackend, built, rows } = fakes([conn('c1')])
    const registry = createConnectionRegistry({ store, createBackend })

    const pending = registry.require('u', 'c1')
    rows.delete('c1') // a concurrent `remove` lands while we are establishing

    expect(pending).rejects.toThrow(/No trading connection/)
    expect(built).toHaveLength(1)
    expect(built[0]!.closed).toBe(true) // built, then closed — not orphaned, not resurrected
    expect(registry.isLive('u', 'c1')).toBe(false)
  })

  it('closes a driver whose probe rejects, and drops the memo so the next caller retries', async () => {
    const { store } = fakes([conn('c1')])
    let attempts = 0
    const closed: boolean[] = []
    const registry = createConnectionRegistry({
      store,
      createBackend: async () => {
        const i = attempts++
        closed.push(false)
        return stubExchangeBackend({
          describe: () => exchangeInfo(),
          // Only the FIRST attempt's probe fails.
          probe: async () => {
            if (i === 0) throw new Error('probe failed')
            return { credentialsChecked: false }
          },
          close: async () => void (closed[i] = true),
        })
      },
    })

    expect(registry.require('u', 'c1')).rejects.toThrow(/probe failed/)
    expect(closed[0]).toBe(true) // a half-open driver never escapes a rejected probe

    // A memo that kept the rejection would make this throw forever, and the connection would
    // stay permanently unusable after one transient venue hiccup.
    expect(registry.require('u', 'c1')).resolves.toBeDefined()
    expect(attempts).toBe(2)
  })

  it('teardown is idempotent and evicts even when close() throws', async () => {
    const { store, built } = fakes([conn('c1')])
    let closes = 0
    const registry = createConnectionRegistry({
      store,
      createBackend: async () =>
        stubExchangeBackend({
          describe: () => exchangeInfo(),
          probe: async () => ({ credentialsChecked: false }),
          close: async () => {
            closes++
            throw new Error('close blew up')
          },
        }),
    })

    await registry.require('u', 'c1')
    expect(registry.close('u', 'c1')).rejects.toThrow(/close blew up/)
    // Evicted despite the throw — a driver that cannot close must not stay in the registry
    // pretending to be usable.
    expect(registry.isLive('u', 'c1')).toBe(false)
    await registry.close('u', 'c1') // idempotent: a second close is a no-op, not a second close()
    expect(closes).toBe(1)
    void built
  })

  it('serves an ephemeral public profile without a saved connection', async () => {
    const { store, createBackend } = fakes([])
    const registry = createConnectionRegistry({ store, createBackend })

    const saved = await registry.requireSaved('u', 'public:binance')
    expect(saved.id).toBe('public:binance')
    expect(saved.config.exchangeId).toBe('binance')

    // And it establishes, even though the store has nothing — the mid-establish removal guard
    // must not fire for an id that was never saved in the first place.
    expect(registry.require('u', 'public:binance')).resolves.toBeDefined()
  })

  it('refuses an id that is neither saved nor a public profile', async () => {
    const { store, createBackend } = fakes([])
    const registry = createConnectionRegistry({ store, createBackend })
    expect(registry.require('u', 'nope')).rejects.toThrow(/No trading connection/)
  })
})
