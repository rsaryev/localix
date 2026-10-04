/**
 * One cadence-adaptive debounce shared by every Tab-suggestion surface: the
 * editor's edit prediction and the text-input inline completions. Pure, so both
 * callers keep their own bounds and stay deterministically unit-testable.
 */

export interface AdaptiveDebounceBounds {
  minMs: number
  maxMs: number
  /** Used until there is cadence history to adapt to. */
  defaultMs: number
}

/**
 * Derive a debounce from recent inter-edit intervals (ms).
 *
 * A fast typist (short intervals) gets a LONGER wait so a request never fires
 * mid-burst only to be superseded; deliberate editing (long gaps) gets a SHORTER
 * one, because a pause is the signal that a suggestion is wanted now. The median
 * of the recent window drives it, clamped to the caller's window.
 *
 * The alternative — one flat delay — has to be pessimistic enough for the fastest
 * typist, which makes it needlessly sluggish for everyone else. Continue ships a
 * flat `debounceDelay: 350` for ghost text and pairs it with a `modelTimeout: 150`
 * and a `showWhateverWeHaveAtXMs: 300` partial-result deadline
 * (`core/util/parameters.ts`); adapting the wait itself is the cheaper half of
 * that idea when the surface cannot stream partial results.
 */
export function adaptiveDebounceMs(
  recentIntervalsMs: readonly number[],
  bounds: AdaptiveDebounceBounds,
): number {
  const samples = recentIntervalsMs.filter((value) => Number.isFinite(value) && value >= 0)
  if (samples.length === 0) return bounds.defaultMs
  const sorted = [...samples].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  const span = bounds.maxMs - bounds.minMs
  // Map the median onto the inverse of the window: cadence at or above the span
  // bottoms out at minMs, instantaneous cadence tops out at maxMs.
  const debounce = bounds.maxMs - Math.min(median, span)
  return Math.max(bounds.minMs, Math.min(bounds.maxMs, Math.round(debounce)))
}

/** Ring of the most recent inter-event gaps, sized for a median that reacts
 *  within a word or two of typing rather than over a whole session. */
export const ADAPTIVE_CADENCE_WINDOW = 5

/** Append one gap to a bounded cadence window. Pure: returns a new array. */
export function pushCadenceSample(
  window: readonly number[],
  intervalMs: number,
  limit: number = ADAPTIVE_CADENCE_WINDOW,
): number[] {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) return [...window]
  return [...window, intervalMs].slice(-limit)
}
