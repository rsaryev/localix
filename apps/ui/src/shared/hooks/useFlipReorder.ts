/**
 * MOVE REORDERED CHILDREN INSTEAD OF TELEPORTING THEM.
 *
 * When a list re-sorts itself under the reader — the participants strip putting the speaker
 * first — every item that changed place jumps in a single frame, and the reader loses the one
 * they were looking at. This hook animates the change instead (FLIP: First, Last, Invert, Play):
 * it knows where each child was laid out before the order changed, measures where it is after,
 * and plays the difference back to zero with the Web Animations API, so nothing re-renders and
 * no CSS `order` trick separates the DOM order from the visual one.
 *
 * Generic on purpose: children are found by `data-flip-key`, so any horizontal list opts in by
 * marking its items and passing the same keys it renders.
 *
 * What it refuses to do, each for a failure seen in FLIP implementations:
 * - no motion on first mount or when `scope` changes (another conversation's strip with the same
 *   agent ids is not a reorder);
 * - no motion under `prefers-reduced-motion: reduce`;
 * - no literal timing: duration and easing come from the `--dur-moderate` / `--ease-soft` motion
 *   tokens, and with no token (stylesheet not loaded) there is simply no animation;
 * - no stale "First": positions are refreshed by a ResizeObserver, because a child that grows
 *   between reorders (a ticking timer) shifts everything after it, and a snapshot from the last
 *   reorder would start those items from the wrong place — the jump this hook exists to remove;
 * - no jump when a reorder interrupts one in flight: an item starts from where it is DRAWN (its
 *   layout position plus the translation still applied), not from where it was last laid out.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { prefersReducedMotion } from '@localixai/kit/environment'

/** The attribute that marks a child as one item of the reorderable list. */
export const FLIP_KEY_ATTR = 'data-flip-key'

/** Changes smaller than this are sub-pixel layout noise, not a move. */
const MIN_DELTA_PX = 0.5

function flipChildren(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[${FLIP_KEY_ATTR}]`)]
}

/** The horizontal translation currently drawn on `element` (an in-flight animation's frame). */
export function drawnTranslateX(element: Element): number {
  const transform = getComputedStyle(element).transform
  if (!transform || transform === 'none') return 0
  const match = /^matrix(3d)?\((.+)\)$/.exec(transform.trim())
  if (!match) return 0
  const values = match[2]!.split(',').map((value) => Number.parseFloat(value))
  const x = match[1] ? values[12] : values[4]
  return Number.isFinite(x) ? x! : 0
}

/**
 * Where each child is LAID OUT, in the container's scroll-content coordinates: independent of the
 * scroll position (the strip may scroll to its start in the same moment) and of any transform.
 */
function measureLayout(container: HTMLElement): Map<string, number> {
  const box = container.getBoundingClientRect()
  const positions = new Map<string, number>()
  for (const element of flipChildren(container)) {
    const key = element.getAttribute(FLIP_KEY_ATTR)
    if (key === null) continue
    const left = element.getBoundingClientRect().left - box.left + container.scrollLeft
    positions.set(key, left - drawnTranslateX(element))
  }
  return positions
}

function parseDurationMs(raw: string): number | null {
  const value = raw.trim()
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return value.endsWith('ms') ? amount : value.endsWith('s') ? amount * 1000 : amount
}

/** The reorder's timing from the motion tokens, or `null` when there are none to read. */
export function flipMotion(): { duration: number; easing?: string } | null {
  const tokens = getComputedStyle(document.documentElement)
  const duration = parseDurationMs(tokens.getPropertyValue('--dur-moderate'))
  if (duration === null) return null
  const easing = tokens.getPropertyValue('--ease-soft').trim()
  return easing ? { duration, easing } : { duration }
}

/**
 * Animate the children of `containerRef` marked with `data-flip-key` whenever the order of
 * `keys` changes. `scope` names the list's owner; a new scope starts over without motion.
 */
export function useFlipReorder(
  containerRef: RefObject<HTMLElement | null>,
  keys: readonly string[],
  scope?: string | null,
): void {
  const layout = useRef<{ scope: string | null; positions: Map<string, number> } | null>(null)
  const running = useRef(new Map<string, Animation>())
  const signature = keys.join('\u0000')
  const scopeKey = scope ?? null

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const previous = layout.current?.scope === scopeKey ? layout.current.positions : null
    // Where each item is drawn right now, read BEFORE its old animation is cancelled.
    const drawn = new Map<string, number>()
    for (const element of flipChildren(container)) {
      const key = element.getAttribute(FLIP_KEY_ATTR)
      if (key === null) continue
      drawn.set(key, drawnTranslateX(element))
      running.current.get(key)?.cancel()
      running.current.delete(key)
    }
    const next = measureLayout(container)
    layout.current = { scope: scopeKey, positions: next }
    if (!previous || prefersReducedMotion()) return
    const motion = flipMotion()
    if (!motion) return
    for (const element of flipChildren(container)) {
      const key = element.getAttribute(FLIP_KEY_ATTR)
      if (key === null || typeof element.animate !== 'function') continue
      const from = previous.get(key)
      const to = next.get(key)
      if (from === undefined || to === undefined) continue
      const delta = from + (drawn.get(key) ?? 0) - to
      if (Math.abs(delta) < MIN_DELTA_PX) continue
      const animation = element.animate(
        [{ transform: `translateX(${delta}px)` }, { transform: 'none' }],
        motion,
      )
      running.current.set(key, animation)
      animation.onfinish = () => {
        if (running.current.get(key) === animation) running.current.delete(key)
      }
    }
  }, [containerRef, signature, scopeKey])

  // Keep "First" fresh between reorders: a child that changes size moves the ones after it.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (layout.current?.scope !== scopeKey) return
      layout.current = { scope: scopeKey, positions: measureLayout(container) }
    })
    observer.observe(container)
    for (const element of flipChildren(container)) observer.observe(element)
    return () => observer.disconnect()
  }, [containerRef, signature, scopeKey])

  useLayoutEffect(() => {
    const animations = running.current
    return () => {
      for (const animation of animations.values()) animation.cancel()
      animations.clear()
    }
  }, [])
}
