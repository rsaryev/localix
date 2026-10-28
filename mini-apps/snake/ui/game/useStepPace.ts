import { useEffect, useState, useSyncExternalStore } from 'react'

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

interface Seen {
  tick: number
  at: number
  pace: number | null
}

/**
 * The pace the steps arrive at, kept outside React: a view of it subscribes (`useStepPace`) and the
 * clock is read where a step is OBSERVED — in an effect — never while rendering.
 */
export function createPaceTracker() {
  let seen: Seen | null = null
  let value = MIN_STEP_GLIDE_MS
  const listeners = new Set<() => void>()
  const publish = (next: number) => {
    if (next === value) return
    value = next
    for (const listener of listeners) listener()
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => value,
    /** The run stopped: the next step is a first step again. */
    reset: () => {
      seen = null
      publish(MIN_STEP_GLIDE_MS)
    },
    /** The view showed tick `tick` at `now`. */
    observe: (tick: number, now: number) => {
      if (!seen) seen = { tick, at: now, pace: null }
      else if (seen.tick !== tick) {
        const gap = now - seen.at
        // A long pause (Stop, a slow answer) is not the pace; it would make the next steps crawl.
        const pace = gap > MAX_STEP_GLIDE_MS * 2 ? seen.pace : nextPace(seen.pace, gap)
        seen = { tick, at: now, pace }
      }
      publish(Math.round(seen.pace ?? MIN_STEP_GLIDE_MS))
    },
  }
}

/** The glide for the model's current step, given the tick it is on. */
export function useStepPace(tick: number, active: boolean): number {
  const [tracker] = useState(createPaceTracker)
  const pace = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot)
  useEffect(() => {
    if (active) tracker.observe(tick, performance.now())
    else tracker.reset()
  }, [tracker, tick, active])
  return active ? pace : MIN_STEP_GLIDE_MS
}
