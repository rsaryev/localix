import type { IndicatorPoint } from './indicator-contracts'

/**
 * Where a recomputed indicator series first differs from the one already on the chart, when that
 * difference is confined to the tail `update()` can reach — the previous last point onward.
 *
 * Returns the index to start `update()` calls from, or null when a full `setData` is required
 * (a repaint of an older point, a shrink, or a jump of more than one appended point). An identical
 * series returns `next.length`: nothing to push. The prefix comparison is a cheap numeric scan; the
 * point is to spare lightweight-charts the full re-ingest on every streaming tick.
 */
export function indicatorTailStart(
  previous: readonly IndicatorPoint[],
  next: readonly IndicatorPoint[],
): number | null {
  if (previous.length === 0) return null
  if (next.length !== previous.length && next.length !== previous.length + 1) return null
  const tail = previous.length - 1
  for (let i = 0; i < tail; i++) {
    if (!samePoint(previous[i]!, next[i]!)) return null
  }
  if (next[tail]!.time !== previous[tail]!.time) return null
  if (next.length === previous.length && samePoint(previous[tail]!, next[tail]!)) return next.length
  return tail
}

function samePoint(a: IndicatorPoint, b: IndicatorPoint): boolean {
  return (
    a.time === b.time &&
    (a as { value?: number }).value === (b as { value?: number }).value &&
    (a as { color?: string }).color === (b as { color?: string }).color
  )
}
