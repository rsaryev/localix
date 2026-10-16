/**
 * A COMPOSITE signal: three orthogonal reads of the same tape — Trend, Momentum, Volume — each
 * voting bull / bear / neutral with the NUMBER behind its vote, then an aggregate lean whose
 * conviction is how strongly the available dimensions agree. A momentum read confirming a trend
 * read carries more distinct evidence than two trend tools agreeing, so the dimensions are
 * deliberately independent (trend = EMA slope gated by ADX, momentum = MACD histogram + RSI,
 * volume = OBV vs its own average).
 *
 * ONE math, reused: the indicators are the chart's own (`ui/model/indicators.ts`, runtime-pure),
 * so the vote is cast on the exact numbers the human reads off the legend. Honesty rule inherited
 * from every indicator here: a dimension whose lookback window is not yet full does NOT vote — it
 * reports `n/a` and is excluded from the tally, never counted as a neutral.
 */
import type { Candle } from '../contracts'
import { adx, ema, macd, obv, rsi } from '../../ui/model/indicators'
import { toolNumber } from '../tool-number'

export type Vote = 'bull' | 'bear' | 'neutral' | 'n/a'

export interface SignalDimension {
  name: 'trend' | 'momentum' | 'volume'
  vote: Vote
  /** The figures the vote rests on — so the reader (and the agent) can cite them. */
  note: string
}

export interface CompositeSignal {
  bias: 'long' | 'short' | 'neutral'
  /** 0..1 — the net vote over the dimensions that COULD vote (agreement, not certainty). */
  conviction: number
  dimensions: SignalDimension[]
}

/** ADX below this is no trend; the EMA slope's direction is noted but does not vote. */
const ADX_TREND_MIN = 20

/** Four significant digits without exponent noise (the house tool-number rule). */
const lastValue = (line: { value: number }[]): number | null => {
  const last = line.at(-1)
  return last && Number.isFinite(last.value) ? last.value : null
}

/** Trend: EMA(12) vs EMA(26), but it only VOTES when ADX(14) confirms a real trend. */
function trendDimension(candles: Candle[]): SignalDimension {
  const fast = lastValue(ema(candles, 12))
  const slow = lastValue(ema(candles, 26))
  const strength = lastValue(adx(candles, 14).adx)
  if (fast === null || slow === null || strength === null) {
    return { name: 'trend', vote: 'n/a', note: 'insufficient bars for EMA/ADX' }
  }
  const direction = fast > slow ? 'bull' : fast < slow ? 'bear' : 'neutral'
  const gated = strength < ADX_TREND_MIN ? 'neutral' : direction
  const note = `EMA12 ${toolNumber(fast)} vs EMA26 ${toolNumber(slow)}, ADX ${toolNumber(strength)}${
    strength < ADX_TREND_MIN ? ' (weak — no trend vote)' : ''
  }`
  return { name: 'trend', vote: gated, note }
}

/** Momentum: MACD histogram sign, confirmed by RSI's side of 50 (divergence → neutral). */
function momentumDimension(candles: Candle[]): SignalDimension {
  const hist = lastValue(macd(candles, 12, 26, 9).histogram)
  const strength = lastValue(rsi(candles, 14))
  if (hist === null || strength === null) {
    return { name: 'momentum', vote: 'n/a', note: 'insufficient bars for MACD/RSI' }
  }
  const vote: Vote =
    hist > 0 && strength >= 50 ? 'bull' : hist < 0 && strength < 50 ? 'bear' : 'neutral'
  return {
    name: 'momentum',
    vote,
    note: `MACD hist ${toolNumber(hist)}, RSI ${toolNumber(strength)}${vote === 'neutral' ? ' (mixed)' : ''}`,
  }
}

/** Volume: OBV against its own SMA(20) — is participation confirming price or fading. */
function volumeDimension(candles: Candle[]): SignalDimension {
  const line = obv(candles)
  const period = 20
  if (line.length < period) {
    return { name: 'volume', vote: 'n/a', note: 'insufficient bars for OBV average' }
  }
  const nowValue = line.at(-1)!.value
  let sum = 0
  for (let i = line.length - period; i < line.length; i++) sum += line[i]!.value
  const avg = sum / period
  const vote: Vote = nowValue > avg ? 'bull' : nowValue < avg ? 'bear' : 'neutral'
  return {
    name: 'volume',
    vote,
    note: `OBV ${toolNumber(nowValue)} vs its SMA20 ${toolNumber(avg)}`,
  }
}

/**
 * The composite of the three dimensions. Bias is the sign of the vote sum; conviction is the net
 * vote over the dimensions that could vote (all three agreeing = 1.0, a 2-1 split = 0.33, a wash
 * or all-neutral = 0). Returns null only when NOT ONE dimension had enough bars to vote.
 */
export function compositeSignal(candles: Candle[]): CompositeSignal | null {
  const dimensions = [trendDimension(candles), momentumDimension(candles), volumeDimension(candles)]
  const voting = dimensions.filter((d) => d.vote !== 'n/a')
  if (voting.length === 0) return null
  const score = voting.reduce((s, d) => s + (d.vote === 'bull' ? 1 : d.vote === 'bear' ? -1 : 0), 0)
  const bias = score > 0 ? 'long' : score < 0 ? 'short' : 'neutral'
  return { bias, conviction: Math.abs(score) / voting.length, dimensions }
}

/**
 * Conviction-scaled exposure: the fraction of the caller's NORMAL per-trade risk budget this
 * signal supports — 1.0 at full agreement, ~0.33 at a 2-1 split, 0 for a neutral or washed
 * signal. The fractional-sizing idea (scale position with signal strength rather than trading
 * full size on every call) is the practical form of fractional Kelly, and a continuous size is
 * cleaner than a binary in/out for the trade-plan output. This is a fraction OF the risk cap,
 * never a licence to exceed it.
 */
export function suggestedExposure(signal: CompositeSignal): number {
  return signal.bias === 'neutral' ? 0 : signal.conviction
}

/** The signal as report lines — the aggregate lean, then each dimension's vote with its numbers. */
export function renderCompositeSignal(signal: CompositeSignal): string[] {
  const pct = Math.round(signal.conviction * 100)
  const lines = [
    `- composite signal: ${signal.bias.toUpperCase()} (conviction ${pct}% — agreement of the voting dimensions, NOT a probability):`,
  ]
  for (const d of signal.dimensions) {
    lines.push(`    · ${d.name}: ${d.vote} — ${d.note}`)
  }
  const exposure = Math.round(suggestedExposure(signal) * 100)
  lines.push(
    `    · suggested exposure: ~${exposure}% of the per-trade risk budget (conviction-scaled — a continuous size, not an in/out call; 0% means stand aside)`,
    '    (three independent reads; a momentum vote confirming trend is stronger evidence than two trend tools agreeing)',
  )
  return lines
}
