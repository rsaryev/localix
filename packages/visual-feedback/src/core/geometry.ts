/**
 * Geometry — element rects in the page's own viewport coordinates (CSS px).
 *
 * The probe draws its overlay IN-PAGE with a `position:fixed` root, so viewport
 * coordinates track scroll natively (re-read on scroll/resize). The host only
 * needs the element's viewport rect (relative to the iframe) to anchor its
 * composer; persistence is by selector, so no document-percentage math is needed.
 */

import type { VfRect } from '../protocol/index'

/** Element bounding rect in viewport px. */
export function getViewportRect(el: Element): VfRect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

/**
 * The element that scrolls a subtree: the root itself or its first scrolling descendant, in
 * document order. A page scrolls the window; a panel embedded in an app scrolls a box inside it,
 * and scrolling the window there moves nothing the agent is looking at.
 */
export function scrollContainerIn(root: Element): Element | null {
  const queue: Element[] = [root]
  for (let seen = 0; queue.length && seen < 400; seen++) {
    const el = queue.shift()!
    const overflow = getComputedStyle(el).overflowY
    if (el.scrollHeight > el.clientHeight + 1 && /^(auto|scroll|overlay)$/u.test(overflow))
      return el
    queue.push(...Array.from(el.children))
  }
  return null
}
