import type { HistogramData, LineData, UTCTimestamp } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'

/**
 * Adapts the agnostic `Candle[]` (whose `time` is UNIX SECONDS — exactly what
 * lightweight-charts wants) into the library's `HistogramData` (volume) and `LineData`
 * arrays, and provides the streaming `upsertBar` merge used by the poll
 * loop so a live tick replaces the in-progress bar instead of re-fetching all history.
 * Pure (no chart handle) so the mapping + merge are unit-tested.
 */

/** Volume-bar colors, supplied by the theme-aware chart tab (up vs down bar). */
export interface VolumeColors {
  up: string
  down: string
}

/**
 * Volume columns. A bar the venue reported NO volume for draws no column — a zero-height column and
 * an unreported volume look identical on screen, and only one of them means nothing traded.
 */
export function toVolumeData(candles: Candle[], colors: VolumeColors): HistogramData[] {
  const out: HistogramData[] = []
  for (const c of candles) {
    if (c.volume === undefined) continue
    out.push({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? colors.up : colors.down,
    })
  }
  return out
}

/**
 * Simple moving average of the closes, as a `LineData[]` for an overlay line series.
 *
 * A point is emitted ONLY once `period` closes are available — a partial average over the first few
 * bars is a different, misleading number (a "20 SMA" that is really a 3-bar mean near the left edge),
 * so the line simply starts `period − 1` bars in rather than drawing a warped head. `candles` is
 * ascending by time (the same order the series holds). `period < 1` or too few bars → `[]`.
 */
export function movingAverage(candles: Candle[], period: number): LineData[] {
  if (period < 1) return []
  const out: LineData[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i]!.close
    if (i >= period) sum -= candles[i - period]!.close
    if (i >= period - 1) out.push({ time: candles[i]!.time as UTCTimestamp, value: sum / period })
  }
  return out
}

/** Do two bars carry the same numbers? A byte-identical replace is skipped so the array
 *  reference stays stable and React bails out of the render. */
function sameBar(a: Candle, b: Candle): boolean {
  return (
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  )
}

/** Index of the bar with exactly `time`, else `~insertionPoint`. `candles` is ascending by time. */
function findBar(candles: Candle[], time: number): number {
  let lo = 0
  let hi = candles.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const t = candles[mid]!.time
    if (t === time) return mid
    if (t < time) lo = mid + 1
    else hi = mid - 1
  }
  return ~lo
}

/**
 * Merge one candle into an ordered `Candle[]` (ascending `time`).
 *
 * A bar older than the newest one is a CORRECTION, not a stale tick. Both the tail poll and
 * ccxt.pro's `watchOHLCV` push a rolling WINDOW, and a venue finalises a bar's close, high, low and
 * volume with the trades that landed in its last moments — after the next bar has already opened.
 * Dropping anything older than the last bar froze every closed candle at whatever it happened to
 * hold when the rollover was observed, so the chart's history was subtly wrong forever after.
 *
 *  - `time` matches an existing bar → REPLACE it (an update or a late correction);
 *  - newer than every bar → APPEND;
 *  - falls in a gap → INSERT in place, preserving the ascending order lightweight-charts requires.
 *
 * Returns a new array only when something changed, else the SAME reference.
 */
export function upsertBar(candles: Candle[], next: Candle): Candle[] {
  const at = findBar(candles, next.time)
  if (at >= 0) {
    if (sameBar(candles[at]!, next)) return candles
    const copy = candles.slice()
    copy[at] = next
    return copy
  }
  const insertAt = ~at
  if (insertAt === candles.length) return [...candles, next]
  return [...candles.slice(0, insertAt), next, ...candles.slice(insertAt)]
}

/**
 * Fold a batch of incoming candles (the tail poll, a stream window, or a 500-bar backfill page)
 * into the series — ONE ordered merge, not a per-bar re-insert. The per-bar `upsertBar` copies the
 * whole array on every insert, which made a backfill page O(n·m); a merge of two sorted runs is
 * O(n+m) and allocates once.
 *
 * Same semantics as the old reduce: a later duplicate in `incoming` wins, an incoming bar that
 * matches an existing one byte-for-byte keeps the EXISTING object, and the SAME array reference
 * comes back when nothing changed at all (so React bails out of the render).
 */
export function upsertCandles(candles: Candle[], incoming: Candle[]): Candle[] {
  if (incoming.length === 0) return candles
  if (incoming.length === 1) return upsertBar(candles, incoming[0]!)

  // Normalize `incoming` into an ascending, deduped run (last occurrence of a time wins) —
  // stream windows are already ascending, so this is usually a cheap verify-only pass.
  let sorted = incoming
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.time <= sorted[i - 1]!.time) {
      sorted = [...incoming].sort((a, b) => a.time - b.time)
      break
    }
  }
  const run: Candle[] = []
  for (const bar of sorted) {
    if (run.length > 0 && run[run.length - 1]!.time === bar.time) run[run.length - 1] = bar
    else run.push(bar)
  }

  const merged: Candle[] = []
  let changed = false
  let i = 0
  let j = 0
  while (i < candles.length || j < run.length) {
    const a = candles[i]
    const b = run[j]
    if (b === undefined || (a !== undefined && a.time < b.time)) {
      merged.push(a!)
      i++
    } else if (a === undefined || b.time < a.time) {
      merged.push(b)
      changed = true
      j++
    } else {
      // Same time — the incoming bar is an update/correction; keep the old object when identical.
      merged.push(sameBar(a, b) ? a : ((changed = true), b))
      i++
      j++
    }
  }
  return changed ? merged : candles
}

/**
 * How the next candle array relates to what the chart already rendered — decided ONCE, purely,
 * so the canvas can route the common cases through lightweight-charts' incremental
 * `series.update()` instead of rebuilding a many-hundred-bar series:
 *
 *  - `none`   — byte-identical (or both empty): touch nothing.
 *  - `tick`   — only the LAST bar changed in place: one `update()` per series.
 *  - `append` — one new bar opened; `corrected` carries the previous bar's final numbers when the
 *    rollover also finalised it (close/high/low/volume land after the next bar opens). Both fit
 *    `update()` — replacing the current last bar, then appending — so a 1m chart no longer pays a
 *    full `setData` every minute.
 *  - `reset`  — anything else (initial load, prepend, deep correction, shrink): `setData`.
 */
export type CandleUpdate =
  | { kind: 'none' }
  | { kind: 'tick'; bar: Candle }
  | { kind: 'append'; bar: Candle; corrected: Candle | null }
  | { kind: 'reset' }

export function classifyCandleUpdate(previous: Candle[], next: Candle[]): CandleUpdate {
  if (previous.length === 0 && next.length === 0) return { kind: 'none' }
  if (previous.length === 0 || next.length === 0) return { kind: 'reset' }
  if (next.length !== previous.length && next.length !== previous.length + 1)
    return { kind: 'reset' }

  // The shared prefix — every bar except the previous LAST — must be untouched (`update()` can
  // only reach the tail). Time alignment included: a prepend or a gap-fill shifts it and resets.
  for (let i = 0; i < previous.length - 1; i++) {
    const a = previous[i]!
    const b = next[i]!
    if (a.time !== b.time || !sameBar(a, b)) return { kind: 'reset' }
  }

  const prevLast = previous[previous.length - 1]!
  const atPrevLast = next[previous.length - 1]!
  if (atPrevLast.time !== prevLast.time) return { kind: 'reset' }

  if (next.length === previous.length) {
    return sameBar(prevLast, atPrevLast) ? { kind: 'none' } : { kind: 'tick', bar: atPrevLast }
  }
  const appended = next[next.length - 1]!
  if (appended.time <= atPrevLast.time) return { kind: 'reset' }
  return {
    kind: 'append',
    bar: appended,
    corrected: sameBar(prevLast, atPrevLast) ? null : atPrevLast,
  }
}
