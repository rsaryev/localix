import { beforeEach, describe, expect, test } from 'bun:test'
import { createRunScopeCache } from './run-scope'
import { __resetCapabilityRevision, bumpCapabilityRevision } from '../../capabilities/revision'

const scope = { userId: 'u1', projectId: 'PRJ-1', cwd: '/repo', agentId: 'builtin:localix' }

describe('run scope cache', () => {
  beforeEach(__resetCapabilityRevision)

  /**
   * The property the whole module exists for. A parent and its children share
   * (userId, projectId, cwd) — a child shares the parent's directory by design — so the
   * filesystem walk and plugin discovery must happen ONCE for the group, not once per
   * run. One session ran it 1267 times.
   */
  test('a second run in the same scope does not reload', async () => {
    const cache = createRunScopeCache<number>()
    let loads = 0
    const load = async () => ++loads
    expect(await cache.resolve(scope, load)).toBe(1)
    expect(await cache.resolve(scope, load)).toBe(1)
    expect(await cache.resolve(scope, load)).toBe(1)
    expect(loads).toBe(1)
  })

  test('a different cwd is a different scope', async () => {
    const cache = createRunScopeCache<string>()
    expect(await cache.resolve(scope, async () => 'a')).toBe('a')
    expect(await cache.resolve({ ...scope, cwd: '/other' }, async () => 'b')).toBe('b')
  })

  test('a different project is a different scope', async () => {
    const cache = createRunScopeCache<string>()
    expect(await cache.resolve(scope, async () => 'a')).toBe('a')
    expect(await cache.resolve({ ...scope, projectId: '' }, async () => 'b')).toBe('b')
  })

  test('a different user is a different scope', async () => {
    const cache = createRunScopeCache<string>()
    expect(await cache.resolve(scope, async () => 'a')).toBe('a')
    expect(await cache.resolve({ ...scope, userId: 'u2' }, async () => 'b')).toBe('b')
  })

  /**
   * The agent joined the key when rules stopped composing a chain: an agent's own list is
   * the whole policy now, so it decides which plugins load. Sharing an entry across roles
   * would hand one role the plugins another role was allowed.
   */
  test('a different agent is a different scope', async () => {
    const cache = createRunScopeCache<string>()
    expect(await cache.resolve(scope, async () => 'a')).toBe('a')
    expect(await cache.resolve({ ...scope, agentId: 'builtin:qa' }, async () => 'b')).toBe('b')
  })

  /**
   * The invalidation half, and the reason the revision is part of the lookup rather than
   * a separate `invalidate()` call someone has to remember: enabling a plugin bumps the
   * process-wide counter, which makes every previous entry unmatchable. Serving a stale
   * enabled set to the next run is precisely the "I disabled it but its tools are still
   * there" bug this work is removing.
   */
  test('a capability change is visible to the very next run', async () => {
    const cache = createRunScopeCache<number>()
    let loads = 0
    const load = async () => ++loads
    expect(await cache.resolve(scope, load)).toBe(1)
    bumpCapabilityRevision()
    expect(await cache.resolve(scope, load)).toBe(2)
    // …and the new value is then cached in its turn.
    expect(await cache.resolve(scope, load)).toBe(2)
    expect(loads).toBe(2)
  })

  test('a failed load is not cached', async () => {
    const cache = createRunScopeCache<string>()
    // No `await`: bun's `.rejects` matcher returns undefined and enforces the assertion
    // itself (falsified — a promise that RESOLVES fails here with or without one).
    expect(
      cache.resolve(scope, async () => {
        throw new Error('discovery exploded')
      }),
    ).rejects.toThrow('discovery exploded')
    // A cached rejection would make one bad scan poison every later run in the scope
    // until a capability changed — far worse than repeating the scan.
    expect(await cache.resolve(scope, async () => 'recovered')).toBe('recovered')
  })

  test('explicit invalidation drops one scope and leaves its siblings', async () => {
    const cache = createRunScopeCache<string>()
    await cache.resolve(scope, async () => 'a')
    await cache.resolve({ ...scope, cwd: '/other' }, async () => 'b')
    cache.invalidate(scope)
    expect(await cache.resolve(scope, async () => 'a2')).toBe('a2')
    expect(await cache.resolve({ ...scope, cwd: '/other' }, async () => 'b2')).toBe('b')
  })

  test('is bounded — an unbounded map would leak across a long-lived process', async () => {
    const cache = createRunScopeCache<string>(2)
    await cache.resolve({ ...scope, cwd: '/a' }, async () => 'a')
    await cache.resolve({ ...scope, cwd: '/b' }, async () => 'b')
    await cache.resolve({ ...scope, cwd: '/c' }, async () => 'c')
    expect(cache.size()).toBeLessThanOrEqual(2)
  })
})
