/**
 * Historical-volatility PERCENTILE for the detect scan: where the current realized volatility sits
 * inside the scanned window's own HV distribution. The rank is the actionable part — a compressed
 * reading (bottom quintile) marks the squeeze conditions that precede expansion, an elevated one
 * (top quintile) marks stretch where volatility tends to mean-revert — and, being a rank, it needs
 * no annualization and is comparable across markets and timeframes.
 *
 * The annualized figure is display garnish beside the rank: close-to-close log-return stdev scaled
 * by √(bars per year) on a 365-day year — crypto trades every day, so the equity convention of 252
 * would overstate per-bar vol by √(365/252). Null (and omitted from the line) when the timeframe
 * token is not one we can convert to a bar duration. Pure over injected candles, with no I/O.
 */
import type { Candle } from '../contracts'
import { timeframeMs } from '../timeframes'

export interface HvReadout {
  /** Annualized HV of the latest window, percent (365-day year). Null for an unknown timeframe. */
  annualizedPct: number | null
  /** Percentile rank (0–100) of the latest HV among the window's rolling-HV history. */
  percentile: number
  state: 'compressed' | 'normal' | 'elevated'
  /** How many rolling-HV points the rank is taken over. */
  samples: number
}

/** Bars of log returns per HV point — the conventional short realized-vol window. */
const HV_WINDOW = 20
/** Below this many rolling-HV points a percentile is noise, not a rank. */
const MIN_SAMPLES = 30
/** Bottom / top quintile — the conventional squeeze / stretch cutoffs. */
const COMPRESSED_PCT = 20
const ELEVATED_PCT = 80

const YEAR_MS = 365 * 86_400_000

/** Rolling per-window stdev of the log returns; one point per full window, oldest first. */
function rollingHv(candles: Candle[], window: number): number[] {
  const returns: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!.close
    const curr = candles[i]!.close
    if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev))
  }
  const out: number[] = []
  for (let end = window; end <= returns.length; end++) {
    const slice = returns.slice(end - window, end)
    const mean = slice.reduce((a, b) => a + b, 0) / window
    const variance = slice.reduce((a, r) => a + (r - mean) ** 2, 0) / (window - 1)
    out.push(Math.sqrt(variance))
  }
  return out
}

/** The HV-percentile readout, or null when the window cannot support a meaningful rank. */
export function hvPercentile(candles: Candle[], timeframe: string): HvReadout | null {
  const hv = rollingHv(candles, HV_WINDOW)
  if (hv.length < MIN_SAMPLES) return null
  const current = hv.at(-1)!
  if (!Number.isFinite(current)) return null

  // Strictly-below rank with a half-credit for ties — the standard midrank percentile.
  let below = 0
  let ties = 0
  for (const v of hv) {
    if (v < current) below++
    else if (v === current) ties++
  }
  const percentile = ((below + ties / 2) / hv.length) * 100

  const barMs = timeframeMs(timeframe)
  const annualizedPct = barMs ? current * Math.sqrt(YEAR_MS / barMs) * 100 : null

  return {
    annualizedPct,
    percentile,
    state:
      percentile <= COMPRESSED_PCT
        ? 'compressed'
        : percentile >= ELEVATED_PCT
          ? 'elevated'
          : 'normal',
    samples: hv.length,
  }
}

/** The readout as a report line — rank first (the signal), the annualized figure as context. */
export function renderHvPercentile(hv: HvReadout): string[] {
  const annualized =
    hv.annualizedPct !== null ? ` (≈${hv.annualizedPct.toFixed(1)}% annualized, 365d)` : ''
  const note =
    hv.state === 'compressed'
      ? ' — squeeze conditions; compression tends to precede expansion, direction unknown'
      : hv.state === 'elevated'
        ? ' — stretched; high-vol readings tend to mean-revert, wider stops warranted meanwhile'
        : ''
  return [
    `- historical volatility: HV(${HV_WINDOW}) at the ${Math.round(hv.percentile)}th percentile of ` +
      `the scanned window${annualized}, ${hv.state}${note}`,
  ]
}
