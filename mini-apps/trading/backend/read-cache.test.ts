import { describe, expect, test } from 'bun:test'
import { createReadCache } from './read-cache'

/** A resolvable promise handle, so a test can hold a call "in flight" deterministically. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('single-flight coalescing', () => {
  test('N concurrent callers for one key produce ONE call', async () => {
    const cache = createReadCache()
    const gate = deferred<number>()
    let calls = 0
    const fn = () => {
      calls++
      return gate.promise
    }

    const a = cache.dedupe('k', 0, fn)
    const b = cache.dedupe('k', 0, fn)
    const c = cache.dedupe('k', 0, fn)

    gate.resolve(42)
    expect(await a).toBe(42)
    expect(await b).toBe(42)
    expect(await c).toBe(42)
    expect(calls).toBe(1) // coalesced onto a single venue call
  })

  test('different keys are independent', async () => {
    const cache = createReadCache()
    let calls = 0
    const fn = async () => {
      calls++
      return calls
    }
    const [a, b] = await Promise.all([cache.dedupe('x', 0, fn), cache.dedupe('y', 0, fn)])
    expect(new Set([a, b]).size).toBe(2)
    expect(calls).toBe(2)
  })

  test('ttl:0 does NOT serve a stale value — a settled call is re-run next time (coalesce only)', async () => {
    const cache = createReadCache()
    let calls = 0
    const fn = async () => ++calls
    expect(await cache.dedupe('k', 0, fn)).toBe(1)
    expect(await cache.dedupe('k', 0, fn)).toBe(2) // previous settled + dropped ⇒ fresh call
    expect(calls).toBe(2)
  })
})

describe('short TTL cache', () => {
  test('serves the cached value inside the window, re-fetches after it expires', async () => {
    let clock = 1_000
    const cache = createReadCache(() => clock)
    let calls = 0
    const fn = async () => ++calls

    expect(await cache.dedupe('t', 1000, fn)).toBe(1)
    clock = 1_500 // within the 1s window
    expect(await cache.dedupe('t', 1000, fn)).toBe(1) // cache hit — no new call
    expect(calls).toBe(1)

    clock = 2_001 // past expiry (cached at 1000, expires at 2000)
    expect(await cache.dedupe('t', 1000, fn)).toBe(2) // re-fetched
    expect(calls).toBe(2)
  })

  test('a boundary read exactly at expiry is treated as stale (expires is exclusive)', async () => {
    let clock = 0
    const cache = createReadCache(() => clock)
    let calls = 0
    const fn = async () => ++calls
    await cache.dedupe('t', 1000, fn) // cached, expires at 1000
    clock = 1000
    await cache.dedupe('t', 1000, fn)
    expect(calls).toBe(2)
  })
})

describe('failures are never cached', () => {
  test('a rejection is not stored and the next caller retries', async () => {
    const cache = createReadCache()
    let calls = 0
    const fn = async () => {
      calls++
      if (calls === 1) throw new Error('venue down')
      return 'ok'
    }
    expect(cache.dedupe('k', 5000, fn)).rejects.toThrow('venue down')
    expect(await cache.dedupe('k', 5000, fn)).toBe('ok') // retried, then cached
    expect(calls).toBe(2)
  })

  test('concurrent callers all see the same rejection (coalesced), then a retry succeeds', async () => {
    const cache = createReadCache()
    const gate = deferred<string>()
    let calls = 0
    const fn = () => {
      calls++
      return calls === 1 ? gate.promise : Promise.resolve('ok')
    }
    const a = cache.dedupe('k', 1000, fn)
    const b = cache.dedupe('k', 1000, fn)
    gate.reject(new Error('boom'))
    expect(a).rejects.toThrow('boom')
    expect(b).rejects.toThrow('boom')
    expect(calls).toBe(1)
    expect(await cache.dedupe('k', 1000, fn)).toBe('ok')
    expect(calls).toBe(2)
  })
})

describe('bounded growth (backpressure)', () => {
  test('a high-cardinality browse of distinct keys never grows the cache without bound', async () => {
    let clock = 0
    const cache = createReadCache(() => clock)
    // Each key is read exactly once with a live TTL, so lazy same-key expiry never fires —
    // this is the market-picker browse pattern (a distinct `tickers-scoped:<set>` per page).
    for (let i = 0; i < 5000; i++) {
      clock += 1 // advance so early entries expire, but they are never re-read
      await cache.dedupe(`page:${i}`, 1000, async () => i)
    }
    // Without the cap this map would hold ~5000 dead entries for the connection's lifetime.
    expect(cache.size).toBeLessThanOrEqual(256)
  })

  test('a value still inside its TTL window survives eviction and is served from cache', async () => {
    let clock = 0
    const cache = createReadCache(() => clock)
    let hotCalls = 0
    // Prime a hot key with a long TTL so it stays live throughout the browse.
    expect(await cache.dedupe('hot', 1_000_000, async () => ++hotCalls)).toBe(1)
    // Now flood distinct short-TTL keys; the sweep drops the EXPIRED ones, sparing 'hot'.
    for (let i = 0; i < 1000; i++) {
      clock += 1
      await cache.dedupe(`k:${i}`, 1, async () => i) // expires almost immediately
    }
    expect(await cache.dedupe('hot', 1_000_000, async () => ++hotCalls)).toBe(1) // still cached
    expect(hotCalls).toBe(1)
  })
})

describe('clear', () => {
  test('drops cached values so the next read hits the venue again', async () => {
    let clock = 0
    const cache = createReadCache(() => clock)
    let calls = 0
    const fn = async () => ++calls
    await cache.dedupe('k', 10_000, fn)
    cache.clear()
    await cache.dedupe('k', 10_000, fn)
    expect(calls).toBe(2)
  })
})
