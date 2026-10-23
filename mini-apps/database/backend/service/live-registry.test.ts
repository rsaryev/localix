import { describe, expect, it } from 'bun:test'
import type { DbDriver, DriverFlags } from '../drivers/port'
import type { LiveEntry } from './live-entry'
import { createLiveRegistry } from './live-registry'

function liveEntry(instance: number, closed: Set<number>): LiveEntry {
  const driver = {
    async close() {
      closed.add(instance)
    },
  } as unknown as DbDriver
  return {
    driver,
    flags: {} as DriverFlags,
    readonly: false,
    serverReadOnly: false,
    inflight: new Map(),
    inflightOperations: new Set(),
    inflightMetadata: new Set(),
    closing: false,
    recentQueries: [],
  }
}

describe('live registry composite identities', () => {
  it('does not coalesce different user/id pairs whose old space-delimited keys collided', async () => {
    let opened = 0
    const closed = new Set<number>()
    const registry = createLiveRegistry(async () => {
      const instance = ++opened
      await Promise.resolve()
      return liveEntry(instance, closed)
    })
    const config = { dialect: 'sqlite' as const, file: ':memory:' }

    const [left, right] = await Promise.all([
      registry.swapLive('a', 'b c', config, 0),
      registry.swapLive('a b', 'c', config, 0),
    ])

    expect(opened).toBe(2)
    expect(left).not.toBe(right)
    expect(registry.liveOf('a', 'b c')).toBe(left)
    expect(registry.liveOf('a b', 'c')).toBe(right)
    await registry.closeAll()
    expect(closed.size).toBe(2)
  })

  it('keeps teardown generations isolated for the same colliding pairs', async () => {
    const registry = createLiveRegistry(async () => {
      throw new Error('not used')
    })

    expect(await registry.teardownLive('a', 'b c')).toBe(false)
    expect(registry.genOf('a', 'b c')).toBe(1)
    expect(registry.genOf('a b', 'c')).toBe(0)
  })
})
