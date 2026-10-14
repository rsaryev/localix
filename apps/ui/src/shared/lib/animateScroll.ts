import { prefersReducedMotion } from '@localixai/kit/environment'

/**
 * One scroll animation for the whole app, with a duration that depends on how far it goes.
 *
 * `scrollTo({ behavior: 'smooth' })` gives the browser's duration, which is the same whether
 * the target is one row away or ten screens away: a short hop feels sluggish and a long jump
 * feels like a lurch. Shape taken from telegram-tt's `animateScroll`
 * (`~/references/ui-patterns/telegram-tt-evidence.md`), with our own motion scale.
 *
 * A scroll handler that reads these writes back as a person's gesture will fight itself. The
 * transcript already answers that with its own position+time window, so this module does not
 * export a second way to ask; a future consumer that needs one should read `active` rather
 * than grow another guard beside the first.
 */

/** Our motion scale's two ends (`--dur-base`, `--dur-slow`). A scroll is never faster or slower. */
const MIN_DURATION_MS = 200
const MAX_DURATION_MS = 500

/**
 * The distance at which the duration reaches its maximum, and — the important part — the
 * furthest we ever ANIMATE.
 *
 * A jump from the top of a long transcript to the bottom does not travel: the scroll is
 * teleported to within this distance of the target and only the last stretch is animated. The
 * alternative flickers through thousands of rows to show motion nobody can read, and costs a
 * paint for every one of them. The reader loses nothing — the intermediate content was never
 * legible at that speed — and gains an arrival that looks the same from anywhere.
 */
const MAX_ANIMATED_DISTANCE = 1200

/** Under this, the two curves swap: a hop and a jump are not the same motion. */
const SHORT_DISTANCE = 300

/** Below a pixel there is nothing to animate, and a zero-length animation still costs a frame. */
const NO_OP_DISTANCE = 1

/** A hop settles gently; a jump decelerates harder, or it still reads as travelling at the end. */
const shortCurve = (t: number) => 1 - (1 - t) ** 3
const longCurve = (t: number) => 1 - (1 - t) ** 5

interface ActiveScroll {
  container: HTMLElement
  cancel: () => void
}

/**
 * One slot, app-wide. Two loops writing `scrollTop` on the same container fight; two on
 * different containers are legal but the older one still has to be cleaned up, because its
 * frame callback is cancelled and will never run its own teardown.
 */
let active: ActiveScroll | null = null

function release(container: HTMLElement): void {
  // Snap fights an animated scroll: each frame's write gets pulled to the nearest snap point,
  // so the motion stutters and can land somewhere the caller never asked for.
  container.style.scrollSnapType = ''
}

function takeOver(container: HTMLElement): void {
  if (active && active.container !== container) release(active.container)
  active?.cancel()
  container.style.scrollSnapType = 'none'
}

export interface AnimateScrollArgs {
  container: HTMLElement
  /** Where the container's `scrollTop` should end up. Clamped to what actually exists. */
  top: number
  /** Skip the motion: a restore is not a navigation and should not be watched. */
  instant?: boolean
}

/**
 * The distance actually animated, given where we are and where we are going.
 *
 * Two clamps, and both matter. The path is cut to the scrollable space that REMAINS, so an
 * over-shooting target does not buy time animating past an end `scrollTop` cannot reach — that
 * is an animation that appears to freeze before it finishes. And the start is pulled to within
 * {@link MAX_ANIMATED_DISTANCE}, which is the teleport described there.
 */
export function planScroll(
  from: number,
  to: number,
  viewport: number,
  scrollHeight: number,
): { from: number; to: number; distance: number } {
  const target = Math.max(0, Math.min(to, Math.max(0, scrollHeight - viewport)))
  const offset = target - from
  const start =
    offset > MAX_ANIMATED_DISTANCE
      ? target - MAX_ANIMATED_DISTANCE
      : offset < -MAX_ANIMATED_DISTANCE
        ? target + MAX_ANIMATED_DISTANCE
        : from
  return { from: start, to: target, distance: Math.abs(target - start) }
}

/** Interpolated across the animated distance, so arrival speed is roughly constant. */
export function scrollDuration(distance: number): number {
  const span = Math.min(distance / MAX_ANIMATED_DISTANCE, 1)
  return MIN_DURATION_MS + span * (MAX_DURATION_MS - MIN_DURATION_MS)
}

export function animateScroll({ container, top, instant }: AnimateScrollArgs): void {
  // Every read happens here, once, before anything is written: interleaving them would make
  // each frame's write invalidate the next frame's measurement.
  const { scrollTop, clientHeight, scrollHeight } = container
  const plan = planScroll(scrollTop, top, clientHeight, scrollHeight)

  if (instant || prefersReducedMotion() || plan.distance < NO_OP_DISTANCE) {
    if (active?.container === container) active.cancel()
    container.scrollTop = plan.to
    return
  }

  takeOver(container)
  container.scrollTop = plan.from

  const curve = plan.distance <= SHORT_DISTANCE ? shortCurve : longCurve
  const duration = scrollDuration(plan.distance)
  const startedAt = performance.now()
  const travel = plan.to - plan.from
  let frame = 0

  // The hand wins. An animation that keeps writing `scrollTop` while someone is scrolling
  // drags them back every frame, which reads as the page being broken rather than as motion.
  // `wheel` and `touchstart` are the gestures that arrive BEFORE the scroll they cause, so
  // they can be caught; a scroll event cannot, being indistinguishable from our own writes.
  const settle = () => {
    cancelAnimationFrame(frame)
    container.removeEventListener('wheel', yieldToUser)
    container.removeEventListener('touchstart', yieldToUser)
    if (active?.container === container) {
      release(container)
      active = null
    }
  }
  const yieldToUser = () => settle()
  container.addEventListener('wheel', yieldToUser, { passive: true })
  container.addEventListener('touchstart', yieldToUser, { passive: true })
  active = { container, cancel: settle }

  const step = (now: number) => {
    if (active?.container !== container) return
    const t = Math.min((now - startedAt) / duration, 1)
    container.scrollTop = Math.round(plan.from + travel * curve(t))
    if (t < 1) {
      frame = requestAnimationFrame(step)
      return
    }
    settle()
  }
  frame = requestAnimationFrame(step)
}
