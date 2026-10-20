import { useRef } from 'react'

/**
 * HOW LONG EACH OF THE MODEL'S STEPS SHOULD GLIDE — so its snake moves steadily, not in bursts.
 *
 * The model's steps reach the view whenever its decisions come back: a few hundred milliseconds
 * apart, unevenly. Gliding each over a short fixed time made the snake dart and then stand still
 * until the next answer. Instead each step glides over the time steps have been TAKING to arrive —
 * a running average of the last gaps, clamped — so a step usually ends just as the next one lands
 * and the motion reads as one continuous crawl. The first step of a run glides over the floor.
 */

/** The shortest and longest glide of one model step. */
export const MIN_STEP_GLIDE_MS = 120
export const MAX_STEP_GLIDE_MS = 900
/** How much a new gap moves the average (an exponential moving average). */
const WEIGHT = 0.35

/** The next average after a gap of `gapMs`, clamped to the glide bounds. */
export function nextPace(average: number | null, gapMs: number): number {
  const clamped = Math.min(MAX_STEP_GLIDE_MS, Math.max(MIN_STEP_GLIDE_MS, gapMs))
  return average === null ? clamped : average + (clamped - average) * WEIGHT
}

/** The glide for the model's current step, given the tick it is on. */
export function useStepPace(tick: number, active: boolean): number {
  const state = useRef<{ tick: number; at: number; pace: number | null } | null>(null)
  if (!active) {
    state.current = null
    return MIN_STEP_GLIDE_MS
  }
  const now = performance.now()
  if (!state.current) state.current = { tick, at: now, pace: null }
  else if (state.current.tick !== tick) {
    const gap = now - state.current.at
    // A long pause (Stop, a slow answer) is not the pace; it would make the next steps crawl.
    const pace =
      gap > MAX_STEP_GLIDE_MS * 2 ? state.current.pace : nextPace(state.current.pace, gap)
    state.current = { tick, at: now, pace }
  }
  return Math.round(state.current.pace ?? MIN_STEP_GLIDE_MS)
}
