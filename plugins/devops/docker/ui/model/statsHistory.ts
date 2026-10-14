import type { ContainerStats } from '../../backend/contracts'

/**
 * Pure, bounded history of `docker stats` samples, and the geometry for drawing it.
 *
 * A stats panel that shows one instantaneous number cannot reveal whether a container is
 * spiking, climbing, or steady. Retaining a bounded series exposes that trend, and keeping
 * the history pure makes its pruning and scaling rules testable.
 *
 * The series is pruned by BOTH age and count because the poll cadence can change; a future
 * 500ms tick must not silently turn a 5-minute window into 600 retained samples.
 */

export interface StatSample {
  /** Epoch millis the sample was recorded at (the client's clock, not Docker's). */
  at: number
  cpuPct: number
  memPct: number
  /** Cumulative counters, or `null` where Docker reported none. Only their DIFFERENCE
   *  between two samples means anything. */
  netRxBytes: number | null
  netTxBytes: number | null
  blockReadBytes: number | null
  blockWriteBytes: number | null
}

/** How much history to retain. Five minutes at a 3s poll is 100 samples — enough to see
 *  a deploy settle without holding a session's worth of numbers per open tab. */
export const STATS_HISTORY_MS = 300_000
/** Hard sample cap, so the retained size never depends on the poll cadence. */
export const STATS_HISTORY_MAX = 200

/**
 * Append one sample, dropping anything older than the window or beyond the cap.
 *
 * `now` is passed separately from the sample's own timestamp so the age cutoff can be
 * evaluated against the real clock even when a caller back-dates a sample.
 */
export function appendStatSample(
  history: readonly StatSample[],
  sample: StatSample,
  now: number = sample.at,
): StatSample[] {
  const cutoff = now - STATS_HISTORY_MS
  const kept = history.filter((entry) => entry.at > cutoff)
  const next = [...kept, sample]
  return next.length > STATS_HISTORY_MAX ? next.slice(next.length - STATS_HISTORY_MAX) : next
}

/** Read one poll result into a sample, or `null` when there is nothing to record. */
export function statSampleOf(stats: ContainerStats | null, at: number): StatSample | null {
  if (!stats) return null
  if (!Number.isFinite(stats.cpuPct) || !Number.isFinite(stats.memPct)) return null
  return {
    at,
    cpuPct: stats.cpuPct,
    memPct: stats.memPct,
    netRxBytes: stats.netRxBytes,
    netTxBytes: stats.netTxBytes,
    blockReadBytes: stats.blockReadBytes,
    blockWriteBytes: stats.blockWriteBytes,
  }
}

/** Which cumulative counter to derive a rate from. */
export type CounterKey = 'netRxBytes' | 'netTxBytes' | 'blockReadBytes' | 'blockWriteBytes'

/**
 * Throughput between the two most recent samples, in bytes per second.
 *
 * `null` when it cannot be known: fewer than two samples, a counter Docker never reported,
 * or two samples with no time between them. Docker reports cumulative I/O counters, which
 * show lifetime totals and only rise; the difference between adjacent samples is required
 * to answer whether the container is busy now.
 *
 * A NEGATIVE delta is treated as unknown, not clamped to zero: the counter resetting means
 * the container restarted, and averaging across that boundary would invent a number.
 */
export function counterRate(history: readonly StatSample[], key: CounterKey): number | null {
  if (history.length < 2) return null
  const latest = history[history.length - 1]!
  const previous = history[history.length - 2]!
  const current = latest[key]
  const before = previous[key]
  if (current === null || before === null) return null
  const seconds = (latest.at - previous.at) / 1000
  if (seconds <= 0) return null
  const delta = current - before
  if (delta < 0) return null
  return delta / seconds
}

export interface SeriesSummary {
  min: number
  max: number
  avg: number
  last: number
}

/** Min/max/mean/last for one series — the numbers that turn a sparkline into a reading. */
export function summarizeSeries(values: readonly number[]): SeriesSummary | null {
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: total / values.length,
    last: values[values.length - 1]!,
  }
}

/**
 * The upper bound to draw a percentage series against.
 *
 * NOT a fixed 100: a container idling at 0.3% would be a flat line pinned to the floor,
 * which is exactly the shape of "no data" and hides the 10x spike inside it. Auto-scaled
 * to the observed peak with a 1% floor (so noise near zero is not amplified into a
 * mountain range) and rounded up so the axis label is a round number.
 */
export function seriesScale(values: readonly number[]): number {
  const peak = values.length ? Math.max(...values) : 0
  if (peak <= 1) return 1
  if (peak <= 100) return Math.ceil(peak / 5) * 5
  return Math.ceil(peak / 25) * 25
}

/**
 * `points` for an SVG polyline, oldest sample on the left.
 *
 * A single sample yields a short flat segment rather than one invisible point, so the
 * first poll draws something instead of looking broken. `''` for an empty series.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  scale: number = seriesScale(values),
): string {
  if (values.length === 0) return ''
  const safeScale = scale > 0 ? scale : 1
  const y = (value: number) => {
    const clamped = Math.min(Math.max(value, 0), safeScale)
    // SVG y grows downward, so a high value must sit near 0.
    return Number((height - (clamped / safeScale) * height).toFixed(2))
  }
  if (values.length === 1) return `0,${y(values[0]!)} ${width},${y(values[0]!)}`
  const step = width / (values.length - 1)
  return values.map((value, index) => `${Number((index * step).toFixed(2))},${y(value)}`).join(' ')
}
