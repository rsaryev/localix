import { expect, test } from 'bun:test'

import { portForwardPollNeeded } from './usePodPortForwards'

test('a pod tab with no forward does not re-read the empty list every five seconds', () => {
  expect(portForwardPollNeeded(true, 0)).toBe(false)
})

test('a forward that could die keeps the poll, only while the tab is active', () => {
  expect(portForwardPollNeeded(true, 1)).toBe(true)
  expect(portForwardPollNeeded(false, 2)).toBe(false)
})
