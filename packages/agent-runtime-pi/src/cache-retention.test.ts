import { describe, expect, test } from 'bun:test'

import {
  CACHE_TTL_LONG_MAX_IDLE_MS,
  CACHE_TTL_LONG_MIN_IDLE_MS,
  pickCacheRetention,
} from './cache-retention'
import { withPiRunStreamOptions } from './stream-options'

describe('pickCacheRetention', () => {
  test('fast turns (<=5m) use the cheaper 5m cache', () => {
    expect(pickCacheRetention(0)).toBe('short')
    expect(pickCacheRetention(60_000)).toBe('short') // 1m
    expect(pickCacheRetention(CACHE_TTL_LONG_MIN_IDLE_MS)).toBe('short') // exactly 5m → short
  })

  test('slow cadence (5m–1h) opts into the 1h cache', () => {
    expect(pickCacheRetention(CACHE_TTL_LONG_MIN_IDLE_MS + 1)).toBe('long')
    expect(pickCacheRetention(10 * 60_000)).toBe('long') // a 10m /loop
    expect(pickCacheRetention(CACHE_TTL_LONG_MAX_IDLE_MS)).toBe('long') // exactly 1h → long
  })

  test('very slow (>1h) falls back to the cheaper 5m write (1h cache would also expire)', () => {
    expect(pickCacheRetention(CACHE_TTL_LONG_MAX_IDLE_MS + 1)).toBe('short')
    expect(pickCacheRetention(3 * 60 * 60_000)).toBe('short') // 3h
  })

  test('no measurement is not a measurement of zero — the adapter default stands', () => {
    // A host that cannot see the gap (a first turn, a rebuilt session) must not be read as
    // "this session is fast": the field is absent, so nothing is imposed on the request.
    expect(pickCacheRetention(undefined)).toBeUndefined()
    expect(pickCacheRetention(Number.NaN)).toBeUndefined()
    expect(pickCacheRetention(-1)).toBeUndefined()
  })
})

describe('the run request carries the derived retention, never the host’s', () => {
  test('an idle gap becomes a TTL; an absent one leaves the upstream option alone', () => {
    const slow = withPiRunStreamOptions(
      { maxTokens: 1024, cacheRetention: 'short' },
      { sessionId: 'LOCALIX-42', promptCacheIdleMs: 10 * 60_000 },
      {},
    )
    expect(slow).toMatchObject({ sessionId: 'LOCALIX-42', cacheRetention: 'long', maxTokens: 1024 })

    // Spread-order tripwire: an unmeasured gap must not clobber a per-request value with
    // "unset" — the same rule every other host override here follows.
    const unmeasured = withPiRunStreamOptions(
      { maxTokens: 1024, cacheRetention: 'short' },
      { sessionId: 'LOCALIX-42' },
      {},
    )
    expect(unmeasured.cacheRetention).toBe('short')
  })
})
