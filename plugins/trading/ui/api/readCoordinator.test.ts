import { describe, expect, test } from 'bun:test'
import { createReadCoordinator } from './readCoordinator'

describe('read coordinator', () => {
  test('shares one in-flight read and briefly reuses its settled value', async () => {
    let calls = 0
    let now = 100
    const reads = createReadCoordinator(() => now)
    const load = async () => ++calls

    const first = reads.read('markets', { freshForMs: 1_000 }, load)
    const second = reads.read('markets', { freshForMs: 1_000 }, load)

    expect(first).toBe(second)
    expect(await Promise.all([first, second])).toEqual([1, 1])
    expect(await reads.read('markets', { freshForMs: 1_000 }, load)).toBe(1)
    expect(calls).toBe(1)

    now = 1_101
    expect(await reads.read('markets', { freshForMs: 1_000 }, load)).toBe(2)
  })

  test('single-flight mode never serves a settled value', async () => {
    let calls = 0
    const reads = createReadCoordinator()
    const load = async () => ++calls

    const a = reads.read('quote', {}, load)
    const b = reads.read('quote', {}, load)
    expect(await Promise.all([a, b])).toEqual([1, 1])
    expect(await reads.read('quote', {}, load)).toBe(2)
  })

  test('a failure is retried and force bypasses a cached or older in-flight read', async () => {
    const reads = createReadCoordinator()
    let calls = 0
    expect(
      reads.read('catalog', { freshForMs: 60_000 }, async () => {
        calls += 1
        throw new Error('offline')
      }),
    ).rejects.toThrow('offline')
    expect(await reads.read('catalog', { freshForMs: 60_000 }, async () => ++calls)).toBe(2)

    let releaseOld!: (value: number) => void
    const old = reads.read(
      'markets',
      { freshForMs: 60_000 },
      () => new Promise<number>((resolve) => (releaseOld = resolve)),
    )
    const forced = reads.read('markets', { freshForMs: 60_000, force: true }, async () => 4)
    expect(await forced).toBe(4)
    releaseOld(3)
    expect(await old).toBe(3)
    expect(await reads.read('markets', { freshForMs: 60_000 }, async () => 5)).toBe(4)
  })
})
