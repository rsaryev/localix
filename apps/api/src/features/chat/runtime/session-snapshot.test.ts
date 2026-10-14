import { describe, expect, test } from 'bun:test'
import { createSessionSnapshotCache } from './session-snapshot'

interface Ctx {
  memory: string
}

describe('createSessionSnapshotCache', () => {
  test('second run reuses the frozen snapshot even though fresh data changed', () => {
    const cache = createSessionSnapshotCache<Ctx>()
    // First run: miss → freeze fresh load.
    expect(cache.get('s1', '')).toBeUndefined()
    cache.set('s1', '', { memory: 'old notes' })
    // Mid-session the repo data changes ("new notes" on disk/DB)…
    // …but the second run still gets the frozen strings.
    expect(cache.get('s1', '')).toEqual({ memory: 'old notes' })
  })

  test('a new context boundary marker invalidates the snapshot', () => {
    const cache = createSessionSnapshotCache<Ctx>()
    cache.set('s1', 'boundary-a', { memory: 'frozen' })
    expect(cache.get('s1', 'boundary-a')).toEqual({ memory: 'frozen' })
    // /clear or /compact inserted a new boundary message → marker changes → miss,
    // and the stale entry is dropped.
    expect(cache.get('s1', 'boundary-b')).toBeUndefined()
    expect(cache.size()).toBe(0)
  })

  test('explicit invalidate() (compaction) drops the entry', () => {
    const cache = createSessionSnapshotCache<Ctx>()
    cache.set('s1', '', { memory: 'frozen' })
    cache.invalidate('s1')
    expect(cache.get('s1', '')).toBeUndefined()
    // Invalidate of an unknown session is a no-op.
    cache.invalidate('nope')
  })

  test('evicts the least-recently-used entry beyond maxEntries', () => {
    const cache = createSessionSnapshotCache<Ctx>({ maxEntries: 3 })
    cache.set('a', '', { memory: 'a' })
    cache.set('b', '', { memory: 'b' })
    cache.set('c', '', { memory: 'c' })
    // Touch 'a' so 'b' becomes the oldest.
    expect(cache.get('a', '')).toEqual({ memory: 'a' })
    cache.set('d', '', { memory: 'd' })
    expect(cache.size()).toBe(3)
    expect(cache.get('b', '')).toBeUndefined()
    expect(cache.get('a', '')).toEqual({ memory: 'a' })
    expect(cache.get('c', '')).toEqual({ memory: 'c' })
    expect(cache.get('d', '')).toEqual({ memory: 'd' })
  })

  test('disabled cache is inert (LOCALIX_FREEZE_CONTEXT=0 path)', () => {
    const cache = createSessionSnapshotCache<Ctx>({ enabled: false })
    cache.set('s1', '', { memory: 'frozen' })
    expect(cache.get('s1', '')).toBeUndefined()
    expect(cache.size()).toBe(0)
    expect(cache.enabled).toBe(false)
  })

  test('set() for an existing session replaces the snapshot and marker', () => {
    const cache = createSessionSnapshotCache<Ctx>()
    cache.set('s1', 'a', { memory: 'one' })
    cache.set('s1', 'b', { memory: 'two' })
    expect(cache.size()).toBe(1)
    expect(cache.get('s1', 'a')).toBeUndefined()
    // get('s1','a') dropped the entry (marker mismatch) — re-set and verify 'b'.
    cache.set('s1', 'b', { memory: 'two' })
    expect(cache.get('s1', 'b')).toEqual({ memory: 'two' })
  })

  test('rejects a capacity that could disable eviction', () => {
    for (const maxEntries of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => createSessionSnapshotCache({ maxEntries })).toThrow('positive safe integer')
    }
  })
})
