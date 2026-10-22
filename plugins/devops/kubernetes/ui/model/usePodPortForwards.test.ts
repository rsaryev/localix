import { expect, test } from 'bun:test'

import { portForwardPollNeeded } from './usePodPortForwards'

test('a pod tab with no forward does not re-read the empty list every five seconds', () => {
  expect(portForwardPollNeeded(true, 0, false)).toBe(false)
})

test('while the change stream is live, a forward that could die is not polled', () => {
  expect(portForwardPollNeeded(true, 1, true)).toBe(false)
})

test('with the stream down, a forward that could die keeps the poll, only while active', () => {
  expect(portForwardPollNeeded(true, 1, false)).toBe(true)
  expect(portForwardPollNeeded(false, 2, false)).toBe(false)
})
