/**
 * The ccxt implementation of the agnostic {@link ExchangeBackend} port.
 *
 * Everything ccxt returns is funnelled through the pure `normalize.ts` translators, and
 * everything it throws through `mapTradingError`, so no ccxt type or error class escapes
 * this driver. Hyperliquid is the priority venue but gets ZERO special-casing here: it is a
 * `exchangeId`, and its `walletAddress`/`privateKey` credentials ride the same generic
 * credential map every venue uses.
 *
 * The driver is layered — each neighbour carries the part of it that stands on its own:
 *
 * - `ccxt-exchange.ts` — the structural ccxt client surface, the lazy module load, and the
 *   tri-state `has` reader every capability check depends on.
 * - `ccxt-capabilities.ts` — the venue's `has` map translated into our `ExchangeInfo`, plus the
 *   connect-form catalog.
 * - `ccxt-scoped-reads.ts` — the cheapest-read policy (scoped tickers, HIP-3 builder-dex reads,
 *   the one-payload contract-stats read), which is where a venue's fan-out economics live.
 * - `ccxt-driver-guards.ts` — the exported, offline-testable guard helpers (public reach,
 *   close-target resolution, cancel-all counting, the account-change note).
 * - `ccxt-market-table.ts` — the persisted market-table lifecycle (disk cache seed,
 *   stale-while-revalidate, forced reload).
 * - `ccxt-read-methods.ts` — the port's read methods.
 *
 * What remains HERE is the assembly: construct the ccxt client from a resolved config, wire the
 * layers together, and own the probe + teardown.
 */
import type { ExchangeBackend, ProbeResult } from './backend'
import type { MarketTableCache } from './market-table-cache'
import { marketTableCacheKey } from './market-table-cache'
import type { TradingConnectionConfig } from './contracts'
import { TradingError, mapTradingError } from './errors'
import { loadCcxt, type CcxtExchange } from './ccxt-exchange'
import { describeExchange } from './ccxt-capabilities'
import { tickerReadCostFor } from './ccxt-scoped-reads'
import { createMarketTableLifecycle } from './ccxt-market-table'
import { createCcxtReadMethods } from './ccxt-read-methods'

// The offline-testable guard helpers moved to `ccxt-driver-guards.ts`; re-exported so
// `./ccxt-backend` stays the one entry point their importers and tests use.

/** Optional wiring for {@link createCcxtBackend}. Kept as an options object (not a factory-signature
 *  change) so a test that injects its own `ExchangeBackendFactory` is unaffected — the disk cache is
 *  only ever bound onto the DEFAULT ccxt factory by the service. */
export interface CcxtBackendOptions {
  /** Shared, venue-keyed disk cache for the market table. Absent ⇒ every connect loads from the venue
   *  (the old behaviour), which is why it is optional. */
  marketCache?: MarketTableCache
}

/** Build a ccxt driver for a resolved config (credentials already de-tokenized). */
export async function createCcxtBackend(
  config: TradingConnectionConfig,
  backendOpts?: CcxtBackendOptions,
): Promise<ExchangeBackend> {
  const ccxt = await loadCcxt()
  const Ctor = ccxt[config.exchangeId] as
    | (new (opts: Record<string, unknown>) => CcxtExchange)
    | undefined
  if (typeof Ctor !== 'function') {
    throw new TradingError('exchange_unknown', `Unknown exchange "${config.exchangeId}".`)
  }

  // No credentials are ever passed: this driver reads public market data and nothing else.
  const ex = new Ctor({
    enableRateLimit: true,
    ...(config.defaultType ? { options: { defaultType: config.defaultType } } : {}),
  })

  if (config.sandbox) {
    // A venue without a testnet throws NotSupported — surface it as a typed error at
    // connect time rather than letting every later call fail mysteriously.
    try {
      ex.setSandboxMode(true)
    } catch (err) {
      throw mapTradingError(err)
    }
  }

  const watch = typeof ccxt.pro?.[config.exchangeId] === 'function'
  const info = describeExchange(ex, watch)

  /** Run a driver call, mapping any raw throw into a typed TradingError. */
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      throw mapTradingError(err)
    }
  }

  // The persisted market-table lifecycle — disk-cache seed, stale-while-revalidate, forced reload.
  const { ensureMarkets, assertPublicReachable } = createMarketTableLifecycle({
    ex,
    cache: backendOpts?.marketCache,
    cacheKey: marketTableCacheKey(config),
    run,
  })

  const reads = createCcxtReadMethods({ ex, info, run, ensureMarkets })

  return {
    describe: () => info,

    async probe(): Promise<ProbeResult> {
      // Load the market table (instant from the disk cache when warm, else one venue read + persist).
      // This is PUBLIC: it succeeds with a garbage API key, an unregistered wallet, or no credentials.
      await ensureMarkets()

      // A warm cache means `ensureMarkets` never touched the venue, so prove it is reachable NOW
      // with a cheap genuine read — otherwise a probe would go green on a down venue off a stale
      // cache. There are no credentials to exercise: this driver reads public data only.
      await assertPublicReachable()
      return { credentialsChecked: false }
    },

    /** The loaded ccxt tables, for a sibling client of the SAME venue to adopt. Loads them first
     *  when this client has not needed them yet — one client (or the disk cache) paying the cost is
     *  the whole point; the websocket sibling then seeds from this in ~6ms. */
    async marketTable(): Promise<unknown> {
      await ensureMarkets()
      if (!ex.markets) return null
      return { markets: ex.markets, currencies: ex.currencies }
    },

    tickerReadCost(symbol) {
      return tickerReadCostFor(ex, symbol)
    },

    ...reads,

    async close() {
      try {
        await ex.close()
      } catch {
        // Closing is best-effort cleanup; a venue that throws here must not break teardown.
      }
    },
  }
}
