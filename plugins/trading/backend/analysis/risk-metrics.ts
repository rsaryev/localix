/**
 * Downside risk over the recent window — historical VaR / CVaR on the per-bar returns plus the
 * window's max drawdown. The render line carries the estimate's core caveat: a historical VaR is a
 * quantile of what ALREADY happened, not a ceiling on what can happen — a fat-tailed market breaks
 * it.
 *
 * All figures are per-BAR of the scanned timeframe and expressed as positive percents (a loss is a
 * positive number here), so "1h VaR 2.1%" reads directly. Pure: injected candles, no I/O.
 */
import type { Candle } from '../contracts'

export interface RiskMetrics {
  /** Per-bar 95% historical VaR: a loss this bar exceeds it ~1 time in 20 (positive %). */
  var95: number
  /** Expected shortfall — the mean of the worst 5% of bars (positive %); always ≥ var95. */
  cvar95: number
  /** Largest peak-to-trough decline of the close over the window (positive %). */
  maxDrawdown: number
  /** How many return samples the estimate rests on. */
  samples: number
}

/** Below this many returns a VaR quantile is noise, not an estimate. */
const MIN_SAMPLES = 20

/** Per-bar simple returns from the closes (skips a bar with a non-positive prior close). */
function returns(candles: Candle[]): number[] {
  const out: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!.close
    if (prev > 0) out.push(candles[i]!.close / prev - 1)
  }
  return out
}

/** Largest peak-to-trough decline of the close over the window, as a positive fraction. */
function maxDrawdown(candles: Candle[]): number {
  let peak = -Infinity
  let worst = 0
  for (const c of candles) {
    if (c.close > peak) peak = c.close
    if (peak > 0) worst = Math.max(worst, (peak - c.close) / peak)
  }
  return worst
}

/**
 * Historical VaR/CVaR at 95% + max drawdown, or null when there are too few returns to estimate a
 * tail. VaR is the 5th-percentile return (nearest-rank on the sorted losses); CVaR the mean of
 * everything at or beyond it.
 */
export function riskMetrics(candles: Candle[]): RiskMetrics | null {
  const r = returns(candles)
  if (r.length < MIN_SAMPLES) return null
  const sorted = [...r].sort((a, b) => a - b) // most-negative first
  // Nearest-rank 5th percentile: the worst ceil(5%) sample defines the threshold.
  const tailCount = Math.max(1, Math.floor(r.length * 0.05))
  const varReturn = sorted[tailCount - 1]! // the least-bad of the worst 5%
  let tailSum = 0
  for (let i = 0; i < tailCount; i++) tailSum += sorted[i]!
  const cvarReturn = tailSum / tailCount
  return {
    // A positive return at the 5th percentile would mean "even a bad bar is green" — clamp the
    // reported LOSS at 0 rather than print a negative loss.
    var95: Math.max(0, -varReturn) * 100,
    cvar95: Math.max(0, -cvarReturn) * 100,
    maxDrawdown: maxDrawdown(candles) * 100,
    samples: r.length,
  }
}

/** Four significant digits without exponent noise, for small percents. */
function pct(value: number): string {
  return String(Number(value.toPrecision(3)))
}

/** The risk metrics as a report line — figures with the caveat that a historical VaR is not a cap. */
export function renderRiskMetrics(m: RiskMetrics, timeframe: string): string[] {
  return [
    `- downside risk (per ${timeframe} bar, ${m.samples} samples): 95% VaR ${pct(m.var95)}% ` +
      `(a worse bar ~1 in 20), CVaR ${pct(m.cvar95)}% (mean of the worst 5%); ` +
      `max drawdown ${pct(m.maxDrawdown)}% over the window. Historical estimate — not a loss ceiling; ` +
      `a fat tail exceeds it.`,
  ]
}
