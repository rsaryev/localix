/**
 * Higher-timeframe CONTEXT for the detect scan: the regime + trend one step up the ladder, so the
 * agent can weigh whether the scanned timeframe agrees with the structure above it (trading with
 * the higher-timeframe trend is the single most repeated edge in the literature). The read reuses
 * the same regime/trend functions the primary scan uses; only the candle fetch is new.
 */
import type { Candle } from '../contracts'
import { classifyRegime, trendFit } from './pattern-detect'

/**
 * The "one meaningful step up" for a timeframe token — roughly 4× so the higher read is a genuinely
 * different structure, snapped to a conventional token. Null for the top of the ladder (or an
 * unrecognised token): there is nothing higher to fetch.
 */
const HIGHER: Record<string, string> = {
  '1m': '15m',
  '3m': '30m',
  '5m': '1h',
  '15m': '1h',
  '30m': '4h',
  '1h': '4h',
  '2h': '1d',
  '4h': '1d',
  '6h': '1d',
  '8h': '1d',
  '12h': '1w',
  '1d': '1w',
  '3d': '1w',
}

export function higherTimeframe(timeframe: string): string | null {
  return HIGHER[timeframe.toLowerCase()] ?? null
}

export interface TimeframeContext {
  timeframe: string
  regime: string | null
  trend: 'up' | 'down' | 'flat' | null
}

/** Compact regime + trend read for a fetched higher-timeframe candle set. */
export function timeframeContext(candles: Candle[], timeframe: string): TimeframeContext {
  const fit = trendFit(candles)
  return {
    timeframe,
    regime: classifyRegime(candles, fit)?.kind ?? null,
    trend: fit?.direction ?? null,
  }
}

/**
 * The higher-timeframe line, including whether it ALIGNS with the primary trend — the actionable
 * part (a long in a market trending up on the timeframe above is with the tide; against it, into
 * it). `primaryTrend` is the scanned timeframe's own trend direction.
 */
export function renderTimeframeContext(
  ctx: TimeframeContext,
  primaryTrend: 'up' | 'down' | 'flat' | null,
): string[] {
  if (ctx.regime === null && ctx.trend === null) return []
  const regime = ctx.regime ?? 'unclear'
  const trend = ctx.trend ?? 'unclear'
  let alignment = ''
  if (ctx.trend && primaryTrend && ctx.trend !== 'flat' && primaryTrend !== 'flat') {
    alignment =
      ctx.trend === primaryTrend
        ? ' — ALIGNED with the scanned timeframe (with the higher-timeframe tide)'
        : ' — AGAINST the scanned timeframe (counter to the higher-timeframe tide; size down or wait)'
  }
  return [`- higher timeframe (${ctx.timeframe}): ${regime}, trend ${trend}${alignment}`]
}
