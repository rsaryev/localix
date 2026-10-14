import type { UTCTimestamp } from 'lightweight-charts'
/**
 * The arithmetic every family shares.
 *
 * Three helpers, and the reason they are not each family's own copy: `emaValues` in particular is
 * the seed convention (SMA of the first `period`, then the recursive step), and two indicators
 * that seeded differently would disagree with each other on the same chart for reasons no reader
 * would find.
 */

export const t = (time: number) => time as UTCTimestamp

/** EMA over an arbitrary value series, seeded with the SMA of the first `period`. Empty when short. */
export function emaValues(values: number[], period: number): number[] {
  if (period < 1 || values.length < period) return []
  const k = 2 / (period + 1)
  let v = 0
  for (let i = 0; i < period; i++) v += values[i]!
  v /= period
  const out = [v]
  for (let i = period; i < values.length; i++) {
    v = values[i]! * k + v * (1 - k)
    out.push(v)
  }
  return out
}

/** Weighted moving average over an arbitrary value series (weights 1..period, newest heaviest). */
export function wmaValues(values: number[], period: number): number[] {
  if (period < 1 || values.length < period) return []
  const denom = (period * (period + 1)) / 2
  const out: number[] = []
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) sum += values[i - period + 1 + j]! * (j + 1)
    out.push(sum / denom)
  }
  return out
}
