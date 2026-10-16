import { expect, test } from 'bun:test'

import {
  shouldSurfaceStartupFailure,
  startStartupRetry,
  type StartupRetrySchedule,
} from './startupRetry'

test('startup feedback stays loading through the dense retry window', () => {
  expect(shouldSurfaceStartupFailure(0)).toBe(false)
  expect(shouldSurfaceStartupFailure(2)).toBe(false)
  expect(shouldSurfaceStartupFailure(3)).toBe(true)
})

test('retry loaders receive the current failure index', async () => {
  const attempts: number[] = []
  const scheduled: Array<() => void> = []
  const schedule: StartupRetrySchedule = (run) => {
    scheduled.push(run)
    return 1 as unknown as ReturnType<typeof setTimeout>
  }

  startStartupRetry(async (failureIndex) => {
    attempts.push(failureIndex)
    return failureIndex === 2
  }, schedule)

  await Promise.resolve()
  scheduled.shift()?.()
  await Promise.resolve()
  scheduled.shift()?.()
  await Promise.resolve()

  expect(attempts).toEqual([0, 1, 2])
})
