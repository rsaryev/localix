import { describe, expect, test } from 'bun:test'

import { createActiveRuns, whenRunReleased } from './active-runs'

describe('active run registry', () => {
  test('announces a deleted, replaced or cleared slot, and nothing else', () => {
    const runs = createActiveRuns()
    const released: string[] = []
    const off = runs.onRelease!((sessionId) => released.push(sessionId))
    const first = new AbortController()
    runs.set('a', first)
    runs.set('a', first)
    runs.set('a', new AbortController())
    runs.delete('a')
    runs.delete('a')
    runs.set('b', new AbortController())
    runs.clear()
    off()
    runs.set('c', new AbortController())
    runs.delete('c')
    expect(released).toEqual(['a', 'a', 'b'])
  })

  test('a release of another session leaves the wait pending', async () => {
    const runs = createActiveRuns()
    const run = new AbortController()
    runs.set('a', run)
    runs.set('b', new AbortController())
    let settled: boolean | undefined
    const wait = whenRunReleased(runs, 'a', run, 600_000).then((value) => (settled = value))
    runs.delete('b')
    await Promise.resolve()
    expect(settled).toBeUndefined()
    runs.set('a', new AbortController())
    await wait
    expect(settled).toBe(true)
  })

  test('a plain map without announcements is read once at the bound', async () => {
    const run = new AbortController()
    const runs = new Map([['a', run]])
    expect(await whenRunReleased(runs, 'a', run, 0)).toBe(false)
    runs.delete('a')
    expect(await whenRunReleased(runs, 'a', run, 0)).toBe(true)
  })
})
