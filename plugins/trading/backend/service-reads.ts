/**
 * The trading service's READ methods — public market data and account reads, all funnelled
 * through the per-connection read cache so N concurrent readers of the same key cost ONE venue
 * call (see `read-cache.ts` for the storm this kills).
 */
import type { ContractStats } from './backend'
import type { Market } from './contracts'
import { TradingError } from './errors'
import { rankMarkets } from './market-rank'
import type { LiveEntry } from './connection-registry'
import type { TradingService } from './service-port'

/**
 * TTL for a NATIVE single-ticker read — short and defensible: a sub-second ticker is never mistaken
 * for a live one, and its whole job is to coalesce the near-simultaneous readers one chart open
 * produces (poll + agent tool + a second tab). ACCOUNT reads are coalesce-only (ttl 0): a stale
 * balance/position/order read as live is a lie about money.
 */
const TICKER_TTL_MS = 1_000
/**
 * TTL for an EMULATED single-ticker read, measured against its COST rather than the poll interval.
 * An emulated `fetchTicker` fans out to a BULK read of every market type — ~12 throttled `/info`
 * requests, ~12s on Hyperliquid (ccxt's serial throttle queue, NOT CPU) — so it must run as rarely
 * as we can justify. This is ONLY ever the FALLBACK price while the ticker websocket is down; the
 * stream is the real feed, and an 8s-stale fallback last-price is fine when the alternative is
 * flooding the throttle queue for ~12s. With the client also backing its emulated poll off (see
 * `useTicker.ts`), this caps the venue read to at most once per 8s even in the pathological
 * no-stream case, vs on every poll.
 */
const EMULATED_TICKER_TTL_MS = 8_000
/** Funding + open interest settle once per venue period (Hyperliquid: hourly) and poll at 60s, so
 *  a few seconds of reuse is generous headroom, not staleness. */
const STATS_TTL_MS = 15_000
/** Coalesce-only: share an in-flight call among concurrent readers, but never serve a stored value. */
const COALESCE_ONLY = 0

export type ServiceReads = Pick<
  TradingService,
  | 'markets'
  | 'ticker'
  | 'tickers'
  | 'ohlcv'
  | 'orderBook'
  | 'trades'
  | 'fundingRate'
  | 'openInterest'
>

export interface ServiceReadsDeps {
  requireLive: (userId: string, id: string) => Promise<LiveEntry>
  /** The service's per-connection cached market list (`reload` forces a venue re-read). */
  marketsFor: (userId: string, id: string, reload?: boolean) => Promise<Market[]>
}

export function createServiceReads(deps: ServiceReadsDeps): ServiceReads {
  const { requireLive, marketsFor } = deps

  /**
   * Funding + open interest under ONE cache key, when the backend can read them together.
   *
   * The chart asks for both at once, every fifteen seconds. Behind two keys that was two venue
   * reads of one payload — and on Hyperliquid, whose throttle queue is serial and charges a full
   * second for that endpoint, the second read delayed every other request for that connection by a
   * second for nothing. Under one key the cache's single-flight coalesces the pair into one read,
   * and the TTL then serves both.
   *
   * `undefined` when the backend cannot do it, so the caller keeps its two single reads.
   */
  function contractStats(entry: LiveEntry, symbol: string): Promise<ContractStats> | undefined {
    const read = entry.backend.fetchContractStats?.bind(entry.backend)
    if (!read) return undefined
    return entry.reads.dedupe(`stats:${symbol}`, STATS_TTL_MS, () => read(symbol))
  }

  return {
    async markets(userId, id, opts) {
      let markets = await marketsFor(userId, id, opts?.reload)
      if (opts?.type) markets = markets.filter((m) => m.type === opts.type)
      if (opts?.query) {
        // Match the base and quote too, not just the unified symbol: a user typing `usdc` or
        // `btc` means the currency, and both callers above (the `@`-menu, the sidebar) already
        // search all three fields locally. Filtering on fewer fields here made the server-side
        // search strictly weaker than the client-side one it was added to replace.
        const q = opts.query.toLowerCase()
        markets = markets.filter(
          (m) =>
            m.symbol.toLowerCase().includes(q) ||
            m.base.toLowerCase().includes(q) ||
            m.quote.toLowerCase().includes(q),
        )
      }
      // A limit is a CAP, not a prefix of the venue's own order — see `market-rank.ts`. Slicing
      // off the top handed a caller asking for 500 of Hyperliquid's 755 markets all 299 spot
      // markets and only 201 of its 456 perpetuals.
      return opts?.limit ? rankMarkets(markets, opts.limit).markets : markets
    },

    // ── Public reads: coalesced, and (ticker / funding / open-interest) short-TTL cached. Every
    //    poller, every extra chart tab and the read tools funnel through here, so N concurrent
    //    readers of the same key cost ONE venue call. See `read-cache.ts` for the storm this kills.
    async ticker(userId, id, symbol) {
      const entry = await requireLive(userId, id)
      // An EMULATED single-ticker read is derived by ccxt from a BULK read. Ask the driver what THIS
      // symbol costs before choosing how to serve it.
      if (entry.info.capabilities.ticker === 'emulated') {
        // `cheap`: the driver can narrow the read to ONE request — the symbol's own market type for
        // an ordinary market (~1.9s on Hyperliquid vs ~13s unscoped), or its own builder-dex context
        // for a HIP-3 market (~1.4s vs ~11s). Cache it per symbol.
        if (entry.backend.tickerReadCost?.(symbol) === 'cheap') {
          return entry.reads.dedupe(`ticker:${symbol}`, EMULATED_TICKER_TTL_MS, () =>
            entry.backend.fetchTicker(symbol),
          )
        }
        // `bulk` (and the unknown default): a per-symbol read would drag in many/all markets, so N
        // symbols would cost N whole-venue reads. Serve every such symbol out of ONE shared, cached
        // map instead.
        const all = await entry.reads.dedupe('tickers:all', EMULATED_TICKER_TTL_MS, () =>
          entry.backend.fetchTickers(),
        )
        const found = all.find((t) => t.symbol === symbol)
        if (found) return found
        // Do NOT fall through to `fetchTicker`. The driver just told us it can only answer this
        // symbol by reading the map we already have, so a per-symbol read cannot know anything the
        // map did not. A miss is a `bad_symbol`, not a reason to pay the whole read again.
        throw new TradingError('bad_symbol', `${entry.info.name} does not list "${symbol}".`)
      }
      return entry.reads.dedupe(`ticker:${symbol}`, TICKER_TTL_MS, () =>
        entry.backend.fetchTicker(symbol),
      )
    },
    async tickers(userId, id, symbols) {
      const entry = await requireLive(userId, id)
      const scoped = entry.backend.fetchTickersScoped
      if (symbols.length === 0) return []
      // A driver without a cheap multi-symbol read must not silently answer "no prices". An empty
      // list is already the honest answer for symbols the venue could not price, so reusing it here
      // would collapse two different facts into one: "these markets have no quote right now" and
      // "this venue cannot quote in bulk at all". A market picker can live with the ambiguity — it
      // renders a blank column either way — but the `market_data` tool reads this same method, and
      // an agent told twenty markets are unpriced will conclude something about those markets rather
      // than about the read. So say which it is.
      //
      // What we must NOT do is fall back to an unscoped `fetchTickers(symbols)`: on an emulated
      // venue that is the whole-venue fan-out (12 requests, ~13s on Hyperliquid), and every other
      // read for this connection — the chart's own candles included — queues behind it.
      if (!scoped) {
        throw new TradingError(
          'not_supported',
          `${entry.info.name} cannot quote several markets in one read. Read them one at a time.`,
        )
      }
      // Key on the exact symbol SET (sorted) so one page's cached prices can NEVER be served to
      // another page — a different picker page is a different key, a re-poll of the same page
      // coalesces. Short TTL: a public browse quote a few seconds old is honest (it is a quote, not
      // a claim about the account), and the alternative is a fresh scoped read on every poll.
      const key = `tickers-scoped:${[...symbols].sort().join(',')}`
      return entry.reads.dedupe(key, EMULATED_TICKER_TTL_MS, () =>
        scoped.call(entry.backend, symbols),
      )
    },
    async ohlcv(userId, id, symbol, timeframe, opts) {
      const entry = await requireLive(userId, id)
      return entry.reads.dedupe(
        // Every bound is in the key. Two backfill pages differ ONLY by their window, so a key that
        // omitted `until` would coalesce one page onto another and prepend the wrong bars.
        `ohlcv:${symbol}:${timeframe}:${opts?.since ?? ''}:${opts?.until ?? ''}:${opts?.limit ?? ''}`,
        COALESCE_ONLY,
        () => entry.backend.fetchOHLCV(symbol, timeframe, opts),
      )
    },
    async orderBook(userId, id, symbol, limit) {
      const entry = await requireLive(userId, id)
      return entry.reads.dedupe(`book:${symbol}:${limit ?? ''}`, COALESCE_ONLY, () =>
        entry.backend.fetchOrderBook(symbol, limit),
      )
    },
    async trades(userId, id, symbol, limit) {
      const entry = await requireLive(userId, id)
      return entry.reads.dedupe(`trades:${symbol}:${limit ?? ''}`, COALESCE_ONLY, () =>
        entry.backend.fetchTrades(symbol, limit),
      )
    },
    async fundingRate(userId, id, symbol) {
      const entry = await requireLive(userId, id)
      const stats = contractStats(entry, symbol)
      if (stats) return (await stats).fundingRate
      return entry.reads.dedupe(`funding:${symbol}`, STATS_TTL_MS, () =>
        entry.backend.fetchFundingRate(symbol),
      )
    },
    async openInterest(userId, id, symbol) {
      const entry = await requireLive(userId, id)
      const stats = contractStats(entry, symbol)
      if (stats) return (await stats).openInterest
      return entry.reads.dedupe(`oi:${symbol}`, STATS_TTL_MS, () =>
        entry.backend.fetchOpenInterest(symbol),
      )
    },
  }
}
