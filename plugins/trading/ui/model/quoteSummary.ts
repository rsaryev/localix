import type { Candle, Ticker } from '../../backend/contracts'
import { sizeUnit, type SizeUnitMarket } from '../../backend/size-unit'

/**
 * Builds the chart header's quote figures, DEGRADING GRACEFULLY when a venue's ticker is
 * thin. Hyperliquid's `fetchTicker`, for example, returns `last` + `quoteVolume` only —
 * no `bid`/`ask`/`high`/`low`/`change`, and `timestamp: 0`. Rather than render `—`/`NaN`,
 * we derive the high / low / change (and base volume) from the candles the chart already fetched.
 *
 * A DERIVED figure is NOT a 24h figure. The candles cover whatever the chart loaded: 500 one-minute
 * bars span eight hours, not a day. So the summary reports the window it actually measured
 * (`windowSeconds`) and which fields came from candles, and the header labels them by that span —
 * `8h High`, not `24h High`. The agent-facing `market_data` tool holds the same line.
 *
 * A `0` timestamp is treated as "unknown" (never rendered as a date). Pure so the derivation is
 * unit-tested.
 */

const DAY_SECONDS = 24 * 60 * 60

export interface MarketSummary {
  last: number | null
  high: number | null
  low: number | null
  /** Fractional 24h change (0.031 = +3.1%). */
  change: number | null
  /**
   * 24h traded volume, counted in the unit {@link baseVolumeUnitLabel} names. NOT always the base
   * currency despite the name: a venue-reported `Ticker.baseVolume` is the venue's OWN count, while
   * a candle-derived sum is base. See that function for why the two differ.
   */
  baseVolume: number | null
  /** Quote-currency 24h volume (venue-reported when present). */
  quoteVolume: number | null
  /** Unix ms, or null when the venue reported none (a `0`/absent timestamp). */
  timestamp: number | null
  /** Seconds the candle window actually spans — `null` when nothing was derived from it. */
  windowSeconds: number | null
  /** True when the venue reported no high/low and the figures came from the candle window. */
  highLowFromCandles: boolean
  /** True when the venue reported no change and it was measured across the candle window. */
  changeFromCandles: boolean
  /** True when the venue reported no base volume and it was summed over the candle window. */
  baseVolumeFromCandles: boolean
  /**
   * The price the change is measured FROM. A percentage alone hides how much money moved: on a
   * 7,527 index `+0.36%` is 27 points, and a trader sizing a stop reads the points. `null` when the
   * reference price is unknown, in which case there is no absolute change to state either.
   */
  previousPrice: number | null
  /** `last − previousPrice`, in quote currency. */
  changeAbs: number | null
}

/** A span as a human label: `45m`, `8h`, `3d`. Rounds down — never overstates the window. */
export function formatSpan(seconds: number): string {
  if (seconds >= DAY_SECONDS) return `${Math.floor(seconds / DAY_SECONDS)}d`
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`
  return `${Math.max(0, Math.floor(seconds))}s`
}

/**
 * Where the last price sits between the window low and high, as a fraction 0..1 (`0` = at the low,
 * `1` = at the high). A trader reads "near the top of the range" at a glance — resistance vs support —
 * without eyeballing three numbers. `last` may print a fresh extreme just past the window bound, so it
 * is clamped into `[low, high]` (a new high reads as `1`, not `1.02`). `null` when a bound is missing
 * or the range has no width (a flat window has no position to report — never a fabricated `0.5`).
 */
export function rangePosition(
  last: number | null,
  high: number | null,
  low: number | null,
): number | null {
  if (last == null || high == null || low == null) return null
  const span = high - low
  if (span <= 0) return null
  const clamped = Math.min(Math.max(last, low), high)
  return (clamped - low) / span
}

/** The trailing-24h candle window (by the last bar's time), or all candles if shorter. */
function windowFor(candles: Candle[]): Candle[] {
  const last = candles.at(-1)
  if (!last) return []
  const cutoff = last.time - DAY_SECONDS
  const window = candles.filter((c) => c.time >= cutoff)
  return window.length ? window : candles
}

export function summarizeMarket(ticker: Ticker | null, candles: Candle[]): MarketSummary {
  const window = windowFor(candles)
  const lastBar = window.at(-1)
  const firstBar = window[0]

  const last = ticker?.last ?? lastBar?.close ?? null

  const derivedHigh = window.length ? Math.max(...window.map((c) => c.high)) : null
  const derivedLow = window.length ? Math.min(...window.map((c) => c.low)) : null
  const high = ticker?.high ?? derivedHigh
  const low = ticker?.low ?? derivedLow

  let change = ticker?.change ?? null
  if (change == null && firstBar && last != null && firstBar.open > 0) {
    change = (last - firstBar.open) / firstBar.open
  }

  // Sum only the bars the venue actually reported a volume for. Treating an unreported volume as 0
  // turns a window of silent bars into a stated `vol 0` — a claim that nothing traded all day.
  const volumeBars = window.filter((c) => c.volume !== undefined)
  const derivedBaseVolume = volumeBars.length
    ? volumeBars.reduce((sum, c) => sum + (c.volume as number), 0)
    : null
  const baseVolume = ticker?.baseVolume ?? derivedBaseVolume
  const quoteVolume = ticker?.quoteVolume ?? null

  // A `0`/absent timestamp is "unknown" — never a 1970 date.
  // A `0`/absent stamp is "unknown". Hyperliquid literally reports `0`; a venue reporting nothing
  // now leaves it undefined. Both mean the same: no moment to render.
  const timestamp =
    ticker?.timestamp !== undefined && ticker.timestamp > 0 ? ticker.timestamp : null

  // Where the change is measured from. The venue's own `previousClose` is the truth when it reports
  // one; otherwise the window's opening bar; otherwise back it out of the venue's percentage —
  // arithmetic on two figures the venue gave us, not a number we invented.
  const previousPrice =
    // The venue's own reference price, when it reports one.
    ticker?.previousClose ??
    // Else back it out of the venue's OWN percentage, so the two agree. Using the candle window here
    // would state an absolute change measured over a different span than the percentage beside it.
    (ticker?.change != null && last != null && ticker.change !== -1
      ? last / (1 + ticker.change)
      : null) ??
    // Else the change was measured across the candle window, so its opening bar is the reference.
    (ticker?.change == null && firstBar ? firstBar.open : null)
  const changeAbs = previousPrice != null && last != null ? last - previousPrice : null

  const highLowFromCandles = ticker?.high == null && derivedHigh != null
  const changeFromCandles = ticker?.change == null && change != null
  const baseVolumeFromCandles = ticker?.baseVolume == null && derivedBaseVolume != null
  const anyDerived = highLowFromCandles || changeFromCandles || baseVolumeFromCandles
  // The span the window MEASURES, so the header can name it. One bar measures nothing.
  const windowSeconds =
    anyDerived && firstBar && lastBar && lastBar.time > firstBar.time
      ? lastBar.time - firstBar.time
      : null

  return {
    last,
    high,
    low,
    change,
    baseVolume,
    quoteVolume,
    timestamp,
    windowSeconds,
    highLowFromCandles,
    changeFromCandles,
    baseVolumeFromCandles,
    previousPrice,
    changeAbs,
  }
}

/**
 * The unit the summary's traded-volume figure is counted in — the header must name it, because the
 * figure has TWO possible sources with TWO different units, and nothing about the number says which:
 *
 *  - **From the ticker.** ccxt does NOT normalize `Ticker.baseVolume` despite the name. It is the
 *    venue's own count: OKX's `parseTicker` hands back `vol24h`, which on a swap is CONTRACTS
 *    (`volCcy24h` is the coin figure, and it only surfaces it for spot). So the unit is whatever
 *    `sizeUnit(market)` says — `cont` on a `ctVal: 0.01` market.
 *  - **From the candles.** ccxt DOES normalize OHLCV volume to the base currency: OKX's
 *    `parseOHLCV` deliberately picks the base-volume index for non-spot, and binance/bybit pick
 *    their base index on inverse contracts. So a sum over the candle window counts the ASSET.
 *
 * Merging them under one field name is fine as long as the reader is told which one it is looking
 * at; printing the number bare is not. An unknown market names no unit rather than the wrong one.
 */
export function baseVolumeUnitLabel(
  summary: MarketSummary,
  market: SizeUnitMarket | null | undefined,
): string {
  if (summary.baseVolume == null) return ''
  if (summary.baseVolumeFromCandles) return market?.base ?? ''
  return sizeUnit(market).label
}
