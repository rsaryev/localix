/**
 * Loading OLDER candles when the trader scrolls off the left edge of the history.
 *
 * A chart seeds with a fixed window (500 bars). On a 1-minute timeframe that is eight hours: scroll
 * back and the price simply stops existing. Backward pagination keeps earlier bars reachable, and
 * the venue read already takes a `since` — the only things missing were when to ask, what to ask
 * for, and how not to yank the view out from under the pointer when the answer lands.
 *
 * All three are arithmetic, so they live here, pure and tested, rather than inside a chart effect
 * where they could only be verified by scrolling.
 */

// Timeframe arithmetic is shared with the ccxt driver (which derives a default `since` for a
// venue that refuses a since-less OHLCV read) — one clock, both sides of the wire.
import { timeframeMs } from '../../backend/timeframes'

export { timeframeMs }

/**
 * How close to the left edge (in bars still to the left of the viewport) triggers a fetch. Small
 * enough that a fetch is a deliberate consequence of scrolling back, large enough that the bars
 * arrive before the trader reaches the void.
 */
export const BACKFILL_TRIGGER_BARS = 20

/** True when the visible range has come within {@link BACKFILL_TRIGGER_BARS} of the oldest bar. */
export function shouldBackfill(
  logicalRangeFrom: number,
  trigger: number = BACKFILL_TRIGGER_BARS,
): boolean {
  // lightweight-charts reports a NEGATIVE `from` once the viewport scrolls past the first bar, so
  // this must not require a positive index.
  return logicalRangeFrom < trigger
}

export interface BackfillRequest {
  /** Venue `since`, in ms — the start of the window BEFORE the oldest bar we hold. */
  since: number
  /** Venue `until`, in ms — the oldest bar we hold. Bounds what the venue SENDS, not merely what
   *  is kept: given a `since` alone, ccxt requests `[since, now]` and discards everything past
   *  `limit`, so each page back re-downloads the whole history in front of it. Measured on
   *  Hyperliquid, ten pages back on `1m`: 5179 bars sent for 500 kept, against 501 when bounded. */
  until: number
  /** How many bars to ask for. */
  limit: number
}

/**
 * The window immediately before `oldestBarTimeSec`, or `null` when we cannot place one.
 *
 * The venue returns bars from `since` FORWARD, so an older page is requested by walking `since` back
 * `bars` timeframes from the oldest bar we already hold. The oldest bar itself is re-requested (the
 * window ends where our data begins) and the merge treats a re-sent bar as a correction, not a
 * duplicate.
 */
export function backfillRequest(
  oldestBarTimeSec: number,
  timeframe: string,
  bars: number,
): BackfillRequest | null {
  const step = timeframeMs(timeframe)
  if (step === null || bars <= 0) return null
  const until = oldestBarTimeSec * 1000
  const since = until - step * bars
  // A `since` before the epoch is not a window any venue can answer; refuse rather than send it.
  return since >= 0 ? { since, until, limit: bars } : null
}

/**
 * Where the viewport must move so the SAME bars stay under the pointer after `added` older bars are
 * prepended.
 *
 * lightweight-charts indexes bars logically from the start of the series. Prepending shifts every
 * existing bar's index up by `added`, so a viewport left alone would silently jump backwards in
 * time — the trader scrolls left, the history arrives, and the chart snaps somewhere else. Shift the
 * range by the same amount and the view does not move at all; only the void to its left fills in.
 */
export function shiftedRange(
  range: { from: number; to: number },
  added: number,
): { from: number; to: number } {
  return { from: range.from + added, to: range.to + added }
}

/**
 * How many bars were PREPENDED, measured from the series itself: the bars now older than the one
 * that used to be first.
 *
 * The shift cannot be taken from the fetch's return value. The fetch resolves, sets React state, and
 * continues — but the chart is redrawn later, when React re-renders. Shifting the viewport in the
 * promise moves it against data the chart does not hold yet, and lightweight-charts clamps a range
 * to the bars it currently has; the clamp survives the redraw and the chart jumps. So the shift must
 * be computed where the new bars are handed to the series, from what actually changed.
 *
 * `previousFirstBarTimeSec` is `null` on the first paint (nothing was prepended into an empty chart).
 * A first bar that is unchanged, or a series that lost its head (a symbol switch), prepends nothing.
 */
export function prependedBars(
  previousFirstBarTimeSec: number | null,
  candles: readonly { time: number }[],
): number {
  if (previousFirstBarTimeSec === null) return 0
  const at = candles.findIndex((c) => c.time === previousFirstBarTimeSec)
  return at > 0 ? at : 0
}
