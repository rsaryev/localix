/**
 * The narrow READ-ONLY port + data shapes the market_data tool speaks.
 *
 * Kept apart from the tool so the CONTRACT is readable without the renderer and the
 * schema in the way. By construction the port has NO order-placing / cancelling method:
 * it is STRUCTURALLY impossible for this tool to mutate an account.
 */
import type { ExchangeInfo, PrecisionMode } from './contracts'
import type { MarketFees } from './fees'

/**
 * Narrow READ-ONLY port the market_data tool needs — the mini app's `register()`
 * (`backend/index.ts`) adapts the READ methods of the trading service onto it, so this
 * file never imports the service (or a driver). By construction the port has NO
 * order-placing / cancelling method: it is STRUCTURALLY impossible for this tool to
 * mutate an account. Introspection only.
 */
export interface MarketDataConnection {
  id: string
  name: string
  exchangeId: string
  sandbox: boolean
  readonly: boolean
  connected: boolean
}
export interface MarketDataCaps {
  id: string
  name: string
  timeframes: string[]
  /** How to READ the venue's `Market.precision` numbers. NOT a rounding law — see `precisionModeNote`. */
  precisionMode: PrecisionMode
  /**
   * The venue's REPORTED capabilities. Note the two `OperationSupport` members: they are the
   * strings `'native' | 'emulated' | 'none'`, NOT booleans. A truthiness test over this object
   * reports `'none'` as SUPPORTED — which is how the agent came to be told a venue could close a
   * position it cannot. Use {@link supportedCapabilities}.
   */
  capabilities: ExchangeInfo['capabilities']
}

/** Values a capability may take. Only these three mean "the venue can do it". */
function isSupported(value: unknown): boolean {
  return value === true || value === 'native' || value === 'emulated'
}

/**
 * The capability names the venue can actually honour, with an emulated one marked as such.
 * `'none'` is a STRING and therefore truthy: a naive `filter(([, v]) => v)` promises the agent an
 * operation that will be refused with `not_supported` the moment it tries.
 */
export function supportedCapabilities(capabilities: ExchangeInfo['capabilities']): string[] {
  return Object.entries(capabilities).flatMap(([k, v]) =>
    isSupported(v) ? [v === 'emulated' ? `${k} (emulated)` : k] : [],
  )
}
export interface MarketDataMarket {
  symbol: string
  base: string
  quote: string
  type: string
  active: boolean
  /**
   * The third party that deployed this market inside the exchange, when there is one. Absent means
   * the exchange itself lists it. Load-bearing for an agent: on Hyperliquid `AAPL` exists four times
   * over — the exchange's own spot market plus one perp per builder, on different quote currencies,
   * with different liquidity and different liquidation risk. A roster that printed only the symbol
   * would invite the agent to quote one and trade another.
   */
  operator?: string
  /** Whether the venue counts this market in CONTRACTS rather than base units. */
  contract: boolean
  /** How much base ONE contract is, when a contract market states it. See `size-unit.ts`. */
  contractSize?: number
  /** Whether a contract settles in the QUOTE currency. Carried ONLY when the venue states it —
   *  without it a contract market cannot be valued at all (`notionalOf` returns undefined), so an
   *  unclassified market gets no fee estimate rather than a wrong one. */
  linear?: boolean
  /** The venue's REPORTED precision, read under its `precisionMode`. */
  precision: { price?: number; amount?: number }
  limits: { minAmount?: number; minCost?: number; maxLeverage?: number }
  /** The venue's REPORTED fee rates. Absent ⇒ unknown, never free. */
  fees?: MarketFees
}
export interface MarketDataTicker {
  symbol: string
  last?: number
  bid?: number
  ask?: number
  high?: number
  low?: number
  baseVolume?: number
  /** Turnover in the QUOTE currency. Some venues (Hyperliquid) report only this one. */
  quoteVolume?: number
  change?: number
}
export interface MarketDataCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  /** ABSENT when the venue reported none for this bar. Never `0`, which says nothing traded. */
  volume?: number
}
export interface MarketDataBook {
  bids: Array<[number, number]>
  asks: Array<[number, number]>
}
export interface MarketDataPort {
  listConnections(): Promise<MarketDataConnection[]>
  describe(connectionId: string): Promise<MarketDataCaps>
  markets(
    connectionId: string,
    opts?: { query?: string; limit?: number },
  ): Promise<MarketDataMarket[]>
  ticker(connectionId: string, symbol: string): Promise<MarketDataTicker>
  /** Optional: prices for MANY symbols in one bounded read. The result is a SUBSET — a symbol the
   *  venue could not price cheaply is simply absent, never zero. A driver with no cheap multi-symbol
   *  read omits this, and the tool says so rather than quoting one symbol at a time behind the
   *  agent's back. */
  tickers?(connectionId: string, symbols: string[]): Promise<MarketDataTicker[]>
  ohlcv(
    connectionId: string,
    symbol: string,
    timeframe: string,
    limit: number,
  ): Promise<MarketDataCandle[]>
  orderBook(connectionId: string, symbol: string, depth: number): Promise<MarketDataBook>
  /** Optional: a venue with no derivatives (or no funding read) simply omits the section. */
  fundingRate?(connectionId: string, symbol: string): Promise<MarketDataFunding | null>
  openInterest?(connectionId: string, symbol: string): Promise<MarketDataOpenInterest | null>
}

/** The cost of HOLDING a perpetual, as the venue states it. */
export interface MarketDataFunding {
  rate: number
  interval?: string
  markPrice?: number
  indexPrice?: number
  nextFundingTime?: number
}
export interface MarketDataOpenInterest {
  amount?: number
  value?: number
}

export interface MarketDataToolOptions {
  port: MarketDataPort
}
