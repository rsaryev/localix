/**
 * Round-number (psychological) levels — the whole-number magnets price clusters around and stalls
 * at (65,000 on BTC, 1.00 on a stablecoin pair, 100 on an index). Order flow bunches limit orders
 * and stops at them, so the nearest round level above and below the price is a real reference for
 * targets and stops. Pure; the step is the price's own order of magnitude, so it scales from a
 * $0.02 alt to a $70k coin without a hardcoded table.
 */
import { toolNumber } from '../tool-number'

export interface RoundLevels {
  below: number
  above: number
  /** Percent distance DOWN to `below` / UP to `above` (positive). */
  belowPct: number
  abovePct: number
}

/**
 * The nearest round numbers bracketing `price`, at the increment of its leading digit's place
 * (10^floor(log10 price)) — whole hundreds near 250, whole thousands near 65,000, tenths near
 * 0.42. Null for a non-positive price.
 */
export function roundLevels(price: number): RoundLevels | null {
  if (!(price > 0) || !Number.isFinite(price)) return null
  const step = Math.pow(10, Math.floor(Math.log10(price)))
  let below = Math.floor(price / step) * step
  if (below >= price) below -= step // price sat exactly on a round number
  const above = below + step
  return {
    below,
    above,
    belowPct: ((price - below) / price) * 100,
    abovePct: ((above - price) / price) * 100,
  }
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** The round levels as one report line, or nothing when the price is unusable. */
export function renderRoundLevels(r: RoundLevels): string[] {
  return [
    `- round-number magnets: ${toolNumber(r.below)} (−${toolNumber(r.belowPct)}%), ${toolNumber(r.above)} (+${toolNumber(r.abovePct)}%)`,
  ]
}
