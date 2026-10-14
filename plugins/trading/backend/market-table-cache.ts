/**
 * Persisted venue market-table cache — so the ~14s `loadMarkets` is paid ONCE, not once per
 * connect. A venue's market roster changes on the order of days; a chart open should never wait
 * for it.
 *
 * WHY IT IS SLOW (diagnosed, not re-derived): ccxt asks the venue for markets across every type
 * it lists — for Hyperliquid that is spot + swap + up to ten third-party HIP-3 "builder dex"
 * metadata calls, ~12 requests. The venue's `/info` endpoint carries a ccxt rate-limit `cost: 20`
 * against `rateLimit: 50`ms, so ccxt's THROTTLE QUEUE sleeps ~1s before each request (the queue is
 * serial and per-instance): 12 requests ⇒ ~13s of waiting, almost none of it CPU or the venue. We
 * keep the throttle (it is the only guard against a ban) and we keep every market (dropping the
 * HIP-3 type silently loses 225 markets a user immediately noticed). So the roster cannot be made
 * cheaper to load — it is made cheaper to RE-load, by persisting it and handing ccxt the table via
 * `setMarkets` instead of re-fetching.
 *
 * Shape mirrors the trading CONNECTION store (`store.ts`): a content directory under `~/.localix/`,
 * atomic temp+rename writes, per-key serialization. It is NOT keyed by user or connection — two
 * connections to the same venue share ONE table — so there is no per-user file here; the key is the
 * venue signature (see {@link marketTableCacheKey}).
 *
 * SAFETY (constraint 5): a corrupt / unreadable / empty-table file is a cache MISS — `read` returns
 * `null`, never throws and never yields an empty market list. An empty roster would render as "this
 * venue lists no markets", which is a lie of the same class as dropping the HIP-3 types.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeFileKey } from './store-paths'

/** The raw ccxt market table, exactly as `ExchangeBackend.marketTable()` hands it to a sibling
 *  client — OPAQUE structure (`unknown` values), only ever fed back through ccxt's `setMarkets`.
 *  `precision`/`limits` live inside each market value and survive the JSON round-trip verbatim
 *  (they are plain numbers/objects — `precision.price` is a TICK SIZE, not a decimal count). */
export interface RawMarketTable {
  markets: Record<string, unknown>
  currencies?: Record<string, unknown>
}

/** A persisted table plus the wall-clock time it was loaded from the venue (for the TTL check the
 *  DRIVER owns — the store itself has no policy on staleness). */
export interface CachedMarketTable {
  /** Unix ms when the table was fetched from the venue. */
  savedAt: number
  table: RawMarketTable
}

export interface MarketTableCache {
  /**
   * The cached table for a venue key, or `null` on a MISS — absent, corrupt, unreadable, or
   * empty. Never throws: a bad cache must degrade to a cold load, never crash a connect.
   */
  read(key: string): Promise<CachedMarketTable | null>
  /** Persist a freshly-loaded table (stamped `savedAt: now`). Best-effort + atomic; a never-empty
   *  table only (an empty write would poison the cache with the very lie `read` guards against). */
  write(key: string, table: RawMarketTable): Promise<void>
}

/**
 * The cache key — a VENUE signature, never a user or connection id (constraint 3). Two connections
 * to the same venue must resolve the same key and share one table.
 *
 * - `exchangeId` — the venue.
 * - `sandbox` — a testnet is a DIFFERENT venue that lists different markets; it must not share the
 *   mainnet table.
 * - `defaultType` — included DEFENSIVELY. On most venues (Hyperliquid included) `loadMarkets` loads
 *   every type regardless of `options.defaultType`, so the table is identical and this only reduces
 *   sharing. But some ccxt venues scope `loadMarkets` to the default type, and a shared PARTIAL
 *   table would silently hide markets — the exact failure class this cache exists to avoid — so the
 *   key errs toward correctness over sharing.
 */
export function marketTableCacheKey(config: {
  exchangeId: string
  sandbox?: boolean
  defaultType?: string
}): string {
  const parts = [config.exchangeId]
  if (config.sandbox) parts.push('sandbox')
  if (config.defaultType) parts.push(`type-${config.defaultType}`)
  return parts.join('__')
}

/** A parsed value is a usable cache entry only when it carries a numeric `savedAt` and a NON-EMPTY
 *  markets map. A partial/renamed-shape file therefore reads as a MISS, not a broken hydrate. */
function isUsable(value: unknown): value is CachedMarketTable {
  if (!value || typeof value !== 'object') return false
  const v = value as { savedAt?: unknown; table?: { markets?: unknown } }
  if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt)) return false
  const markets = v.table?.markets
  return !!markets && typeof markets === 'object' && Object.keys(markets as object).length > 0
}

export function createMarketTableCache(opts: { dir: string }): MarketTableCache {
  const fileFor = (key: string) => path.join(opts.dir, `${safeFileKey(key)}.json`)

  // Writes for one key are serialized so a concurrent refresh never races itself; a read observes
  // the old or the new file (atomic rename), never a partial one.
  const writeTail = new Map<string, Promise<unknown>>()
  function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = writeTail.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    writeTail.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  return {
    async read(key) {
      try {
        const parsed = JSON.parse(await readFile(fileFor(key), 'utf8'))
        // ANY malformed / partial / empty payload is a MISS — never an empty market list, never a
        // throw. A cold load then repopulates it.
        return isUsable(parsed) ? parsed : null
      } catch {
        // ENOENT (never cached) or a corrupt file (truncated write, bad JSON) — both are a miss.
        return null
      }
    },

    write(key, table) {
      return withWriteLock(key, async () => {
        // Never persist an empty roster: it would poison the cache into asserting the venue lists
        // no markets. A caller with nothing to save simply leaves the prior (or absent) file.
        if (!table.markets || Object.keys(table.markets).length === 0) return
        await mkdir(opts.dir, { recursive: true })
        const target = fileFor(key)
        const tmp = `${target}.tmp`
        const payload: CachedMarketTable = { savedAt: Date.now(), table }
        await writeFile(tmp, JSON.stringify(payload), 'utf8')
        await rename(tmp, target) // atomic swap — a concurrent reader sees old or new, never partial
      })
    },
  }
}
