// Keeping the active item of a horizontally scrolling strip in view: the pure
// clamp math, its DOM applier, and the one hook that drives both signals which
// can hide it (the active item changing, and the strip being resized).
//
// Deliberately NOT `Element.scrollIntoView({ inline: 'nearest' })`, which was the
// previous implementation and is wrong here in three ways:
//
//  * It walks EVERY scrollable ancestor, so revealing a tab could scroll the page
//    vertically (`block: 'nearest'` is not a promise to stay put — it is a promise
//    to move as little as possible, which is still moving).
//  * It knows nothing about the affordances painted OVER a strip's edges — the
//    scroll chevrons and edge fades. `nearest` parks the first/last tab flush
//    against the edge, i.e. underneath them, where it is unreadable and (for the
//    opaque chevron buttons) unclickable.
//  * It has no notion of "close enough": it re-aligns on every call, cancelling an
//    in-flight fling.
//
// Doing the arithmetic ourselves fixes all three, and the final clamp to
// `[0, scrollWidth - clientWidth]` is what makes the FIRST and LAST item reliably
// reachable — aiming past an end lands exactly on it instead of leaving a sliver
// permanently clipped.
import { useCallback, useEffect, type RefObject } from 'react'

/** Container geometry plus the target's position within the scrollable content. */
export interface RevealMetrics {
  clientWidth: number
  scrollWidth: number
  scrollLeft: number
  /** Target's offset from the START of the content (i.e. scroll-independent). */
  itemStart: number
  itemWidth: number
}

/** Space to keep clear at each edge because an affordance is painted over it. */
export interface RevealPadding {
  start?: number
  end?: number
}

export const NO_REVEAL_PADDING: RevealPadding = {}

/**
 * The `scrollLeft` that brings `item` into view, or `null` for "leave it alone".
 *
 * `null` is returned whenever the item is already comfortably visible or the
 * required move is within `tolerance` — writing `scrollLeft` unconditionally is
 * what makes a strip fight the user's momentum.
 */
export function computeRevealScrollLeft(
  m: RevealMetrics,
  padding: RevealPadding = NO_REVEAL_PADDING,
  tolerance = 1,
): number | null {
  const max = m.scrollWidth - m.clientWidth
  if (max <= tolerance) return null // nothing to scroll

  // A narrow strip must not have its whole viewport eaten by the two reserves,
  // or a reveal would have nowhere left to aim: cap each at a third of the width.
  const cap = Math.max(m.clientWidth / 3, 0)
  const padStart = Math.min(Math.max(padding.start ?? 0, 0), cap)
  const padEnd = Math.min(Math.max(padding.end ?? 0, 0), cap)

  const viewStart = m.scrollLeft + padStart
  const viewEnd = m.scrollLeft + m.clientWidth - padEnd
  const itemEnd = m.itemStart + m.itemWidth
  const startAligned = m.itemStart - padStart
  const endAligned = itemEnd + padEnd - m.clientWidth

  let next: number
  if (m.itemWidth >= m.clientWidth - padStart - padEnd) {
    // Wider than the room it can be shown in. Already covering the whole window
    // is as good as it gets; otherwise pin its START so the label reads from the
    // beginning instead of the strip parking on its tail.
    if (m.itemStart <= viewStart + tolerance && itemEnd >= viewEnd - tolerance) return null
    next = startAligned
  } else if (m.itemStart < viewStart - tolerance) {
    next = startAligned
  } else if (itemEnd > viewEnd + tolerance) {
    next = endAligned
  } else {
    return null // already comfortably in view
  }

  next = Math.min(Math.max(next, 0), max)
  return Math.abs(next - m.scrollLeft) <= tolerance ? null : next
}

/**
 * Apply {@link computeRevealScrollLeft} to a live element pair. Touches ONLY the
 * container's `scrollLeft` — never an ancestor, never the vertical axis.
 */
export function revealItemInStrip(
  container: HTMLElement,
  item: HTMLElement,
  padding?: RevealPadding,
): void {
  const containerRect = container.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  const next = computeRevealScrollLeft(
    {
      clientWidth: container.clientWidth,
      scrollWidth: container.scrollWidth,
      scrollLeft: container.scrollLeft,
      // Measured from rects rather than `offsetLeft`, which is relative to the
      // nearest positioned ancestor — every tab here sits in a `relative` wrapper.
      itemStart: itemRect.left - containerRect.left + container.scrollLeft,
      itemWidth: itemRect.width,
    },
    padding,
  )
  if (next !== null) container.scrollLeft = next
}

export interface RevealActiveTabOptions<T extends string, E extends HTMLElement> {
  containerRef: RefObject<HTMLElement | null>
  /** Live map of item id → its element, as populated by the strip's ref callbacks. */
  itemRefs: RefObject<Map<T, E>>
  activeId: T | null | undefined
  /** Edge reserves for the affordances this strip paints over its scroll region. */
  padding?: RevealPadding
}

/**
 * Reveal the active item whenever the active id changes: open a file, pick from
 * the overflow menu, cycle by keyboard, restore a route.
 *
 * The OTHER signal that can hide the active item — the container being resized —
 * is deliberately not observed here. `useTabOverflow` already owns a
 * ResizeObserver on the same element, so a strip hands the returned callback to
 * that hook's `onResize` and the two share one observer instead of racing two.
 *
 * Returns a stable-per-active-id reveal callback, also callable imperatively.
 */
export function useRevealActiveTab<T extends string, E extends HTMLElement>({
  containerRef,
  itemRefs,
  activeId,
  padding,
}: RevealActiveTabOptions<T, E>): () => void {
  // Keyed by the two numbers, not the object, so a fresh padding object per render doesn't
  // churn the callback identity (and with it the effect below).
  const start = padding?.start
  const end = padding?.end

  const reveal = useCallback(() => {
    const container = containerRef.current
    if (!container || activeId == null) return
    const item = itemRefs.current?.get(activeId)
    if (item) revealItemInStrip(container, item, { start, end })
  }, [containerRef, itemRefs, activeId, start, end])

  useEffect(() => {
    reveal()
  }, [reveal])

  return reveal
}
