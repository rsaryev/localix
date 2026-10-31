// Generic, domain-agnostic horizontal-overflow detection for a scrollable strip
// (the tab bar, a chip row, …). Pure decision + a thin DOM hook, so the
// scrollWidth>clientWidth math is unit-testable without a DOM. Deliberately generic:
// it knows nothing about tabs — any horizontally-scrolling container can consume it
// to paint edge fades.
import { useEffect, useEffectEvent, useState, type DependencyList, type RefObject } from 'react'

/** Which edges have content clipped out of view (drives an edge fade per side). */
export interface TabOverflowState {
  /** Content is scrolled off the LEFT edge (something hidden to the left). */
  left: boolean
  /** Content is scrolled off the RIGHT edge (something hidden to the right). */
  right: boolean
}

/** A measurement snapshot of a scroll container — the only input the decision needs. */
export interface ScrollMetrics {
  scrollWidth: number
  clientWidth: number
  scrollLeft: number
}

export const NO_OVERFLOW: TabOverflowState = { left: false, right: false }

/**
 * Pure overflow decision. A strip overflows when its content is wider than its
 * viewport by more than `tolerance` (2px absorbs sub-pixel rounding so a
 * pixel-perfect fit never flickers a fade on). When it overflows, each edge is
 * "clipped" if there is more than `tolerance` of scroll room on that side.
 */
export function computeTabOverflow(m: ScrollMetrics, tolerance = 2): TabOverflowState {
  const overflow = m.scrollWidth - m.clientWidth > tolerance
  if (!overflow) return NO_OVERFLOW
  const maxScroll = m.scrollWidth - m.clientWidth
  return {
    left: m.scrollLeft > tolerance,
    right: maxScroll - m.scrollLeft > tolerance,
  }
}

/** Shallow equality so the hook only re-renders on an actual edge-state flip
 *  (a scroll that doesn't cross either edge boundary is a no-op). */
export function tabOverflowEqual(a: TabOverflowState, b: TabOverflowState): boolean {
  return a.left === b.left && a.right === b.right
}

/**
 * Track the horizontal overflow of the element in `ref`, re-measuring on the
 * three signals that can change it: the container resizes (ResizeObserver), the
 * user scrolls it, and the window resizes. `deps` re-measures on content changes
 * the observers don't see synchronously (e.g. the tab set changing width).
 * Set `enabled` to false when no overflow affordance is rendered; the hook then
 * owns no observers/listeners and returns the neutral state.
 *
 * `onResize` is called after a RESIZE re-measure only — never after a scroll. It
 * exists so the other consumer of "this strip changed size" (re-revealing the
 * active tab, re-measuring a sliding underline) shares this ResizeObserver rather
 * than attaching a second one to the same element.
 *
 * Returns the shallow-compared `{left,right}` edge state.
 */
export function useTabOverflow<T extends HTMLElement>(
  ref: RefObject<T | null>,
  deps: DependencyList = [],
  enabled = true,
  onResize?: () => void,
): TabOverflowState {
  const [state, setState] = useState<TabOverflowState>(NO_OVERFLOW)
  // An effect event, so a new callback identity per render never re-attaches the
  // observer below.
  const resized = useEffectEvent(() => onResize?.())

  useEffect(() => {
    if (!enabled) {
      setState((prev) => (tabOverflowEqual(prev, NO_OVERFLOW) ? prev : NO_OVERFLOW))
      return
    }
    const el = ref.current
    if (!el) return
    const measure = () => {
      const next = computeTabOverflow({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollLeft: el.scrollLeft,
      })
      // Shallow-compare inside the updater (reads the latest state, no ref) so a
      // scroll that doesn't cross an edge boundary returns the same ref → no render.
      setState((prev) => (tabOverflowEqual(prev, next) ? prev : next))
    }
    measure()
    const ro = new ResizeObserver(() => {
      measure()
      resized()
    })
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    const onWindowResize = () => {
      measure()
      resized()
    }
    window.addEventListener('resize', onWindowResize)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', onWindowResize)
    }
    // Re-run when the container ref or the caller's content deps change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, enabled, ...deps])

  return state
}
