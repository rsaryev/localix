/**
 * Pure viewport arithmetic for the agent's `navigate` chart commands. The canvas applies these to
 * `timeScale().setVisibleLogicalRange` — logical units, where bar N sits at index N, so the math
 * needs only the candle array, never the chart.
 */

export interface LogicalRange {
  from: number
  to: number
}

/** The viewport can never collapse below this many bars — a zoom-in on a tiny range must stop
 *  while the chart still reads as a chart. */
const MIN_SPAN = 5

/**
 * Zoom around the range's CENTER: factor 0.5 halves the visible window (zoom in), 2 doubles it
 * (zoom out). The anchor the user was looking at stays put.
 */
export function zoomedRange(range: LogicalRange, factor: number): LogicalRange {
  const span = Math.max(range.to - range.from, 0)
  const next = Math.max(span * factor, MIN_SPAN)
  const center = (range.from + range.to) / 2
  return { from: center - next / 2, to: center + next / 2 }
}

/**
 * The logical range that CENTERS the bar nearest `time` (unix seconds), keeping the current
 * span. Null when there is no history to aim at — the caller then leaves the viewport alone
 * (only loaded bars can be reached; deep history needs backfill first, which stays user-driven).
 */
export function rangeAroundTime(
  candles: ReadonlyArray<{ time: number }>,
  time: number,
  currentSpan: number,
): LogicalRange | null {
  if (candles.length === 0) return null
  // The nearest bar by |Δt| — a binary search would also work, but a chart holds at most a few
  // thousand bars and this runs once per command, not per frame.
  let best = 0
  let bestDelta = Number.POSITIVE_INFINITY
  for (let i = 0; i < candles.length; i++) {
    const delta = Math.abs(candles[i]!.time - time)
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  }
  const span = Math.max(currentSpan, MIN_SPAN)
  return { from: best - span / 2, to: best + span / 2 }
}
