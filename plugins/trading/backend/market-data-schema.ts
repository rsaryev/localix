/**
 * The `market_data` tool's input schema, its result shape and its window constants — shared by
 * the per-mode handlers (`market-data-overview.ts` / `market-data-symbol.ts`) and the tool
 * itself (`market-data.ts`).
 */
import { z } from 'zod'

export interface MarketDataDetails {
  connections?: Array<{ id: string; name: string; exchange: string }>
  connection?: string
  exchange?: string
  symbol?: string
  timeframe?: string
  candles?: number
}

/** What every `market_data` mode hands back to the tool loop. */
export interface MarketDataResult {
  content: string
  isError?: boolean
  details?: MarketDataDetails
}

/** Markets listed in the browse roster before truncating (token-bounded). */
export const MAX_MARKETS = 60
/** Default OHLCV window when the model doesn't pass one. */
export const DEFAULT_CANDLES = 30

export const marketDataInputSchema = z.object({
  connection_id: z
    .string()
    .optional()
    .describe(
      'Omit to list the trading connections. Pass a connection id to see its exchange, capabilities and markets.',
    ),
  symbol: z
    .string()
    .optional()
    .describe(
      'With connection_id, quote one market by its UNIFIED symbol, e.g. `BTC/USDC:USDC`, `ETH/USDT`, `SOL/USDC`.',
    ),
  symbols: z
    .array(z.string())
    .min(1)
    .max(20)
    .optional()
    .describe(
      'With connection_id (and WITHOUT symbol), quote several markets at once — last price, 24h change and ' +
        'volume for each, in one bounded venue read. Use this to compare or watch a basket instead of calling ' +
        'once per symbol. A symbol the venue could not price in this read shows no price; that means unpriced, ' +
        'never zero.',
    ),
  timeframe: z
    .string()
    .optional()
    .describe('OHLCV timeframe for the candles (default `1h`); must be one the exchange supports.'),
  candles: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('How many recent candles to include with a symbol (default 30, max 200).'),
  indicators: z
    .array(z.string())
    .min(1)
    .max(12)
    .optional()
    .describe(
      'With symbol: compute indicator values SERVER-SIDE over the fetched candles — parameterized ids like ' +
        '`ema:200`, `sma:50`, `rsi:14`, `bb:20:2`, `macd:12:26:9`, `vwap`, `supertrend:10:3`, `stoch:14:3:3`, ' +
        '`atr:14`, `obv`, `adx:14`, `volume` (bare kinds take defaults). The same math the chart draws — no ' +
        'chart tab needs to be open. The lookback window is the fetched candles: `ema:200` needs `candles` ≥ 200.',
    ),
  depth: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Order-book depth per side to show with a symbol (default 10, max 50).'),
  size: z
    .number()
    .positive()
    .optional()
    .describe(
      'With symbol + side: estimate what a MARKET order of this size would pay by walking the visible order book — ' +
        'average fill price and how much worse than the top of book. Sized in the unit the venue counts (CONTRACTS on ' +
        'a contract market — the order-constraints block below states which). Read this before placing a market order: ' +
        'a size larger than the visible depth reports a LOWER BOUND, not the real cost.',
    ),
  compare_with: z
    .string()
    .optional()
    .describe(
      'With symbol: PAIR analysis against this second unified symbol on the same connection — ' +
        'correlation and beta of log returns plus the ratio z-score over a 60-bar lookback ' +
        '(|z| ≥ 2 = the classic mean-reversion stretch). Use it before any spread/pairs idea.',
    ),
  side: z
    .enum(['buy', 'sell'])
    .optional()
    .describe(
      'Which side the `size` would take: a buy walks the asks, a sell walks the bids. Required with `size`.',
    ),
})

export type MarketDataInput = z.infer<typeof marketDataInputSchema>
