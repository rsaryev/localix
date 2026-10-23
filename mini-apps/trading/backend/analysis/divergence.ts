/**
 * REGULAR RSI divergence — the classic reversal tell: price makes a lower low while momentum
 * makes a higher low (bullish), or price a higher high while momentum makes a lower high
 * (bearish). Read on the SAME swing pivots the level clustering uses (`pivots` from
 * pattern-detect) and the SAME RSI the chart draws (`ui/model/indicators`), so a divergence the
 * tool reports is one a human could point at on their own chart.
 *
 * Deliberately conservative: only the two most-recent qualifying pivots per side are compared
 * (a divergence is a statement about the LAST swing, not the whole window), the RSI extreme must
 * clear a small margin to count (a 0.1-point wiggle is noise, not a higher low), and a pivot with
 * no RSI value yet — inside the indicator's warm-up — is skipped, never guessed.
 */
import type { Candle } from '../contracts'
import { rsi } from '../../ui/model/indicators'
import { pivots } from './pattern-detect'
import { toolNumber } from '../tool-number'

export interface Divergence {
  kind: 'bullish' | 'bearish'
  /**
   * `regular` = a REVERSAL tell (momentum fading the current move); `hidden` = a CONTINUATION
   * tell (momentum backing a trend pullback). The two are geometric opposites on the same pivots.
   */
  signalClass: 'regular' | 'hidden'
  /** The two price pivots (older → newer) the divergence spans. */
  priceFrom: number
  priceTo: number
  /** The RSI at those same two pivots (older → newer). */
  oscFrom: number
  oscTo: number
  /** Unix seconds of the newer pivot — where the signal sits. */
  time: number
  /** The claim in words, with its numbers. */
  note: string
}

/** A pivot's RSI must differ by at least this to count as a genuine higher/lower extreme. */
const RSI_MARGIN = 1

/** Four significant digits without exponent noise (the house tool-number rule). */
/**
 * RSI divergence — REGULAR (reversal) and HIDDEN (continuation) — over the recent swings, or an
 * empty array. The four cases are geometric opposites read on the last two pivots per side:
 *   lows  → regular bullish (price LL, RSI HL) or hidden bullish (price HL, RSI LL)
 *   highs → regular bearish (price HH, RSI LH) or hidden bearish (price LH, RSI HH)
 * Bullish and bearish are independent — a window can show one, both, or neither. `span` is the
 * pivot lookaround (±bars); `period` the RSI length.
 */
export function detectRsiDivergence(candles: Candle[], span = 3, period = 14): Divergence[] {
  if (candles.length < period + span * 2 + 2) return []
  const rsiByTime = new Map<number, number>()
  for (const point of rsi(candles, period)) rsiByTime.set(point.time as number, point.value)

  const { highs, lows } = pivots(candles, span)
  // Only pivots whose bar already has an RSI value (past the warm-up) can be compared.
  const lowsWithRsi = lows.filter((p) => rsiByTime.has(p.time))
  const highsWithRsi = highs.filter((p) => rsiByTime.has(p.time))

  const out: Divergence[] = []

  const build = (
    side: 'low' | 'high',
    older: { price: number; time: number },
    newer: { price: number; time: number },
  ): Divergence | null => {
    const rsiOlder = rsiByTime.get(older.time)!
    const rsiNewer = rsiByTime.get(newer.time)!
    const priceUp = newer.price > older.price
    const priceDown = newer.price < older.price
    const rsiUp = rsiNewer > rsiOlder + RSI_MARGIN
    const rsiDown = rsiNewer < rsiOlder - RSI_MARGIN
    const base = {
      priceFrom: older.price,
      priceTo: newer.price,
      oscFrom: rsiOlder,
      oscTo: rsiNewer,
      time: newer.time,
    }
    const p = (label: string, rsiLabel: string, tail: string) =>
      `price ${label} ${toolNumber(older.price)}→${toolNumber(newer.price)} but RSI ${rsiLabel} ${toolNumber(rsiOlder)}→${toolNumber(rsiNewer)} — ${tail}`
    if (side === 'low') {
      // Regular bullish: price lower low, RSI higher low → reversal up.
      if (priceDown && rsiUp)
        return {
          kind: 'bullish',
          signalClass: 'regular',
          ...base,
          note: p('lower low', 'higher low', 'bullish reversal (momentum fading the decline)'),
        }
      // Hidden bullish: price higher low, RSI lower low → uptrend continuation.
      if (priceUp && rsiDown)
        return {
          kind: 'bullish',
          signalClass: 'hidden',
          ...base,
          note: p('higher low', 'lower low', 'bullish continuation / hidden (uptrend pullback)'),
        }
      return null
    }
    // Regular bearish: price higher high, RSI lower high → reversal down.
    if (priceUp && rsiDown)
      return {
        kind: 'bearish',
        signalClass: 'regular',
        ...base,
        note: p('higher high', 'lower high', 'bearish reversal (momentum fading the advance)'),
      }
    // Hidden bearish: price lower high, RSI higher high → downtrend continuation.
    if (priceDown && rsiUp)
      return {
        kind: 'bearish',
        signalClass: 'hidden',
        ...base,
        note: p('lower high', 'higher high', 'bearish continuation / hidden (downtrend pullback)'),
      }
    return null
  }

  if (lowsWithRsi.length >= 2) {
    const found = build('low', lowsWithRsi.at(-2)!, lowsWithRsi.at(-1)!)
    if (found) out.push(found)
  }
  if (highsWithRsi.length >= 2) {
    const found = build('high', highsWithRsi.at(-2)!, highsWithRsi.at(-1)!)
    if (found) out.push(found)
  }

  return out
}

/** Divergence findings as report lines, or nothing when there are none. */
export function renderDivergence(divergences: Divergence[]): string[] {
  if (divergences.length === 0) return []
  return [
    '- RSI divergence (regular = reversal tell, hidden = trend continuation; a tell, not a trigger — needs confirmation):',
    ...divergences.map((d) => `    · ${d.kind} ${d.signalClass} — ${d.note}`),
  ]
}
