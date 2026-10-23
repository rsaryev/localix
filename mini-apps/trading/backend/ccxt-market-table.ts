/**
 * The persisted market-table lifecycle of the ccxt driver.
 *
 * `loadMarkets()` is the single heaviest call the driver makes (~14s on Hyperliquid — see
 * `market-table-cache.ts` for why). We pay it ONCE across processes by persisting the table and
 * handing it back to ccxt via `setMarkets` on the next connect, which makes `loadMarkets()` a
 * no-op (ccxt returns its in-memory table without a network call). The websocket sibling benefits
 * for free: `marketTable()` (its seed source) goes through the same seeded instance.
 */
import { attemptPublicReachRead } from './ccxt-driver-guards'
import type { CcxtExchange } from './ccxt-exchange'
import type { MarketTableCache } from './market-table-cache'

/**
 * How long a disk-cached market table is considered FRESH. Beyond it the table is still served
 * (stale-while-revalidate — see `ensureMarkets`), it just also triggers a background reload.
 *
 * Reasoning for 6h, not a round guess: a venue's roster changes on the order of days, and a
 * background reload costs ~14s of ccxt-throttled `/info` requests. Making that happen on every
 * connect would defeat the very throttle that guards against a ban, so the TTL must be long enough
 * that a normal working session (open a chart, trade, close) NEVER triggers a venue reload — 6h
 * clears any single sitting. It must also be short enough that a market listed overnight is picked
 * up automatically by the next morning's first connect without the user having to click Refresh —
 * 6h means at most a handful of background reloads across a day. The explicit sidebar Refresh
 * (`loadMarkets(reload=true)`) covers the rare "I need a brand-new listing right now" case, so the
 * TTL trades listing-latency against ban-avoidance rather than against the user ever being stuck.
 */
const MARKET_TABLE_TTL_MS = 6 * 60 * 60 * 1000

export interface MarketTableLifecycle {
  /** Load the markets AT MOST ONCE per driver, preferring the disk cache. `reload` is the
   *  forced-refresh path: bypass the cache, read the venue, rewrite the cache fresh. */
  ensureMarkets: (reload?: boolean) => Promise<void>
  /** A genuine liveness read for a PUBLIC connection, when the last load was cache-seeded. */
  assertPublicReachable: () => Promise<void>
}

export interface MarketTableDeps {
  ex: CcxtExchange
  /** Absent ⇒ every connect loads from the venue (the old behaviour). */
  cache: MarketTableCache | undefined
  cacheKey: string
  /** The driver's error-mapping runner — every venue touch goes through it. */
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

export function createMarketTableLifecycle(deps: MarketTableDeps): MarketTableLifecycle {
  const { ex, cache, cacheKey, run } = deps

  // Whether the LAST market load was served from the disk cache (no network) rather than fetched
  // from the venue. `probe` reads this: a cache-seeded load proves nothing about the venue being up
  // NOW, so probe must add a genuine liveness read — otherwise "Test connection" (and Save) would go
  // green on a warm cache even for an unreachable venue.
  let seededFromCache = false

  /** Best-effort write of the currently-loaded table to disk (never throws — a cache write must
   *  not fail a connect). Only meaningful once ccxt has actually loaded the markets. */
  const persistTable = async (): Promise<void> => {
    if (!cache || !ex.markets) return
    await cache.write(cacheKey, { markets: ex.markets, currencies: ex.currencies }).catch(() => {})
  }

  // A stale table is served instantly; the venue reload runs in the background and REPLACES the
  // loaded table in place when it lands, then rewrites the disk cache. NO TEAR: `loadMarkets(true)`
  // ends in ccxt's synchronous `setMarkets`, which assigns `markets`, `markets_by_id`, `symbols` and
  // `ids` together within one un-awaited function call — the event loop cannot interleave a read
  // between those assignments, so a concurrent `safeMarket` sees the old COMPLETE table or the new
  // one, never a half-swap (the network fetch before it is what takes time, and it mutates nothing).
  // This is
  // stale-while-revalidate: the chart never waits on a reload, and the live driver self-heals a
  // stale roster within seconds without the user doing anything. Best-effort — a failed background
  // reload leaves the (still-usable) stale table in place; the explicit sidebar Refresh remains.
  let revalidating = false
  const revalidateInBackground = (): void => {
    if (revalidating) return
    revalidating = true
    void (async () => {
      try {
        await ex.loadMarkets(true)
        await persistTable()
      } catch {
        // keep the stale-but-usable table; a forced Refresh can still reload it
      } finally {
        revalidating = false
      }
    })()
  }

  /** Hand ccxt a disk-cached table when one is present and usable. Returns whether it seeded. */
  const hydrateFromCache = async (): Promise<boolean> => {
    if (!cache) return false
    const entry = await cache.read(cacheKey) // never throws; null on miss/corrupt/empty
    if (!entry) return false
    try {
      ex.setMarkets(entry.table.markets, entry.table.currencies)
    } catch {
      return false // a table ccxt refuses to adopt is treated as a miss, not a crash
    }
    seededFromCache = true
    if (Date.now() - entry.savedAt >= MARKET_TABLE_TTL_MS) revalidateInBackground()
    return true
  }

  /**
   * A GENUINE liveness read for a PUBLIC connection, used by `probe` when the market table was
   * seeded from disk (so `loadMarkets` never touched the venue). The read logic lives in the
   * exported, unit-tested {@link attemptPublicReachRead}; here we only gate it on whether the last
   * market load actually reached the wire. Credentialed connections never reach here — their private
   * read is the genuine, un-cacheable venue touch that also validates the keys.
   */
  const assertPublicReachable = async (): Promise<void> => {
    if (!seededFromCache) return // ensureMarkets already hit the venue (cold cache or forced reload)
    await run(() => attemptPublicReachRead(ex))
  }

  // Every method that needs a loaded table routes through this instead of calling
  // `ex.loadMarkets()` directly, so the seed happens before any fetch (the service always
  // `probe()`s a new driver, which calls this).
  let hydrated: Promise<void> | undefined
  const ensureMarkets = (reload = false): Promise<void> => {
    if (reload) {
      // Forced refresh (sidebar Refresh): bypass the cache, load from the venue, rewrite disk fresh.
      seededFromCache = false
      hydrated = run(() => ex.loadMarkets(true)).then(() => persistTable())
      return hydrated
    }
    hydrated ??= (async () => {
      if (await hydrateFromCache()) return // instant — no network
      await run(() => ex.loadMarkets()) // cold cache: pay the venue cost once
      await persistTable() // and write it so the NEXT process is warm
    })().catch((err) => {
      hydrated = undefined // a failed load must not memoize forever — the next caller retries
      throw err
    })
    return hydrated
  }

  return { ensureMarkets, assertPublicReachable }
}
