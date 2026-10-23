import type { LineData, UTCTimestamp } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'

/**
 * Incremental indicator computation for the live tail.
 *
 * A streaming tick replaces only the newest bar, and a rollover finalises it and appends one more.
 * Recomputing an SMA/EMA/RSI over every held bar for that is wasted work: the state carried up to
 * the settled prefix (every bar but the newest) is already known. A {@link Stepper} folds one bar
 * into an immutable state — performing EXACTLY the floating-point operations of the full
 * computation, in the same order — so the incremental result is bit-identical to a full recompute.
 *
 * The cache is keyed by bar identity: the previous call's settled bars must be the very same
 * objects at the same indices (the candle reducer reuses untouched bars). Anything else — a
 * prepend, a deep correction, a different market — falls back to a full pass.
 */
export interface Stepper<S> {
  readonly init: S
  /** Fold bar `i` of `candles` into `state`; the new state and the point value at `i`, if any. */
  step(state: S, candles: readonly Candle[], i: number): readonly [S, number | null]
}

interface TailCache<S> {
  bars: readonly Candle[]
  /** Bars folded into `state`: `bars.length - 1`, the settled prefix. */
  settled: number
  state: S
  points: LineData[]
}

const time = (bar: Candle) => bar.time as UTCTimestamp

function samePrefix(prev: readonly Candle[], next: readonly Candle[], count: number): boolean {
  for (let i = 0; i < count; i++) if (prev[i] !== next[i]) return false
  return true
}

/** A memoized `(candles) => LineData[]` that recomputes only the tail when the prefix is unchanged. */
export function incrementalLine<S>(stepper: Stepper<S>): (candles: Candle[]) => LineData[] {
  let cache: TailCache<S> | null = null
  return (candles) => {
    const n = candles.length
    let state: S
    let points: LineData[]
    let settled: number
    if (
      cache &&
      (n === cache.settled + 1 || n === cache.settled + 2) &&
      samePrefix(cache.bars, candles, cache.settled)
    ) {
      state = cache.state
      points = cache.points
      settled = cache.settled
    } else {
      state = stepper.init
      points = []
      settled = 0
    }
    // Fold every bar except the newest into the carried state (one bar on a rollover, all on a reset).
    if (settled < n - 1) points = points.slice()
    while (settled < n - 1) {
      const [nextState, value] = stepper.step(state, candles, settled)
      if (value !== null) points.push({ time: time(candles[settled]!), value })
      state = nextState
      settled++
    }
    cache = n === 0 ? null : { bars: candles, settled, state, points }
    if (n === 0) return []
    const [, last] = stepper.step(state, candles, n - 1)
    return last === null
      ? points.slice()
      : [...points, { time: time(candles[n - 1]!), value: last }]
  }
}

/** Simple moving average — the running-sum order of `movingAverage`. */
export function smaStepper(period: number): Stepper<number> {
  return {
    init: 0,
    step(sum, candles, i) {
      if (period < 1) return [sum, null]
      let next = sum + candles[i]!.close
      if (i >= period) next -= candles[i - period]!.close
      return [next, i >= period - 1 ? next / period : null]
    },
  }
}

/** Exponential moving average seeded by the SMA of the first `period` closes — as `ema`. */
export function emaStepper(period: number): Stepper<number> {
  const k = 2 / (period + 1)
  return {
    init: 0,
    step(value, candles, i) {
      if (period < 1) return [value, null]
      const close = candles[i]!.close
      if (i < period - 1) return [value + close, null]
      if (i === period - 1) {
        const seeded = (value + close) / period
        return [seeded, seeded]
      }
      const next = close * k + value * (1 - k)
      return [next, next]
    },
  }
}

interface RsiState {
  gain: number
  loss: number
}

/** Wilder's RSI — the same seed-then-smooth sequence as `rsi`. */
export function rsiStepper(period: number): Stepper<RsiState> {
  const read = (s: RsiState) => (s.loss === 0 ? 100 : 100 - 100 / (1 + s.gain / s.loss))
  return {
    init: { gain: 0, loss: 0 },
    step(s, candles, i) {
      if (period < 1 || i === 0) return [s, null]
      const d = candles[i]!.close - candles[i - 1]!.close
      if (i < period)
        return [d >= 0 ? { ...s, gain: s.gain + d } : { ...s, loss: s.loss - d }, null]
      if (i === period) {
        const summed = d >= 0 ? { ...s, gain: s.gain + d } : { ...s, loss: s.loss - d }
        const seeded = { gain: summed.gain / period, loss: summed.loss / period }
        return [seeded, read(seeded)]
      }
      const next = {
        gain: (s.gain * (period - 1) + Math.max(d, 0)) / period,
        loss: (s.loss * (period - 1) + Math.max(-d, 0)) / period,
      }
      return [next, read(next)]
    },
  }
}
