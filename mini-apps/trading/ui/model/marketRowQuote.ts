import type { Market, PrecisionMode, Ticker } from '../../backend/contracts'
import { sizeUnit } from '../../backend/size-unit'
import { formatCompactVolume, formatPercent, formatPrice } from './formatQuote'

/**
 * Pure shaping of a market-picker row's price cell from a ticker the backend priced cheaply.
 *
 * The one rule this file enforces: a number beside a market is a claim about money, so it is shown
 * ONLY when the venue actually gave us one. A row with no ticker (its symbol was unpriceable this
 * page — unknown, or a builder/HIP-3 market the cheap read cannot reach) yields `null` and renders
 * NOTHING in the price column — never a `0`, never a `—` dressed to look like a price, never a stale
 * price carried over from another market.
 *
 * 24h change is even stricter: it appears only when `Ticker.change` is present. `normalizeTicker`
 * derives that from the venue's OWN 24h datum (`percentage`, else `prevDayPx`→`previousClose`) and
 * leaves it `undefined` when the venue reports neither — so a thin ticker (Hyperliquid quotes last +
 * quote volume only) simply shows no change, rather than a figure invented from a field that does
 * not mean "24h". Absent ≠ zero here too.
 *
 * Volume follows the same rule and one more: it NAMES ITS UNIT. Base volume counts coins and quote
 * volume counts dollars, and on a cheap asset the two differ by four orders of magnitude — a column
 * of bare numbers mixing them would rank the markets wrong in the reader's head. It costs nothing to
 * show: the venue already sent it inside the ticker this row is priced from.
 *
 * Pure so every rule is unit-tested.
 */
export interface MarketRowQuote {
  /** The last price, formatted to the market's precision. Present only for a real quote. */
  price: string
  /** The signed 24h change + tint sign — present only where the venue reports the 24h datum. */
  change?: { text: string; sign: -1 | 0 | 1 }
  /** Traded volume with the unit it is counted in. Present only where the venue reports one. */
  volume?: { text: string; unit: string }
}

/**
 * A row's price + optional 24h change, or `null` when there is no honest price to show.
 *
 * `ticker` is `undefined` for a symbol this page could not price cheaply; `mode` is the venue's
 * precision mode (`'tick'` for every venue ccxt currently ships, the safe default a picker uses
 * when it has not fetched `describe`).
 */
export function marketRowQuote(
  ticker: Ticker | undefined,
  market: Market,
  mode: PrecisionMode = 'tick',
): MarketRowQuote | null {
  const last = ticker?.last
  if (last == null || !Number.isFinite(last)) return null
  const quote: MarketRowQuote = { price: formatPrice(last, market, mode) }
  if (ticker?.change != null && Number.isFinite(ticker.change)) {
    quote.change = formatPercent(ticker.change)
  }
  // Prefer base volume (coins) and say so; fall back to quote volume (the quote currency) and say
  // THAT. A venue reporting neither shows no volume — never a zero, which would read as an untraded
  // market rather than as an unreported number.
  const base = ticker?.baseVolume
  const quoteVol = ticker?.quoteVolume
  // ccxt's `baseVolume` is the venue's own count — CONTRACTS on a contract market (OKX's `vol24h`).
  // `market.base` beside it overstates a day's turnover by `contractSize` on every such venue.
  if (base != null && Number.isFinite(base))
    quote.volume = { text: formatCompactVolume(base), unit: sizeUnit(market).label }
  else if (quoteVol != null && Number.isFinite(quoteVol))
    quote.volume = { text: formatCompactVolume(quoteVol), unit: market.quote }
  return quote
}
