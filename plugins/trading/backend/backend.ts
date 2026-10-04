/**
 * Venue-neutral exchange backend port. The workbench (service, routes, resource provider,
 * agent tools, UI) talks to THIS interface only; `ccxt-backend.ts` is the one impl today.
 *
 * A native Hyperliquid impl (or a broker/DEX aggregator, or a paper-trading simulator)
 * drops in behind the same port with zero changes above it — exactly the pattern the
 * database workbench uses for its `DbDriver` port and the Docker workbench for its
 * `ContainerEngineBackend`.
 *
 * Every method here is a READ of public data — this workbench has no write half. The comment
 * that used to stand here explained when writes were safe to call; there are none.
 *
 * Historic note kept short on purpose:
 * gated by the SERVICE (`readonly`) before they ever reach a driver.
 */
import type {
  Candle,
  ExchangeInfo,
  Market,
  OrderBook,
  ExchangeCatalogEntry,
  FundingRate,
  OpenInterest,
  PublicTrade,
  Ticker,
  TradingConnectionConfig,
} from './contracts'

/** A contract's funding rate + open interest, read together. Either may be `null` when the venue
 *  reports it for this market but not that one — absent is never zero. */
export interface ContractStats {
  fundingRate: FundingRate | null
  openInterest: OpenInterest | null
}

export interface ExchangeBackend {
  /** Static capability + credential report. Never hits the network. */
  describe(): ExchangeInfo

  /**
   * Liveness + credential probe.
   *
   * Reachability is a PUBLIC call. Credentials, when supplied, are checked with ONE private read —
   * `loadMarkets` succeeding says nothing about an API key, and reporting "connection OK" from it
   * lets a user save a connection whose every account read will fail. A venue offering no private
   * read at all reports `credentialsChecked: false` rather than an unearned green.
   */
  probe(): Promise<ProbeResult>

  loadMarkets(reload?: boolean): Promise<Market[]>
  fetchTicker(symbol: string): Promise<Ticker>
  fetchTickers(symbols?: string[]): Promise<Ticker[]>

  /**
   * Prices for MANY symbols, cheaply — the read a market picker needs to show a last price beside
   * each row without paying the whole-venue fan-out an unscoped multi-ticker read costs on an
   * emulated venue (Hyperliquid: ~12 requests / ~13s for one unscoped `fetchTickers`).
   *
   * The impl groups the requested symbols by the market TYPE each can be narrowed to and issues ONE
   * scoped read per type, so K types cost K requests regardless of how many symbols each holds.
   *
   * The return is a SUBSET of `symbols`: a symbol ABSENT from it could not be priced cheaply —
   * unknown to the venue, or a builder/HIP-3 market only the multi-request read reaches — and the
   * caller shows NO price for it (never a `0`, a fabricated value, or another market's price). A
   * market therefore never vanishes from the picker; only its price column is blank. This is the
   * honest "no price right now" vs "price is X" distinction, carried by presence in the array.
   *
   * OPTIONAL on the port: a driver that cannot serve a cheap multi-symbol read simply omits it, and
   * the caller shows no prices at all — which is safe — rather than ever falling back to the costly
   * unscoped read.
   */
  fetchTickersScoped?: (symbols: string[]) => Promise<Ticker[]>
  /**
   * What a single-symbol {@link fetchTicker} will actually cost, so a caller can choose between
   * reading one symbol and reading (and caching) the whole venue.
   *
   * - `'cheap'` — one request for this symbol alone.
   * - `'bulk'` — the backend can only answer by reading many/all markets; N symbols cost N of those.
   *
   * Absent ⇒ assume `'bulk'` for a venue whose ticker capability is `'emulated'`. Getting this
   * wrong in the `'cheap'` direction turns three open chart tabs into three whole-venue reads.
   */
  tickerReadCost?(symbol: string): 'cheap' | 'bulk'
  /** `until` bounds the window the venue sends (not merely the page kept), which is what makes
   *  paging BACKWARDS through history cheap — see `ccxt-backend.ts`. */
  fetchOHLCV(
    symbol: string,
    timeframe: string,
    opts?: { since?: number; limit?: number; until?: number },
  ): Promise<Candle[]>
  fetchOrderBook(symbol: string, limit?: number): Promise<OrderBook>
  fetchTrades(symbol: string, limit?: number): Promise<PublicTrade[]>

  /**
   * A perpetual's funding rate. `null` for a market that has no funding (spot) or when the venue
   * reports none. Throws typed `not_supported` when the venue cannot answer at all.
   */
  fetchFundingRate(symbol: string): Promise<FundingRate | null>

  /** Contracts outstanding. `null` for a market with no open interest to report. */
  fetchOpenInterest(symbol: string): Promise<OpenInterest | null>

  /**
   * A contract's funding rate AND open interest from ONE venue read, when the venue publishes them
   * in one payload. Optional: a backend that cannot do this omits it and the caller falls back to
   * the two single reads.
   *
   * This exists because those two facts arrive together far more often than not — Hyperliquid
   * returns mark, index, funding, open interest and volume in a single `metaAndAssetCtxs`
   * response — and asking for them separately spends two round-trips, and on a rate-limited venue
   * two seconds of a SERIAL queue, on one payload. Every other read for that connection waits
   * behind the second one for nothing.
   */
  fetchContractStats?(symbol: string): Promise<ContractStats>

  /**
   * The loaded market tables, for a sibling client of the SAME venue to adopt (the websocket
   * client seeds from the REST client's tables in ~6ms rather than paying the venue read again).
   * Best-effort: `null` when this driver has none to share.
   */
  marketTable?(): Promise<unknown>

  /** Freed on teardown — the driver's sockets must never outlive its registry entry. */
  close(): Promise<void>
}

/** Builds a driver for a saved connection's config. Injectable so tests (and a future
 *  non-ccxt driver) can swap the whole exchange layer out. */
export type ExchangeBackendFactory = (config: TradingConnectionConfig) => Promise<ExchangeBackend>

/** Lists the exchange ids the installed driver can construct. */
/** What a probe could actually establish. */
export interface ProbeResult {
  /** `false` when no credentials were supplied, or the venue offers no private read to check them. */
  credentialsChecked: boolean
}

export type ExchangeCatalog = () => Promise<ExchangeCatalogEntry[]>

// ── Live streaming (ccxt.pro) ────────────────────────────────────────────────────
//
// The REST port above is request/response. The streaming port below is the push
// counterpart: a long-lived venue websocket the `pro-backend.ts` impl drives with a
// `while (running) await ex.watchX()` loop. It matters most where a venue has NO REST
// equivalent — e.g. an on-chain perp DEX whose public trade tape exists ONLY over the
// socket. Everything it emits is ALREADY normalized through `normalize.ts`, so no
// driver type escapes (identical discipline to `ExchangeBackend`).

/** A push channel a venue may expose over its websocket. Reported per-venue (a driver
 *  says which it `supports`), never assumed. */
export type StreamChannel =
  | 'ticker'
  | 'ohlcv'
  | 'orderbook'
  | 'trades'
  | 'orders'
  | 'positions'
  | 'balance'
  | 'myTrades'

/** What to watch. `symbol` is required for the public per-market channels
 *  (ticker/ohlcv/orderbook/trades); `timeframe` only for `ohlcv`; the private account
 *  channels (orders/positions/balance) take neither. `myTrades` is private and may
 *  OPTIONALLY be scoped to a symbol. */
export interface StreamParams {
  channel: StreamChannel
  symbol?: string
  timeframe?: string
}

/**
 * One already-normalized push update. Discriminated on `channel`, carrying only the
 * agnostic contract shapes — a consumer never sees a ccxt structure. `ohlcv` carries the
 * venue's rolling window whose LAST bar is the in-progress bar (the client upserts by
 * `time`); `orderbook` is a fresh snapshot (the driver copies out of ccxt's mutable book
 * before emitting).
 */
export type StreamPayload =
  | { channel: 'ticker'; symbol: string; ticker: Ticker }
  | { channel: 'ohlcv'; symbol: string; timeframe: string; candles: Candle[] }
  | { channel: 'orderbook'; symbol: string; orderBook: OrderBook }
  | { channel: 'trades'; symbol: string; trades: PublicTrade[] }

/**
 * The push-stream port — one instance per LIVE venue websocket client (pooled per
 * connection by the stream registry). It multiplexes several concurrent watch loops
 * over that one client; each `watch` call runs ONE loop until its `signal` aborts (the
 * registry's granular per-channel stop) or the venue ends the stream. `stop` aborts
 * every loop at once (teardown), `close` releases the client. `supports` gates a channel
 * BEFORE a loop opens — crucially it reports `false` for the private account channels
 * when the connection carries no credentials, so the registry never opens an
 * authenticated socket for a public connection.
 */
export interface ExchangeStreamBackend {
  /** Whether this client can serve `channel` (venue capability + credentials for private channels). */
  supports(channel: StreamChannel): boolean
  /** Run ONE watch loop, invoking `onData` on every update. Resolves when `signal`
   *  aborts or the venue ends the stream; rejects (mapped to a TradingError) on a fatal
   *  error so the registry can restart it with backoff. */
  watch(
    params: StreamParams,
    onData: (payload: StreamPayload) => void,
    signal: AbortSignal,
  ): Promise<void>
  /** Abort every in-flight loop on this client. */
  stop(): void
  /** Close the underlying client. Idempotent + best-effort. */
  close(): Promise<void>
}

/**
 * Builds a streaming client for a resolved connection config. Returns `null` when the
 * venue has NO `ccxt.pro` driver at all — the caller then degrades to REST polling
 * rather than treating the absence as an error. Injectable so tests swap the whole
 * socket layer for a fake.
 */
export interface ExchangeStreamOptions {
  /**
   * Hand the new client an already-loaded market table instead of making it fetch its own (see
   * `ExchangeBackend.marketTable`). Best-effort: a `null` / a throw / an unusable shape must
   * leave the client loading its own, never broken.
   */
  seedMarketTable?: () => Promise<unknown>
}

export type ExchangeStreamFactory = (
  config: TradingConnectionConfig,
  opts?: ExchangeStreamOptions,
) => Promise<ExchangeStreamBackend | null>
