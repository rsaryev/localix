/**
 * The ccxt driver's READ port methods — market data and account reads. Everything ccxt returns is
 * funnelled through the pure `normalize.ts` translators; every venue touch rides the driver's
 * error-mapping `run`, so no ccxt type or error class escapes.
 */
import type { ContractStats, ExchangeBackend } from './backend'
import { requireCapFor, requiresSinceError } from './ccxt-driver-guards'
import { supports, type CcxtExchange } from './ccxt-exchange'
import { isKnownNonContract } from './ccxt-capabilities'
import {
  readContractStatsRaw,
  readFundingRateRaw,
  readOpenInterestRaw,
  readScopedTickersRaw,
  readTickerScoped,
} from './ccxt-scoped-reads'
import type {
  Candle,
  ExchangeInfo,
  FundingRate,
  Market,
  OpenInterest,
  OrderBook,
  PublicTrade,
  Ticker,
} from './contracts'
import { TradingError } from './errors'
import {
  normalizeCandles,
  normalizeMarket,
  normalizeOrderBook,
  normalizeFundingRate,
  normalizeOpenInterest,
  normalizeTicker,
  normalizeTrade,
} from './normalize'
import { defaultOhlcvSince } from './timeframes'

/** Bars the derived-`since` fallback asks for when the caller gave no `limit` — mirrors the
 *  chart's own seed window. Only reached on a venue that refuses a since-less OHLCV read. */
const DEFAULT_SINCE_WINDOW_BARS = 300

export type CcxtReadMethods = Pick<
  ExchangeBackend,
  | 'loadMarkets'
  | 'fetchTicker'
  | 'fetchTickers'
  | 'fetchTickersScoped'
  | 'fetchOHLCV'
  | 'fetchOrderBook'
  | 'fetchTrades'
  | 'fetchFundingRate'
  | 'fetchContractStats'
  | 'fetchOpenInterest'
>

export interface CcxtReadMethodsDeps {
  ex: CcxtExchange
  info: ExchangeInfo
  run: <T>(fn: () => Promise<T>) => Promise<T>
  ensureMarkets: (reload?: boolean) => Promise<void>
}

export function createCcxtReadMethods(deps: CcxtReadMethodsDeps): CcxtReadMethods {
  const { ex, info, run, ensureMarkets } = deps
  const requireCap = requireCapFor(info)

  return {
    async loadMarkets(reload = false): Promise<Market[]> {
      // `reload` is the FORCED-REFRESH path (sidebar Refresh): it bypasses the disk cache, reads the
      // venue, and rewrites the cache fresh — the escape hatch for a market listed within the TTL.
      // A normal load seeds from the cache when it can. Either way `ex.markets` holds the full table
      // afterward — read it from there rather than a second `loadMarkets` that would ignore the seed.
      await ensureMarkets(reload)
      return Object.values(ex.markets ?? {})
        .map(normalizeMarket)
        .filter((m): m is Market => m !== null)
    },

    async fetchTicker(symbol) {
      const t = await run(() => readTickerScoped(ex, symbol))
      if (!t)
        throw new TradingError(
          'exchange_error',
          `${info.name} returned an unreadable ticker for ${symbol}.`,
        )
      return t
    },

    async fetchTickers(symbols): Promise<Ticker[]> {
      const raw = await run(() => ex.fetchTickers(symbols))
      return Object.entries(raw)
        .map(([symbol, t]) => normalizeTicker(t, symbol))
        .filter((t): t is Ticker => t !== null)
    },

    async fetchTickersScoped(symbols): Promise<Ticker[]> {
      // A bounded set of one-request reads — one per market type, one per builder dex — planned over
      // the loaded market table (already there: the service probes on connect, exactly as fetchTicker
      // relies on), so the grouping itself costs no network call. Symbols the venue does not list,
      // and symbols in a bucket past the request budget, come back absent and show no price.
      const raw = await run(() => readScopedTickersRaw(ex, symbols))
      return Object.entries(raw)
        .map(([symbol, t]) => normalizeTicker(t, symbol))
        .filter((t): t is Ticker => t !== null)
    },

    async fetchOHLCV(symbol, timeframe, opts): Promise<Candle[]> {
      requireCap('ohlcv', 'OHLCV candles')
      if (info.timeframes.length && !info.timeframes.includes(timeframe)) {
        throw new TradingError(
          'not_supported',
          `${info.name} has no "${timeframe}" timeframe (available: ${info.timeframes.join(', ')}).`,
        )
      }
      // `until` rides in `params`, which is where every ccxt exchange reads an upper bound from. It
      // is not cosmetic: given only `since`, ccxt asks the venue for `[since, now]` and then throws
      // away everything past `limit`. Paging backwards, that window grows with every page —
      // measured on Hyperliquid, ten pages back on `1m`: the venue sent 5179 bars so ccxt could keep
      // 500 (2166ms), against 501 sent for the same 500 kept once bounded (1106ms).
      const params = opts?.until !== undefined ? { until: opts.until } : undefined
      try {
        const raw = await run(() =>
          ex.fetchOHLCV(symbol, timeframe, opts?.since, opts?.limit, params),
        )
        return normalizeCandles(raw)
      } catch (err) {
        // Some venues REFUSE a since-less read — ccxt throws `ArgumentsRequired` LOCALLY, before
        // any network call (Coinbase International: "fetchOHLCV() requires a since argument").
        // Retry once with a derived `since` asking for the same trailing window every other venue
        // answers by default. Venues that accept a since-less read never reach this branch, so
        // their behaviour is unchanged.
        const derived =
          opts?.since === undefined && requiresSinceError(err)
            ? defaultOhlcvSince(timeframe, opts?.limit ?? DEFAULT_SINCE_WINDOW_BARS, Date.now())
            : null
        if (derived === null) throw err
        const raw = await run(() => ex.fetchOHLCV(symbol, timeframe, derived, opts?.limit, params))
        return normalizeCandles(raw)
      }
    },

    async fetchOrderBook(symbol, limit): Promise<OrderBook> {
      requireCap('orderBook', 'order books')
      const raw = await run(() => ex.fetchOrderBook(symbol, limit))
      return normalizeOrderBook(raw, symbol, limit)
    },

    async fetchTrades(symbol, limit): Promise<PublicTrade[]> {
      requireCap('trades', 'the public trade feed')
      const raw = await run(() => ex.fetchTrades(symbol, undefined, limit))
      return raw.map(normalizeTrade).filter((t): t is PublicTrade => t !== null)
    },

    async fetchFundingRate(symbol): Promise<FundingRate | null> {
      const support = info.capabilities.fundingRate
      if (support === 'none') {
        throw new TradingError('not_supported', `${info.name} does not report funding rates.`)
      }
      // Funding is a derivative's mechanism. A spot market has none, and asking anyway makes a
      // network call to be told nothing.
      if (isKnownNonContract(ex, symbol)) return null

      // EMULATED: the venue serves only the plural read. Ask for exactly this symbol — and, for a
      // HIP-3 builder market, forward its dex scope so the plural read hits the right context (else
      // the main perps context answers nothing and Mark/Index/Funding all vanish). A read that comes
      // back empty stays absent (`null`), never a fabricated zero.
      const raw = await run(() => readFundingRateRaw(ex, symbol, support))
      return normalizeFundingRate(raw, symbol)
    },

    // ONE venue read serving both facts. Declared only when the venue exposes the primitives it is
    // built from; a venue without them keeps the two single reads (the service falls back).
    ...(supports(ex, 'fetchFundingRates') &&
    typeof ex.fetchSwapMarkets === 'function' &&
    typeof ex.parseFundingRates === 'function'
      ? {
          async fetchContractStats(symbol: string): Promise<ContractStats> {
            if (isKnownNonContract(ex, symbol)) return { fundingRate: null, openInterest: null }
            const raw = await run(() => readContractStatsRaw(ex, symbol))
            return {
              fundingRate: normalizeFundingRate(raw.funding, symbol),
              openInterest: normalizeOpenInterest(raw.openInterest, symbol),
            }
          },
        }
      : {}),

    async fetchOpenInterest(symbol): Promise<OpenInterest | null> {
      if (!info.capabilities.openInterest) {
        throw new TradingError('not_supported', `${info.name} does not report open interest.`)
      }
      if (isKnownNonContract(ex, symbol)) return null
      // A HIP-3 builder market's OI is unreachable through ccxt's own path (it drops the dex scope) —
      // `readOpenInterestRaw` routes it through `fetchSwapMarkets(scope)` + ccxt's own parser, and
      // leaves an ordinary market on the exact native call. An empty read stays absent (`null`).
      return normalizeOpenInterest(await run(() => readOpenInterestRaw(ex, symbol)), symbol)
    },
  }
}
