import { expect, test } from 'bun:test'

import { createPaceTracker, MAX_STEP_GLIDE_MS, MIN_STEP_GLIDE_MS, nextPace } from './useStepPace'

test('a step glides over the time steps have been taking to arrive, within bounds', () => {
  expect(nextPace(null, 400)).toBe(400)
  expect(nextPace(400, 600)).toBe(470)
  expect(nextPace(null, 10)).toBe(MIN_STEP_GLIDE_MS)
  expect(nextPace(null, 5000)).toBe(MAX_STEP_GLIDE_MS)
})

test('the pace follows the gaps between steps, and a long pause or a stop does not count', () => {
  const tracker = createPaceTracker()
  tracker.observe(0, 1000)
  expect(tracker.getSnapshot()).toBe(MIN_STEP_GLIDE_MS)
  tracker.observe(1, 1400)
  expect(tracker.getSnapshot()).toBe(400)
  // The same tick again is not a step.
  tracker.observe(1, 1500)
  expect(tracker.getSnapshot()).toBe(400)
  tracker.observe(2, 2000)
  expect(tracker.getSnapshot()).toBe(470)
  // A pause far longer than any glide leaves the pace as it was.
  tracker.observe(3, 2000 + MAX_STEP_GLIDE_MS * 3)
  expect(tracker.getSnapshot()).toBe(470)
  tracker.reset()
  expect(tracker.getSnapshot()).toBe(MIN_STEP_GLIDE_MS)
})

test('a view hears each change of pace once', () => {
  const tracker = createPaceTracker()
  let heard = 0
  const stop = tracker.subscribe(() => heard++)
  tracker.observe(0, 0)
  tracker.observe(1, 400)
  tracker.observe(1, 450)
  expect(heard).toBe(1)
  stop()
  tracker.observe(2, 900)
  expect(heard).toBe(1)
})
