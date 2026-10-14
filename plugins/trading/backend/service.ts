/**
 * Trading workbench service — every venue read the workbench performs, over ONE driver registry.
 *
 * READ-ONLY BY CONSTRUCTION. This workbench charts and analyses public market data: the exchange
 * catalog, market tables, quotes, candles, the book, the tape, funding and open interest. It
 * holds no credentials, opens no account, and has no code path that can place an order — not a
 * gate that refuses one, but no path at all. That is a stronger guarantee than any guard-rail:
 * a surface that cannot authenticate cannot be talked into trading by a prompt injection, a
 * mistaken click, or a bug in a rule.
 *
 * Sources are EPHEMERAL public profiles (`public:<exchange>`), minted by the registry on first
 * use — there is nothing to persist, because there is nothing secret to keep.
 *
 * Nothing in this file names a venue. `ExchangeBackendFactory` is injectable, so tests drive the
 * whole service with a fake exchange and never touch the network. The cached reads live in
 * `service-reads.ts`; what remains here is the composition.
 */
import { createCcxtBackend } from './ccxt-backend'
import { ccxtExchangeCatalog } from './ccxt-capabilities'
import { createCcxtStreamBackend } from './pro-backend'
import type { Market, TradingConnectionConfig } from './contracts'
import { createConnectionRegistry } from './connection-registry'
import { publicConnectionConfig } from './public-connection'
import type { TradingService, TradingServiceOptions } from './service-port'
import { createServiceReads } from './service-reads'

export type { TradingService, TradingServiceOptions } from './service-port'

export function createTradingService(options: TradingServiceOptions): TradingService {
  // Bind the shared disk cache onto the default ccxt factory (a test's injected `createBackend`
  // uses a fake exchange and ignores it). The cache is venue-keyed, so two sources on the same
  // exchange share one persisted table.
  const createBackend =
    options.createBackend ??
    ((config: TradingConnectionConfig) =>
      createCcxtBackend(config, { marketCache: options.marketCache }))
  const catalog = options.catalog ?? ccxtExchangeCatalog
  const createStream = options.createStream ?? createCcxtStreamBackend

  /**
   * Who holds an open driver for whom — and the ONE path by which one is opened (single-flighted,
   * so concurrent first-accesses cannot leak clients nothing can close) and the ONE by which it
   * is closed. A `public:<exchange>` id is minted there on demand.
   */
  const registry = createConnectionRegistry({ store: options.store, createBackend })
  const { require: requireLive } = registry

  async function marketsFor(userId: string, id: string, reload = false): Promise<Market[]> {
    const entry = await requireLive(userId, id)
    // `reload` forces a venue re-read (and disk rewrite) and refreshes the cached normalized
    // list; the ordinary path loads once and reuses.
    if (reload) entry.markets = await entry.backend.loadMarkets(true)
    else entry.markets ??= await entry.backend.loadMarkets()
    return entry.markets
  }

  const reads = createServiceReads({ requireLive, marketsFor })

  return {
    exchanges: () => catalog(),
    describe: async (userId, id) => (await requireLive(userId, id)).info,
    ...reads,

    async buildStreamBackend(userId, id) {
      const entry = await requireLive(userId, id)
      // The websocket client is built for the SAME venue this driver reads, and seeds from its
      // already-loaded market tables rather than paying the venue read a second time.
      return createStream(publicConnectionConfig(entry.info.id), {
        seedMarketTable: () => entry.backend.marketTable?.() ?? Promise.resolve(null),
      })
    },

    closeAll: () => registry.closeAll(),
  }
}
