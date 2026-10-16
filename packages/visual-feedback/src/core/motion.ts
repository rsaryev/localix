export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Read the preview document's current OS motion preference at actuation time. */
export function prefersReducedMotion(): boolean {
  return globalThis.window?.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false
}

/**
 * Explicit JavaScript scroll behavior is not affected by a page's reduced-motion
 * CSS, so injected probe gestures must resolve it in the preview document too.
 */
export function motionSafeScrollBehavior(
  behavior: ScrollBehavior,
  reducedMotion = prefersReducedMotion(),
): ScrollBehavior {
  return reducedMotion && behavior === 'smooth' ? 'auto' : behavior
}
