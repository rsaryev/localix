/**
 * The trading service's public surface: its options and the {@link TradingService} port every
 * consumer (routes, agent tools, stream registry, UI) programs against.
 *
 * Reads only — there is no write half to program against. See `service.ts` for why that is a
 * structural property of this workbench rather than a policy it enforces.
 */
import type {
  ExchangeBackendFactory,
  ExchangeCatalog,
  ExchangeStreamBackend,
  ExchangeStreamFactory,
} from './backend'
import type { MarketTableCache } from './market-table-cache'
import type {
  Candle,
  ExchangeCatalogEntry,
  ExchangeInfo,
  FundingRate,
  Market,
  OpenInterest,
  OrderBook,
  PublicTrade,
  Ticker,
} from './contracts'
import type { TradingConnectionStore } from './store'

export interface TradingServiceOptions {
  store: TradingConnectionStore
  /** Injectable driver factory — defaults to the ccxt impl. */
  createBackend?: ExchangeBackendFactory
  /** Injectable exchange-id catalog — defaults to ccxt's. */
  catalog?: ExchangeCatalog
  /** Injectable websocket-client factory — defaults to the ccxt.pro impl. */
  createStream?: ExchangeStreamFactory
  /** Shared, venue-keyed disk cache for the heavy market table, bound onto the DEFAULT ccxt factory
   *  so the ~14s `loadMarkets` is paid once across processes, not per connect. Absent ⇒ every connect
   *  loads from the venue. Ignored when `createBackend` is injected (a test's fake exchange). */
  marketCache?: MarketTableCache
}

export interface TradingService {
  /** Every exchange id the installed driver can construct. */
  exchanges(): Promise<ExchangeCatalogEntry[]>

  describe(userId: string, id: string): Promise<ExchangeInfo>
  /** `reload: true` forces a fresh market-table read from the VENUE (bypassing the disk cache and
   *  rewriting it) — the sidebar Refresh's escape hatch for a market listed within the cache TTL. */
  markets(
    userId: string,
    id: string,
    opts?: { query?: string; type?: string; limit?: number; reload?: boolean },
  ): Promise<Market[]>
  ticker(userId: string, id: string, symbol: string): Promise<Ticker>
  /** Prices for many symbols cheaply (one bounded read per market type / builder dex — see the
   *  driver's `fetchTickersScoped`). The result is a SUBSET of `symbols`: a symbol absent from it had
   *  no cheap price and the caller shows none for it. Never pays the whole-venue fan-out — a driver
   *  that cannot read in bulk throws `not_supported` rather than answering with a misleading `[]`. */
  tickers(userId: string, id: string, symbols: string[]): Promise<Ticker[]>
  ohlcv(
    userId: string,
    id: string,
    symbol: string,
    timeframe: string,
    opts?: { since?: number; limit?: number; until?: number },
  ): Promise<Candle[]>
  orderBook(userId: string, id: string, symbol: string, limit?: number): Promise<OrderBook>
  trades(userId: string, id: string, symbol: string, limit?: number): Promise<PublicTrade[]>
  /** A perpetual's funding rate; `null` for a market with no funding. */
  fundingRate(userId: string, id: string, symbol: string): Promise<FundingRate | null>
  /** Contracts outstanding; `null` for a market with none to report. */
  openInterest(userId: string, id: string, symbol: string): Promise<OpenInterest | null>
  buildStreamBackend(userId: string, id: string): Promise<ExchangeStreamBackend | null>

  closeAll(): Promise<void>
}
