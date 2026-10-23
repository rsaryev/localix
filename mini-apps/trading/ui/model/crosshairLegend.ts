/**
 * Pure chart-interaction helpers for the candlestick canvas: the crosshair OHLCV readout and the
 * "panned away from the live edge" predicate. Kept out of the component so the arithmetic (bar
 * direction, change, and the scroll-position sign convention) is unit-tested rather than eyeballed
 * against a live chart.
 */

/** The four values a candlestick series exposes at a crosshair point (lightweight-charts `BarData`). */
export interface OhlcBar {
  open: number
  high: number
  low: number
  close: number
}

/** A resolved OHLCV legend for one bar — what the header-strip overlay renders. */
export interface CrosshairLegend {
  bar: OhlcBar
  /** Bar volume, or `null` when the volume series had no point here (never a fabricated 0). */
  volume: number | null
  /** `close − open`, in quote currency. */
  changeAbs: number
  /** `(close − open) / open`, fractional. `null` when `open` is 0/invalid, so no percent is claimed. */
  changePct: number | null
  /** `high − low`, the bar's full range in quote currency — always `>= 0`. The volatility of the bar,
   *  which `changeAbs` (close vs open) hides: a bar can close flat after a violent wick. */
  rangeAbs: number
  /** `(high − low) / open`, fractional amplitude. `null` when `open` is 0/invalid. */
  rangePct: number | null
  /** Bar direction: +1 up, -1 down, 0 flat — drives the up/down tint. */
  sign: -1 | 0 | 1
}

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n)
}

/**
 * Build the crosshair legend from a hovered bar + its volume. Returns `null` when the bar is missing
 * or any of its four prices is non-finite — the caller then renders nothing rather than a legend of
 * em-dashes. Volume is passed through only when finite; a missing volume point stays `null` (the
 * chart must never invent a bar's volume).
 */
export function buildCrosshairLegend(
  bar: OhlcBar | null | undefined,
  volume: number | null | undefined,
): CrosshairLegend | null {
  if (!bar || !finite(bar.open) || !finite(bar.high) || !finite(bar.low) || !finite(bar.close)) {
    return null
  }
  const changeAbs = bar.close - bar.open
  const changePct = bar.open > 0 ? changeAbs / bar.open : null
  const rangeAbs = bar.high - bar.low
  const rangePct = bar.open > 0 ? rangeAbs / bar.open : null
  const sign: -1 | 0 | 1 = changeAbs > 0 ? 1 : changeAbs < 0 ? -1 : 0
  return {
    bar: { open: bar.open, high: bar.high, low: bar.low, close: bar.close },
    volume: finite(volume) ? volume : null,
    changeAbs,
    changePct,
    rangeAbs,
    rangePct,
    sign,
  }
}

/**
 * Has the user panned away from the live (right) edge of the chart?
 *
 * lightweight-charts' `timeScale().scrollPosition()` returns the chart's `rightOffset` — the distance
 * in bars from the right edge to the latest bar. At the live edge it equals the configured realtime
 * offset (0 by default); dragging back into history moves the latest bar off to the right and drives
 * the offset NEGATIVE. So "away" is `scrollPosition` sitting a bar or more below the realtime offset.
 * The `slackBars` margin absorbs sub-bar jitter so the affordance never flickers at the edge.
 */
export function isAwayFromRealtime(
  scrollPosition: number,
  realtimeOffset = 0,
  slackBars = 1,
): boolean {
  return Number.isFinite(scrollPosition) && scrollPosition < realtimeOffset - slackBars
}
