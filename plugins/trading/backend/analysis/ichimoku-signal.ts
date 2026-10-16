/**
 * ICHIMOKU TK-CROSS signal — mined from the Vibe-Trading ichimoku skill. The five-line system's
 * entry event is the Tenkan/Kijun crossover, but a bare cross whipsaws; the school's own gating
 * is what makes it tradable, and the engine we mined applies it verbatim:
 *
 *   strong long  = bullish TK cross + price ABOVE the cloud + bullish cloud (span A > span B)
 *   strong short = bearish TK cross + price BELOW the cloud + bearish cloud (span A < span B)
 *   anything else = stand aside (reported with WHICH filter failed — that is the read).
 *
 * Warm-up is 78 bars (52 for span B + 26 displacement) — below that the module reports nothing
 * rather than a half-warmed guess. The Chikou confirmation (close vs the close 26 bars back) is
 * REPORTED as a detail but does not gate, matching the mined engine. Pure — no I/O.
 */
import type { Candle } from '../contracts'
import { toolNumber } from '../tool-number'

export interface IchimokuSignal {
  /** 'long' / 'short' = a GATED cross (all filters passed); 'stand_aside' = a cross whose
   *  filters failed (the interesting almost-signal — named so the agent can say why). */
  verdict: 'long' | 'short' | 'stand_aside'
  cross: 'bullish' | 'bearish'
  /** How many bars ago the cross printed (0 = the newest bar). */
  barsAgo: number
  tenkan: number
  kijun: number
  /** Price vs the CURRENT cloud (senkou spans computed 26 bars back, displaced to now). */
  priceVsCloud: 'above' | 'inside' | 'below'
  /** Cloud color at the current bar: bullish = span A above span B. */
  cloudBullish: boolean
  /** Chikou confirmation: today's close vs the close 26 bars back (reported, not gating). */
  chikouConfirms: boolean
  /** The filters that failed for a stand-aside — empty for a gated signal. */
  failed: string[]
}

const TENKAN = 9
const KIJUN = 26
const SENKOU_B = 52
const DISPLACEMENT = 26
/** A cross older than this is history, not an entry event. */
const CROSS_RECENCY = 5
/** 52 for span B + 26 displacement — the school's own warm-up. */
export const ICHIMOKU_WARMUP = SENKOU_B + DISPLACEMENT

/** Midpoint of the highest high / lowest low over the `period` bars ENDING at `index`. */
function midpoint(candles: Candle[], index: number, period: number): number {
  let hi = -Infinity
  let lo = Infinity
  for (let i = index - period + 1; i <= index; i++) {
    hi = Math.max(hi, candles[i]!.high)
    lo = Math.min(lo, candles[i]!.low)
  }
  return (hi + lo) / 2
}

/** The gated TK-cross read, or null when no cross printed within the recency window. */
export function ichimokuSignal(candles: Candle[]): IchimokuSignal | null {
  if (candles.length < ICHIMOKU_WARMUP + CROSS_RECENCY) return null
  const last = candles.length - 1

  // Find the newest TK cross within the recency window.
  const tk = (i: number) => midpoint(candles, i, TENKAN) - midpoint(candles, i, KIJUN)
  let crossAt = -1
  let cross: IchimokuSignal['cross'] | null = null
  for (let i = last; i > last - CROSS_RECENCY; i--) {
    const now = tk(i)
    const prev = tk(i - 1)
    if (prev <= 0 && now > 0) {
      crossAt = i
      cross = 'bullish'
      break
    }
    if (prev >= 0 && now < 0) {
      crossAt = i
      cross = 'bearish'
      break
    }
  }
  if (cross === null) return null

  const price = candles[last]!.close
  const tenkan = midpoint(candles, last, TENKAN)
  const kijun = midpoint(candles, last, KIJUN)
  // The cloud AT the current bar was projected from `DISPLACEMENT` bars back.
  const anchor = last - DISPLACEMENT
  const spanA = (midpoint(candles, anchor, TENKAN) + midpoint(candles, anchor, KIJUN)) / 2
  const spanB = midpoint(candles, anchor, SENKOU_B)
  const cloudTop = Math.max(spanA, spanB)
  const cloudBottom = Math.min(spanA, spanB)
  const priceVsCloud: IchimokuSignal['priceVsCloud'] =
    price > cloudTop ? 'above' : price < cloudBottom ? 'below' : 'inside'
  const cloudBullish = spanA > spanB
  const chikouConfirms =
    cross === 'bullish'
      ? price > candles[last - DISPLACEMENT]!.close
      : price < candles[last - DISPLACEMENT]!.close

  const failed: string[] = []
  if (cross === 'bullish') {
    if (priceVsCloud !== 'above') failed.push(`price is ${priceVsCloud} the cloud, not above it`)
    if (!cloudBullish) failed.push('the cloud is bearish (span A below span B)')
  } else {
    if (priceVsCloud !== 'below') failed.push(`price is ${priceVsCloud} the cloud, not below it`)
    if (cloudBullish) failed.push('the cloud is bullish (span A above span B)')
  }

  return {
    verdict: failed.length > 0 ? 'stand_aside' : cross === 'bullish' ? 'long' : 'short',
    cross,
    barsAgo: last - crossAt,
    tenkan,
    kijun,
    priceVsCloud,
    cloudBullish,
    chikouConfirms,
    failed,
  }
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** The signal as report lines — the gate verdict first, every filter named with its state. */
export function renderIchimokuSignal(s: IchimokuSignal): string[] {
  const when = s.barsAgo === 0 ? 'on the newest bar' : `${s.barsAgo} bars ago`
  const head =
    s.verdict === 'stand_aside'
      ? `- ichimoku: ${s.cross} TK cross ${when}, but STAND ASIDE — ${s.failed.join('; ')}`
      : `- ichimoku: gated ${s.verdict.toUpperCase()} — ${s.cross} TK cross ${when} with price ${s.priceVsCloud} a ${s.cloudBullish ? 'bullish' : 'bearish'} cloud`
  return [
    head +
      ` (tenkan ${toolNumber(s.tenkan)} vs kijun ${toolNumber(s.kijun)}; chikou ${s.chikouConfirms ? 'confirms' : 'does NOT confirm'})`,
  ]
}
