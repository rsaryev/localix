/**
 * A VOLATILITY readout for the detect scan: ATR(14) as an absolute figure AND as a percent of
 * price, whether it is expanding or contracting, and the stop-distance references the analysis
 * prompt asks the agent to size stops off (structure ± an ATR buffer). Uses the chart's own ATR
 * (`ui/model/indicators`), so the number is the one the ATR pane would draw.
 *
 * The "expanding / contracting" read compares the latest ATR to the ATR one lookback-window ago
 * (the standard "is range widening" question); a change under a small threshold is honestly
 * "stable" rather than a coin-flip direction.
 */
import type { Candle } from '../contracts'
import { atr } from '../../ui/model/indicators'
import { toolNumber } from '../tool-number'

export interface VolatilityReadout {
  /** ATR(period) — the average true range in price terms. */
  atr: number
  /** ATR as a percent of the last close — comparable across markets. */
  atrPct: number
  trend: 'expanding' | 'contracting' | 'stable'
  /** Stop-distance references off the last close: 0.5× and 1× ATR (the prompt's noise buffer). */
  halfAtr: number
  oneAtr: number
}

/** Below this relative change the ATR trend is "stable", not a direction. */
const TREND_EPS = 0.05

/** Four significant digits without exponent noise (the house tool-number rule). */
/** The volatility readout, or null when there are too few bars for a full ATR + its lookback. */
export function volatilityReadout(candles: Candle[], period = 14): VolatilityReadout | null {
  const line = atr(candles, period)
  if (line.length === 0) return null
  const current = line.at(-1)!.value
  const lastClose = candles.at(-1)?.close
  if (!lastClose || !Number.isFinite(current) || current <= 0) return null

  // Compare to the ATR `period` points back (one lookback window) when it exists.
  const prior = line.length > period ? line.at(-1 - period)?.value : undefined
  const trend: VolatilityReadout['trend'] =
    prior === undefined || prior <= 0
      ? 'stable'
      : current > prior * (1 + TREND_EPS)
        ? 'expanding'
        : current < prior * (1 - TREND_EPS)
          ? 'contracting'
          : 'stable'

  return {
    atr: current,
    atrPct: (current / lastClose) * 100,
    trend,
    halfAtr: current * 0.5,
    oneAtr: current,
  }
}

/** The readout as a report line — the figure, its percent, the trend, and the stop references. */
export function renderVolatility(v: VolatilityReadout): string[] {
  return [
    `- volatility: ATR(14) ${toolNumber(v.atr)} (${v.atrPct.toFixed(2)}% of price), ${v.trend}; ` +
      `stop-distance reference 0.5×ATR ${toolNumber(v.halfAtr)} / 1×ATR ${toolNumber(v.oneAtr)} beyond the structure level`,
  ]
}
