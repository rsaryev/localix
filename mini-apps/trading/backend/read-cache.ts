/**
 * Single-flight + short-TTL cache for a live connection's READ calls.
 *
 * Why this exists — the read storm it kills:
 *
 * Some venue reads are cheap; some are not. Hyperliquid's `fetchTicker` is `'emulated'`: ccxt
 * synthesizes it from a BULK read that fans out to ~12 `/info` requests (spot + swap + every
 * HIP-3 builder dex). The cost is ccxt's SERIAL THROTTLE queue, not CPU — `/info` carries
 * rate-limit `cost: 20` × `rateLimit: 50`ms = ~1s of sleep per request, ~12s total. Opening one
 * chart fires the ticker poll, the order-book poll and several account reads at once, and each
 * unguarded ticker read floods that per-instance queue long enough to STARVE the 500-bar OHLCV
 * history the chart needs (which is why a chart could show a single candle) and to pile every
 * other request up behind it. Nothing here blocks the event loop.
 *
 * Two independent guards, both keyed per read:
 *
 *  - **Single-flight (coalesce).** While a read for `key` is in flight, every other caller
 *    asking for the SAME key gets the SAME promise — N concurrent readers produce ONE venue
 *    call. This is honest for ANY read, account reads included: waiters receive the one
 *    genuinely-in-progress result, never a stored past value. Model is the service's
 *    `establishing` promise-memo.
 *  - **Short TTL cache.** With `ttlMs > 0`, a settled value is served to later callers until
 *    it expires. Reserve this for PUBLIC snapshot reads whose value changes slower than we
 *    poll it (ticker, funding, open interest) — NEVER for a claim about the account
 *    (balance / positions / orders / fills), where a stale number read as live is a lie
 *    about money. Pass `ttlMs: 0` to coalesce WITHOUT ever serving a stale value.
 *
 * A REJECTION is never cached and never held in flight past its settle, so the next caller
 * retries against the venue rather than inheriting a cached failure.
 *
 * Pure and clock-injectable (`now`) so the TTL is tested deterministically with no timers.
 */
export interface ReadCache {
  /**
   * Run `fn` for `key`, coalescing concurrent callers onto one call and (when `ttlMs > 0`)
   * serving its result to later callers until it expires.
   */
  dedupe<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>
  /** Drop every cached value and in-flight reference. Called when the connection is torn down. */
  clear(): void
  /** Number of retained TTL entries. Diagnostic/tests — proves the bound holds. */
  readonly size: number
}

interface CacheEntry {
  value: unknown
  /** Absolute ms after which the value is stale (from the injected clock). */
  expires: number
}

/**
 * Hard cap on distinct TTL entries retained per connection. Expiry is otherwise only
 * evaluated when the SAME key is read again, so a high-cardinality key space —
 * `tickers-scoped:<sorted-symbol-set>` mints one entry per distinct picker page, and the
 * per-symbol ticker/funding/oi keys one per symbol ever charted — would accumulate stale
 * (but not-yet-re-read) entries for the whole life of the connection. The cap turns that
 * unbounded browse-session growth into a bounded working set: a value is TTL-bounded and
 * re-derivable, so evicting one only costs a re-fetch — exactly what expiry would force
 * anyway. Far above any realistic concurrent live working set, so it evicts dead keys, not
 * hot ones.
 */
const MAX_CACHED_ENTRIES = 256

export function createReadCache(now: () => number = Date.now): ReadCache {
  const inFlight = new Map<string, Promise<unknown>>()
  const cached = new Map<string, CacheEntry>()

  /** Keep {@link cached} within {@link MAX_CACHED_ENTRIES}: drop expired entries first (the
   *  map's whole point is fresh values), then, if still over, the oldest by insertion order. */
  function evictIfFull(): void {
    if (cached.size <= MAX_CACHED_ENTRIES) return
    const t = now()
    for (const [k, e] of cached) if (e.expires <= t) cached.delete(k)
    while (cached.size > MAX_CACHED_ENTRIES) {
      const oldest = cached.keys().next().value
      if (oldest === undefined) break
      cached.delete(oldest)
    }
  }

  return {
    dedupe<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
      if (ttlMs > 0) {
        const hit = cached.get(key)
        if (hit && hit.expires > now()) return Promise.resolve(hit.value as T)
        // Expired: drop it so the map cannot grow unbounded with dead keys.
        if (hit) cached.delete(key)
      }

      const existing = inFlight.get(key)
      if (existing) return existing as Promise<T>

      let flight: Promise<T>
      flight = fn().then(
        (value) => {
          // Only clear OUR entry — never a newer attempt that replaced us (mirrors the
          // service's `establishing` guard).
          if (inFlight.get(key) === flight) inFlight.delete(key)
          if (ttlMs > 0) {
            cached.set(key, { value, expires: now() + ttlMs })
            evictIfFull()
          }
          return value
        },
        (err) => {
          if (inFlight.get(key) === flight) inFlight.delete(key)
          throw err // a failure is never cached — the next caller retries the venue
        },
      )
      inFlight.set(key, flight)
      return flight
    },

    clear() {
      inFlight.clear()
      cached.clear()
    },

    get size() {
      return cached.size
    },
  }
}
