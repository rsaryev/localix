/**
 * Route payload schemas + the response envelope of every `/rpc/trading` endpoint.
 *
 * `TradingResponses` is named ONCE and pinned by both ends of the wire — the route handlers
 * return it, the UI client reads it — so the two cannot drift. They drifted before (see the
 * type's own note).
 *
 * Public market data only — there are no account, execution or credential payloads, because
 * this workbench has no route that could accept one.
 */
import { z } from 'zod'
import { marketTypeSchema } from './connection'
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
} from './market'
import { DEFAULT_TIMEFRAME } from '../timeframes'

// ── Route payload schemas ──────────────────────────────────────────────────────

export const ohlcvQuerySchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1).default(DEFAULT_TIMEFRAME),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  /** Unix ms lower bound. */
  since: z.coerce.number().int().nonnegative().optional(),
  /** Unix ms upper bound. Bounds the window the VENUE sends, not just the page kept: a `since`
   *  alone makes ccxt request `[since, now]` and discard everything past `limit`. Measured on
   *  Hyperliquid, ten pages back on `1m`: 5179 bars downloaded to keep 500. */
  until: z.coerce.number().int().nonnegative().optional(),
})

export const symbolQuerySchema = z.object({ symbol: z.string().min(1) })

/**
 * Body for the multi-symbol price read (`POST /connections/:id/tickers`). POST, not GET: a market
 * picker page can carry up to 500 symbols and a unified symbol (`XYZ-SP500/USDC:USDC`) is ~25 chars
 * that must be percent-encoded — well past a comfortable query-string length — so the list rides a
 * JSON body. The read is idempotent and side-effect-free despite the verb.
 */
export const tickersRequestSchema = z.object({
  symbols: z.array(z.string().min(1)).min(1).max(500),
})

export const depthQuerySchema = z.object({
  symbol: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const marketsQuerySchema = z.object({
  /** Substring filter over the unified symbol. */
  query: z.string().optional(),
  type: marketTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  /** Force a fresh market-table read from the venue (bypass + rewrite the disk cache). The sidebar
   *  Refresh sets this; ordinary loads serve the cached table. `stringbool`, not `coerce.boolean`:
   *  the query strings `'false'` and `'0'` must mean FALSE, and `Boolean('false')` is true —
   *  coercion would spend the ~14s whole-venue reload on a caller trying to decline it. */
  reload: z.stringbool().optional(),
})

export interface TradingErrorResponse {
  error: string
  code: string
  detail?: string
}

/**
 * The JSON envelope of every `/rpc/trading` response, named ONCE.
 *
 * The route handlers pin their return to these types and the UI client reads them, so the two ends
 * of the wire cannot drift. They drifted before: `/exchanges` returned ccxt's `string[]` while the
 * client asserted `ExchangeInfo[]`, and nothing objected — `get<T>()` casts an unvalidated body, so
 * a generic argument is a claim about the server, not a check of it. The picker rendered nothing and
 * the connect form asked for no credentials.
 *
 * A `satisfies`/explicit-type-argument on the route is what turns that claim into a checked one.
 */
export interface TradingResponses {
  exchanges: { exchanges: ExchangeCatalogEntry[] }
  describe: { exchange: ExchangeInfo }
  markets: { markets: Market[] }
  ticker: { ticker: Ticker }
  /** Prices for the requested symbols — a SUBSET (an unpriceable symbol is simply absent). */
  tickers: { tickers: Ticker[] }
  ohlcv: { symbol: string; timeframe: string; candles: Candle[] }
  orderBook: { orderBook: OrderBook }
  trades: { trades: PublicTrade[] }
  funding: { funding: FundingRate | null }
  openInterest: { openInterest: OpenInterest | null }
}
