import { expect, test } from 'bun:test'

import { MAX_STEP_GLIDE_MS, MIN_STEP_GLIDE_MS, nextPace } from './useStepPace'

test('a step glides over the time steps have been taking to arrive, within bounds', () => {
  expect(nextPace(null, 400)).toBe(400)
  expect(nextPace(400, 600)).toBe(470)
  expect(nextPace(null, 10)).toBe(MIN_STEP_GLIDE_MS)
  expect(nextPace(null, 5000)).toBe(MAX_STEP_GLIDE_MS)
})
