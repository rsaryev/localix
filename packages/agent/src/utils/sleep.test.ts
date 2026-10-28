import { expect, jest, test } from 'bun:test'

import { sleep as delay } from './backoff'

test('waits for the delay, and ends early without throwing when the signal aborts', async () => {
  jest.useFakeTimers()
  let waited = false
  const waiting = delay(20).then(() => {
    waited = true
  })
  jest.advanceTimersByTime(19)
  await Promise.resolve()
  expect(waited).toBe(false)
  jest.advanceTimersByTime(1)
  await waiting
  expect(waited).toBe(true)
  jest.useRealTimers()

  const controller = new AbortController()
  const pending = delay(60_000, controller.signal)
  controller.abort()
  await pending

  controller.abort()
  await delay(60_000, controller.signal)
})
