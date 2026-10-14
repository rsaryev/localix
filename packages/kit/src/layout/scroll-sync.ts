// Generic, framework-agnostic percentage-based scroll synchronization for a
// split view (editor ⇄ preview). Two scrollers stay aligned by scroll PERCENTAGE
// rather than absolute pixels, so panes of different heights track proportionally.
//
// The two sides are decoupled through a DOM attribute + MutationObserver pub/sub:
// a scroller PUBLISHES its percentage onto its peer's `data-target-scroll-percent`
// attribute, and each pane OBSERVES its own attribute to apply the target. This
// keeps a consumer whose real scroller may be a nested editor surface
// from ever having to hand out a ref to its internal DOM. A requestAnimationFrame-
// released guard breaks the A→B→A feedback loop when applying a synced scroll.

/** The attribute a peer's target scroll percentage (0..1) is written onto. */
export const SCROLL_SYNC_ATTR = 'data-target-scroll-percent'

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

export interface ScrollGeometry {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** Current scroll position as a 0..1 fraction of the scrollable range. A pane with
 *  no overflow (nothing to scroll) is defined as 0 (top-aligned). */
export function scrollPercent(m: ScrollGeometry): number {
  const max = m.scrollHeight - m.clientHeight
  return max <= 0 ? 0 : clamp01(m.scrollTop / max)
}

/** The scrollTop (px) that places a pane at `percent` of its scrollable range. */
export function percentToScrollTop(
  percent: number,
  m: Pick<ScrollGeometry, 'scrollHeight' | 'clientHeight'>,
): number {
  const max = m.scrollHeight - m.clientHeight
  return max <= 0 ? 0 : clamp01(percent) * max
}

/** Publish a scroll percentage onto an element's sync attribute for its peer's
 *  observer to consume. Rounded to 4dp so sub-pixel jitter doesn't churn the
 *  MutationObserver with no-op mutations. No-op on a null element. */
export function publishScrollPercent(el: HTMLElement | null, percent: number): void {
  if (!el) return
  el.setAttribute(SCROLL_SYNC_ATTR, clamp01(percent).toFixed(4))
}

/** Observe an element's sync attribute; `apply(percent)` runs on each change.
 *  Returns a disposer that disconnects the observer. */
export function observeScrollPercentTarget(
  el: HTMLElement,
  apply: (percent: number) => void,
): () => void {
  const read = () => {
    const raw = el.getAttribute(SCROLL_SYNC_ATTR)
    if (raw == null) return
    const p = Number(raw)
    if (Number.isFinite(p)) apply(clamp01(p))
  }
  const observer = new MutationObserver(read)
  observer.observe(el, { attributes: true, attributeFilter: [SCROLL_SYNC_ATTR] })
  return () => observer.disconnect()
}

export interface ScrollSyncGuard {
  /** True while a programmatic (synced) scroll is being applied — a scroll handler
   *  MUST bail during this to avoid echoing the scroll back to its peer. */
  isGuarded: () => boolean
  /** Run a programmatic scroll with the feedback guard raised, released on the next
   *  animation frame (after the scroll event it triggers has fired + been ignored). */
  guard: (applyScroll: () => void) => void
}

function requestNextAnimationFrame(callback: () => void): void {
  // WebKit may reject an extracted Web-IDL method with "Illegal invocation".
  // Keep the Window receiver at the only production call site.
  globalThis.requestAnimationFrame(callback)
}

/**
 * rAF-released anti-feedback guard. Syncing A→B scrolls B, which fires B's scroll
 * handler, which would publish back to A, which scrolls A, … — an infinite loop.
 * Wrapping the programmatic scroll in `guard()` raises a flag its own scroll handler
 * checks (via `isGuarded`) and skips, releasing the flag on the next frame once the
 * synthetic scroll event has been swallowed.
 */
export function createScrollSyncGuard(
  raf: (cb: () => void) => void = requestNextAnimationFrame,
): ScrollSyncGuard {
  let guarded = false
  return {
    isGuarded: () => guarded,
    guard(applyScroll) {
      guarded = true
      applyScroll()
      raf(() => {
        guarded = false
      })
    },
  }
}
