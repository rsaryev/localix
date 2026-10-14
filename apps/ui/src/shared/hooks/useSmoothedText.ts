import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '@localixai/kit/environment'

/**
 * Smoothly reveal a bursty streaming string. Source text arrives in irregular
 * chunks — network framing, the markdown re-parse throttle, a cache-hit dumping
 * the whole reply at once — so rendering the raw target jumps many words (and
 * line wraps) per frame. This hook catches the displayed prefix up to the
 * target at a paced rate (backlog drained over ~catchUpMs, at least one char per
 * frame), turning bursts into a steady typewriter flow that never runs ahead of
 * the model.
 *
 * Self-stopping: the rAF loop only runs while there is backlog to drain. Once
 * the displayed prefix catches up (or the target is empty/undefined — e.g. a
 * settled card or a non-streaming message) the loop cancels itself, so idle
 * callers cost nothing. It restarts when the target grows again.
 */
const DEFAULT_CATCH_UP_MS = 220
// Markdown parsing is capped at the same cadence. Updating this hook at display
// refresh rate would schedule React renders whose text cannot become visible.
export const SMOOTHED_TEXT_FRAME_MS = 40

export function shouldAdvanceRevealFrame(elapsedMs: number): boolean {
  return elapsedMs >= SMOOTHED_TEXT_FRAME_MS
}

/**
 * Reconcile a revealed-prefix length when the target changes: if the target
 * shrank below what we've already shown (e.g. multi-edit switching to a new,
 * shorter new_string), snap down to the new length so we never flash a tail
 * beyond the current target. Pure — exported for tests.
 */
export function reconcileReveal(displayed: number, total: number): number {
  return displayed > total ? total : displayed
}

/**
 * Seed the revealed-prefix length when a target (re)appears: entering streaming
 * with pre-existing content — a settled message flipping live, or a remount
 * mid-stream — must show that content immediately and animate only growth
 * beyond the stream-start prefix. Replaying the whole body from 0 is exactly
 * the "old message starts streaming again" glitch. Pure — exported for tests.
 */
export function seedOnStreamStart(displayed: number, total: number, entering: boolean): number {
  return entering && displayed < total ? total : displayed
}

/** The visible prefix; reduced motion always exposes the complete current text. */
export function revealLengthForMotion(
  displayed: number,
  total: number,
  reducedMotion: boolean,
): number {
  return reducedMotion ? total : Math.min(displayed, total)
}

/**
 * Advance a revealed-prefix length one rAF frame toward `total`, draining the
 * backlog over ~catchUpMs and at least one char per frame so it always makes
 * progress. Clamps at `total`. Pure — exported for tests.
 */
export function advanceReveal(
  displayed: number,
  total: number,
  dtMs: number,
  catchUpMs = DEFAULT_CATCH_UP_MS,
): number {
  if (displayed >= total) return Math.min(displayed, total)
  const backlog = total - displayed
  const step = Math.max(1, Math.round(backlog * Math.min(1, Math.max(1, dtMs) / catchUpMs)))
  return Math.min(total, displayed + step)
}

export function useSmoothedText(
  target: string | undefined,
  catchUpMs = DEFAULT_CATCH_UP_MS,
): string {
  const text = target ?? ''
  const active = target !== undefined
  const reducedMotion = useReducedMotion()
  const [displayedLen, setDisplayedLen] = useState(0)
  const displayedRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastAdvanceAtRef = useRef(0)
  const targetLengthRef = useRef(0)
  // Tracks defined-ness of `target` across effect runs so the effect can tell
  // "entering streaming" (undefined → defined, incl. first mount) apart from
  // ordinary growth of an already-live target.
  const wasActiveRef = useRef(false)

  useEffect(() => {
    const total = text.length
    if (reducedMotion) {
      wasActiveRef.current = active
      targetLengthRef.current = total
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (displayedRef.current !== total) {
        displayedRef.current = total
        setDisplayedLen(total)
      }
      return
    }

    const entering = active && !wasActiveRef.current
    wasActiveRef.current = active
    const wasCaughtUp = displayedRef.current >= targetLengthRef.current
    targetLengthRef.current = total
    // A fresh burst starts a fresh pacing window. While backlog remains, keep the
    // previous commit clock across target updates so a 20Hz stream cannot starve it.
    const now = performance.now()
    if (entering || (wasCaughtUp && now - lastAdvanceAtRef.current > catchUpMs)) {
      lastAdvanceAtRef.current = now
    }
    const seeded = seedOnStreamStart(displayedRef.current, total, entering)
    if (seeded !== displayedRef.current) {
      displayedRef.current = seeded
      setDisplayedLen(seeded)
    }
    // Snap down first if the target shrank, then resume smoothing as it grows.
    const reconciled = reconcileReveal(displayedRef.current, total)
    if (reconciled !== displayedRef.current) {
      displayedRef.current = reconciled
      setDisplayedLen(reconciled)
    }
    // Already caught up, or a loop is already draining the backlog — nothing to start.
    if (displayedRef.current >= total || rafRef.current !== null) return

    const tick = (now: number) => {
      const len = displayedRef.current
      if (len >= total) {
        rafRef.current = null // caught up — stop the loop until the target grows
        return
      }
      const elapsed = now - lastAdvanceAtRef.current
      if (!shouldAdvanceRevealFrame(elapsed)) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      lastAdvanceAtRef.current = now
      const dt = Math.max(1, elapsed)
      const next = advanceReveal(len, total, dt, catchUpMs)
      displayedRef.current = next
      setDisplayedLen(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    // The effect re-runs whenever `text` (or defined-ness) changes, so the tick
    // closure always sees the current target — no need for a ref written during
    // render. `active` is a dep so an undefined→'' flip still registers as
    // entering streaming even though `text` is unchanged.
  }, [text, active, catchUpMs, reducedMotion])

  return text.slice(0, revealLengthForMotion(displayedLen, text.length, reducedMotion))
}
