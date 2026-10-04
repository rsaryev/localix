// Wheel handling for an overflowing single-row strip (tab bars, breadcrumbs):
// the pure decision plus the thin non-passive listener that applies it.
//
// The decision is separated from the DOM so the interesting part — WHICH wheels we
// may take over, and when we must hand one back — is unit-testable without a
// browser, and so the two rules that were previously wrong are pinned by tests:
//
//  1. A horizontally-dominant gesture (a trackpad swipe, a tilt wheel) is ALREADY
//     a horizontal scroll. The browser applies it with its own momentum curve.
//     Taking it over means `preventDefault` cancels the real `deltaX` and we
//     re-apply the tiny orthogonal `deltaY` in its place — so the strip crawls,
//     and near either end the alternating sign of an inertial `deltaY` reads as
//     the strip springing back off the boundary. Leave those wheels alone.
//  2. When the strip is pinned at an end we cannot consume the wheel, so we must
//     not `preventDefault` it either — otherwise the page silently stops
//     scrolling vertically whenever the pointer rests over a tab bar.
import { useEffect, useRef } from 'react'

/** One wheel event reduced to what the decision needs. */
export interface WheelIntent {
  deltaX: number
  deltaY: number
  /** `WheelEvent.deltaMode`: 0 = pixel, 1 = line, 2 = page. */
  deltaMode: number
}

/** The strip's geometry at the moment of the wheel. */
export interface StripScrollMetrics {
  scrollWidth: number
  clientWidth: number
  scrollLeft: number
  scrollHeight: number
  clientHeight: number
}

/** Pixels one line-mode notch is worth. Firefox reports wheels in lines (3 per
 *  notch); treating that as 3 PIXELS made a notch move the strip imperceptibly. */
export const WHEEL_LINE_PX = 16

/** Leave the event to the browser, or consume it by scrolling to `scrollLeft`. */
export type WheelOutcome = { type: 'ignore' } | { type: 'scroll'; scrollLeft: number }

export const IGNORE_WHEEL: WheelOutcome = { type: 'ignore' }

/** Convert a line/page-mode delta into pixels; pixel-mode passes through. */
export function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX
  if (deltaMode === 2) return delta * pageSize
  return delta
}

/**
 * Decide what a wheel over a horizontal strip should do.
 *
 * Returns `scroll` ONLY for a wheel we can fully consume — a vertically-dominant
 * wheel over a strip that still has room to move in that direction. Every other
 * wheel is ignored, which means the browser keeps its native behaviour: native
 * horizontal scrolling (with its inertia) for a horizontal gesture, and page
 * scrolling for a vertical one the strip cannot absorb.
 */
export function decideWheelScroll(
  intent: WheelIntent,
  m: StripScrollMetrics,
  tolerance = 1,
): WheelOutcome {
  // A real vertical scroller owns its own wheel — never repurpose it.
  if (m.scrollHeight > m.clientHeight) return IGNORE_WHEEL
  const max = m.scrollWidth - m.clientWidth
  if (max <= tolerance) return IGNORE_WHEEL // nothing to scroll horizontally

  const dx = normalizeWheelDelta(intent.deltaX, intent.deltaMode, m.clientWidth)
  const dy = normalizeWheelDelta(intent.deltaY, intent.deltaMode, m.clientWidth)
  // Rule 1: the gesture is already horizontal — hands off, including its inertia.
  // (A vertical trackpad swipe carries a little `deltaX` noise; comparing
  // MAGNITUDES keeps translating those, and only yields on a real sideways swipe.)
  if (Math.abs(dx) > Math.abs(dy)) return IGNORE_WHEEL
  if (dy === 0) return IGNORE_WHEEL

  const next = Math.min(Math.max(m.scrollLeft + dy, 0), max)
  // Rule 2: pinned at that end — hand the wheel back to the page.
  if (next === m.scrollLeft) return IGNORE_WHEEL
  return { type: 'scroll', scrollLeft: next }
}

/**
 * Translate vertical wheel scrolling into horizontal scrolling on an overflowing
 * single-row strip — the familiar editor behavior. Uses a NON-passive native
 * listener so `preventDefault` actually works (React's `onWheel` is passive), but
 * only prevents the wheels `decideWheelScroll` says we can consume.
 */
export function useHorizontalWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const outcome = decideWheelScroll(
        { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode },
        {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          scrollLeft: el.scrollLeft,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        },
      )
      if (outcome.type !== 'scroll') return
      e.preventDefault()
      el.scrollLeft = outcome.scrollLeft
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  return ref
}
