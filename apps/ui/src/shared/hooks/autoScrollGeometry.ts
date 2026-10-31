export const BOTTOM_THRESHOLD_PX = 80

export function isNearBottom(distanceFromBottom: number, threshold = BOTTOM_THRESHOLD_PX) {
  return distanceFromBottom <= threshold
}

/** Geometry `atBottom` reads — an element, or a plain object in tests. */
export interface ScrollGeometry {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}

/**
 * Can this viewport scroll at all? One pixel of overflow cannot (browsers round sub-pixel layout),
 * so the tolerance is part of the question, not a fudge.
 */
export function isViewportScrollable(geometry: Omit<ScrollGeometry, 'scrollTop'>): boolean {
  return geometry.scrollHeight > geometry.clientHeight + 1
}

/**
 * THE one predicate behind BOTH the follow state and the scroll-to-bottom button.
 *
 * A viewport that cannot scroll is AT THE BOTTOM — there is nowhere else to be. The absence of
 * that clause is what put a button on screen with nothing to scroll to, so the predicate opens
 * with `if (scrollHeight <= clientHeight) return true` and the button derives from it.
 *
 * Deriving the button from the SAME call that decides following is the other half: the two used to be
 * written from five sites independently, and the restore path set the button before measuring
 * anything.
 */
export function atBottom(geometry: ScrollGeometry, threshold = BOTTOM_THRESHOLD_PX): boolean {
  if (!isViewportScrollable(geometry)) return true
  return isNearBottom(geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight, threshold)
}

export function bottomScrollTop(scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight)
}

export function needsBottomScroll(scrollTop: number, targetTop: number): boolean {
  return Math.abs(scrollTop - targetTop) >= 2
}

export function shouldScheduleBottomReapply(
  behavior: ScrollBehavior,
  framePending: boolean,
): boolean {
  return behavior !== 'smooth' && !framePending
}

export type ContentChangeAction = 'scroll-now' | 'schedule-frame' | 'none'

export function contentChangeAction(
  pinned: boolean,
  blocked: boolean,
  framePending: boolean,
): ContentChangeAction {
  // Content growth must never infer that an explicitly-unpinned reader wants to
  // follow again. In particular, a small streamed delta can leave them inside
  // the 80px near-bottom band; scheduling `syncPinnedState` here would re-pin on
  // the very next frame and yank their wheel/selection back to the live tail.
  if (!pinned) return 'none'
  if (!blocked) return 'scroll-now'
  return framePending ? 'none' : 'schedule-frame'
}

// How long after a wheel/touch input scroll events are attributed to the user
// (and therefore bypass the programmatic-scroll guard below).
export const USER_INPUT_WINDOW_MS = 200
