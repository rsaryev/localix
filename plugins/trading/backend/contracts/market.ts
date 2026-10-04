/**
 * Market-data vocabulary — the PUBLIC, read-only half of the workbench: what a venue can
 * do (`ExchangeInfo`), what it lists (`Market`), and what it currently quotes (`Ticker`,
 * `Candle`, `OrderBook`, `PublicTrade`, funding / open interest).
 *
 * This is the surface the plugin actually registers. Nothing here mentions ccxt: the
 * driver normalizes its raw structures into these shapes.
 */
import { z } from 'zod'
import type { CredentialField, MarketType } from './connection'
// `PublicTrade.side` reuses the order-side vocabulary — a tape print is a buy or a sell.
import type { OrderSide } from './account'

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
   * What this plugin can actually do at the venue — RESEARCH READS ONLY.
   *
   * The account and order family used to live here too (balance, positions, openOrders, myTrades,
   * fetchOrder, fetchClosedOrders, createOrder, cancelOrder, closePosition, cancelAllOrders,
   * triggerOrders, takeProfitStopLoss, setLeverage, setMarginMode, editOrder, fundingHistory) and
   * every one was probed, reported over the route, and PRINTED TO THE MODEL by `market_data` as
   * something the venue "can actually honour". After the plugin was stripped to research
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

/**
 * A perpetual's funding rate — the periodic payment between longs and shorts.
 *
 * `rate` is the fraction charged ONCE PER `interval`. It is NOT a daily or annual figure, and the
 * interval is venue-specific: Hyperliquid funds every `1h`, most venues every `8h`. Multiplying a
 * rate by three to "get the daily cost" is wrong on Hyperliquid by a factor of eight, so the
 * interval travels with the rate and nothing derives an annualised number from it.
 */
export interface FundingRate {
  symbol: string
  /** Fractional rate per `interval` (`0.0000125` = 0.00125% each period). Sign: positive means
   *  longs pay shorts. */
  rate: number
  /** The venue's funding period (`1h`, `8h`). Absent when unreported — never assume a default. */
  interval?: string
  markPrice?: number
  indexPrice?: number
  /** Unix ms of the settlement THIS `rate` applies to, when the venue reports it. Taken from
   *  ccxt's `fundingTimestamp` (NOT `nextFundingTimestamp`, which is the settlement after it and
   *  carries a different rate). */
  nextFundingTime?: number
}

/** Contracts outstanding in a derivative market. */
export interface OpenInterest {
  symbol: string
  /** Contracts outstanding, in the market's BASE units. */
  amount?: number
  /** Quote-currency value — reported by the venue only, NEVER derived from `amount × price`. */
  value?: number
  /** Unix ms. */
  timestamp?: number
}

/**
 * ONE settled funding payment on the account — the periodic cash a perpetual holder actually
 * paid or received. This is the fact `unrealizedPnl` hides: a leveraged position held for hours
 * can have its whole paper gain erased by funding, so a portfolio that shows PnL and not funding
 * is making a claim about money that is wrong.
 *
 * These are DATED SETTLEMENTS from the account's history, NOT an "accrued since entry" figure —
 * different facts, deliberately not conflated. (Accrued-since-entry exists on some venues only in
 * a venue-SPECIFIC position payload, which the agnostic port cannot read without special-casing a
 * venue; funding is therefore reported account-scoped, from this settlement history, not
 * per-position.)
 *
 * ⚠ SIGN — verified LIVE against Hyperliquid, 20/20 settlements cross-checked against position side
 * and the applied rate: `amount > 0` means the account **RECEIVED** funding (income); `amount < 0`
 * means it **PAID** funding (a cost). This is the OPPOSITE of {@link FundingRate.rate} (there a
 * positive rate means longs pay shorts) — a genuine trap, so the sign is stated, never inferred from
 * the rate. Net funding is the sum of amounts: a negative net is a net cost eating into PnL.
 */
export interface FundingPayment {
  symbol: string
  /** Quote-currency funding for this settlement. POSITIVE = received, NEGATIVE = paid (see above).
   *  A settlement whose amount the venue did not report is dropped entirely (like a fill with no
   *  price) — an unreadable amount is not a zero payment. */
  amount: number
  /** Settlement (quote) currency, when the venue reports it (Hyperliquid: `USDC`). */
  currency?: string
  /** The funding rate that applied at this settlement, when reported. Carried for context; the
   *  cash actually moved is `amount`, and the rate's sign follows the {@link FundingRate}
   *  convention, NOT `amount`'s. */
  rate?: number
  /** Unix ms of the settlement. */
  timestamp?: number
}

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

/** The verdict of "Test connection": reachable, and — when credentials were given — usable. */
export interface TestResult {
  exchange: ExchangeInfo
  /** `false` when no credentials were supplied, or the venue offers no private read to check them. */
  credentialsChecked: boolean
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

/**
 * One of the ACCOUNT's OWN executed trades (a "fill") — where money actually changed hands, as
 * opposed to a `PublicTrade` (the venue-wide tape) or an `Order` (an intent that may never fill).
 * An order says where you asked to trade; a fill says where you did, at what fee, and as maker
 * or taker. It is the only record that answers "what did this position really cost me".
 */
export interface MyTrade {
  id: string
  /** The order this fill came from, when the venue reports it — one order may fill many times. */
  orderId?: string
  symbol: string
  side: OrderSide
  price: number
  amount: number
  /** Quote-currency value, `price * amount`, when the venue reports it. */
  cost?: number
  /** Unix MILLISECONDS. ABSENT when the venue did not stamp the fill — `0` would date it to the
   *  epoch, which every renderer would then print as a trade made on 1 Jan 1970. */
  timestamp?: number
  takerOrMaker?: 'taker' | 'maker'
  fee?: { cost: number; currency?: string }
}
