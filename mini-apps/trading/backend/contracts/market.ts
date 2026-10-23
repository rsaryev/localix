/**
 * Market-data vocabulary — the PUBLIC, read-only half of the workbench: what a venue can
 * do (`ExchangeInfo`), what it lists (`Market`), and what it currently quotes (`Ticker`,
 * `Candle`, `OrderBook`, `PublicTrade`, funding / open interest).
 *
 * This is the surface the mini app actually registers. Nothing here mentions ccxt: the
 * driver normalizes its raw structures into these shapes.
 */
import { z } from 'zod'
import type { CredentialField, MarketType } from './connection'

// ── Market data ────────────────────────────────────────────────────────────────

/**
 * How a venue's `Market.precision` numbers must be READ. This is not cosmetic: the major
 * venues (Hyperliquid, Binance, Bybit) report `tick`, where `precision.price = 1` means the
 * price steps by 1 — NOT "one decimal place". Reading a tick as a decimal count silently
 * builds orders the venue rejects, or worse, quietly rounds them somewhere else.
 *
 * Rounding for SUBMISSION is done by the driver (which owns the venue's own rounding rules);
 * this field exists so a CLIENT can format and preview a value the same way.
 */
export const precisionModeSchema = z.enum(['decimals', 'significant', 'tick'])
export type PrecisionMode = z.infer<typeof precisionModeSchema>

/**
 * PROVENANCE of an operation a venue might lack natively. A venue without the operation is
 * NOT the same as the user lacking it: where the venue exposes the primitives, the workbench
 * EMULATES the call agnostically (`emulated`), otherwise reports `none`. `native` = the
 * venue's own call.
 *
 * The UI keys off this precisely so it never offers a button the venue cannot honour
 * (`none`) yet never hides one the venue CAN honour by emulation (`emulated`).
 */
export const operationSupportSchema = z.enum(['native', 'emulated', 'none'])
export type OperationSupport = z.infer<typeof operationSupportSchema>

/** What a driver can do — reported, never assumed. Mirrors ccxt's `has` map, agnostically. */
export interface ExchangeInfo {
  id: string
  name: string
  /** How to interpret every `Market.precision` value this venue reports. */
  precisionMode: PrecisionMode
  /** Supported OHLCV timeframes, in the venue's own notation (`1m`, `4h`, `1d`, …). */
  timeframes: string[]
  /** Credential fields the venue REQUIRES for private calls. */
  requiredCredentials: CredentialField[]
  /**
   * What this mini app can actually do at the venue — RESEARCH READS ONLY.
   *
   * The account and order family used to live here too (balance, positions, openOrders, myTrades,
   * fetchOrder, fetchClosedOrders, createOrder, cancelOrder, closePosition, cancelAllOrders,
   * triggerOrders, takeProfitStopLoss, setLeverage, setMarginMode, editOrder, fundingHistory) and
   * every one was probed, reported over the route, and PRINTED TO THE MODEL by `market_data` as
   * something the venue "can actually honour". After the mini app was stripped to research
   * (`e550f0cb1`: no keys, no account, no orders — and the ccxt client is now built without
   * credentials, so a private call cannot even authenticate) those were claims about operations that
   * no longer exist anywhere in the codebase. An agent asked to place an order read `createOrder` in
   * a capability list and had every reason to believe it could.
   *
   * They are DELETED rather than filtered at the renderer, so no probe can put them back and no
   * consumer can print them: the same reasoning the strip commit gave for removing the order path
   * instead of gating it. A future account surface re-adds the keys WITH the reads that back them.
   */
  capabilities: {
    /**
     * A single-market ticker read. PROVENANCE, not a bare boolean: on some venues
     * (Hyperliquid) `fetchTicker` is `emulated` — ccxt synthesizes it by fetching AND
     * parsing EVERY market, which is expensive enough to starve the event loop. A caller
     * that sees `emulated` can serve one symbol out of the (cached) full `fetchTickers`
     * map instead of paying that cost per symbol, and the client can back its poll off.
     */
    ticker: OperationSupport
    ohlcv: boolean
    orderBook: boolean
    trades: boolean
    /**
     * A perpetual's funding rate. PROVENANCE, not a bare boolean: Hyperliquid reports
     * `fetchFundingRate: false` but `fetchFundingRates: true`, so the single-symbol read is
     * `emulated` from the plural one. A `none` venue simply has no funding to report.
     */
    fundingRate: OperationSupport
    /** Contracts outstanding in a derivative market. */
    openInterest: boolean
    /** A live push stream exists (websocket), vs poll-only. */
    watch: boolean
  }
}

export interface Market {
  /** Unified symbol, e.g. `BTC/USDC:USDC`. The id used everywhere above the driver. */
  symbol: string
  base: string
  quote: string
  type: MarketType
  active: boolean
  /** Linear/inverse contract venues only. */
  contract: boolean
  /**
   * How much of `base` ONE contract represents, on a contract market that states it.
   *
   * Every `amount` in this workbench — an order's size, a position's `contracts`, `limits.minAmount`
   * — is denominated in whatever the venue counts, and on a contract market that is CONTRACTS, not
   * base units. Hyperliquid sets `1`, so the two coincide and the distinction is invisible there.
   * OKX does not: `BTC-USDT-SWAP` has `ctVal` 0.01, so a size of `5` is 0.05 BTC. Labelling that
   * `5 BTC` overstates the position a hundredfold.
   *
   * ABSENT means the venue did not state it — never assume `1`, which is a claim about size.
   */
  contractSize?: number
  /**
   * `true` = a LINEAR contract (one contract is `contractSize` of the BASE, settled in quote),
   * `false` = an INVERSE one (one contract is `contractSize` of the QUOTE). Absent on spot, and on
   * a contract market the venue did not classify — where an order cannot be valued at all.
   */
  linear?: boolean
  precision: { price?: number; amount?: number }
  limits: { minAmount?: number; minCost?: number; maxLeverage?: number }
  /**
   * The third party that DEPLOYED this market inside the exchange, when the venue says there is
   * one — Hyperliquid's HIP-3 "builder dexes" are the case in hand: `AAPL` exists there four times
   * over (a canonical spot market plus one perp per builder, on different quote currencies, with
   * different liquidity and different liquidation risk). Two rows reading `AAPL` are two different
   * instruments, so the operator has to travel with the market or a picker cannot tell them apart.
   *
   * ABSENT means the exchange itself lists the market. It is never inferred from the symbol.
   */
  operator?: string

  /**
   * The venue's REPORTED trading fee RATES for this market, as fractions (`0.00045` = 0.045%): the
   * `maker` rate rests-and-adds liquidity, the `taker` rate crosses-and-removes it. Verified live —
   * Hyperliquid populates both on every market (perps maker 0.00015 / taker 0.00045, spot maker
   * 0.0004 / taker 0.0007). Each is OPTIONAL because a venue that reports no rate has an UNKNOWN fee,
   * never a zero one: an absent field means the ticket shows no fee estimate, never `0`.
   */
  fees?: { maker?: number; taker?: number }
}

export type { FundingRate, OpenInterest, FundingPayment } from './derivatives'

/**
 * One row of the "connect an exchange" picker: enough to name a venue and to ASK FOR THE RIGHT
 * CREDENTIALS, without instantiating a driver or touching the network. The full `ExchangeInfo`
 * needs a live connection; this is what exists before one.
 */
export interface ExchangeCatalogEntry {
  id: string
  /** The venue's display name (`Hyperliquid`), not its id (`hyperliquid`). */
  name: string
  /** Which of our credential fields the venue marks required. Drives the form. */
  requiredCredentials: CredentialField[]
}

export interface Ticker {
  symbol: string
  /** Unix ms. ABSENT when the venue did not stamp the quote — Hyperliquid stamps `0`, which the
   *  consumers treat the same way: unknown, never a date in 1970. */
  timestamp?: number
  last?: number
  bid?: number
  ask?: number
  high?: number
  low?: number
  /** Base-currency volume over the venue's rolling 24h window. */
  baseVolume?: number
  quoteVolume?: number
  /** Fractional change over 24h (0.031 = +3.1%). */
  change?: number
  /** The price 24h ago, when the venue reports one. See `normalizeTicker`. */
  previousClose?: number
}

/** One OHLCV bar. `time` is UNIX SECONDS — the unit charting libraries want. */
export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  /** ABSENT when the venue reported no volume for this bar. `0` is a claim that nothing traded in
   *  it — and a window of such bars sums to a 24h volume of zero, which reads as a dead market. */
  volume?: number
}

/** `[price, amount]`, best-first. */
export type OrderBookLevel = [number, number]

export interface OrderBook {
  symbol: string
  /** Unix ms. ABSENT when the venue did not stamp the snapshot. */
  timestamp?: number
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
}

export interface PublicTrade {
  id?: string
  /** Unix ms. ABSENT when the venue did not stamp the print — never `0`, which dates it to 1970. */
  timestamp?: number
  price: number
  amount: number
  side: 'buy' | 'sell'
}
