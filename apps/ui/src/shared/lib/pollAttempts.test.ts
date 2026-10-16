import { describe, expect, test } from 'bun:test'

import { pollAttempts } from './pollAttempts'

describe('pollAttempts', () => {
  test('runs the first tick immediately and stops when a tick finishes', async () => {
    const seen: number[] = []
    const done = await pollAttempts(5, 1, async (attempt) => {
      seen.push(attempt)
      return attempt === 2
    })
    expect(done).toBe(true)
    expect(seen).toEqual([0, 1, 2])
  })

  test('returns false after exhausting attempts, waiting after the last one', async () => {
    let ticks = 0
    const started = performance.now()
    const done = await pollAttempts(3, 10, async () => {
      ticks += 1
      return false
    })
    expect(done).toBe(false)
    expect(ticks).toBe(3)
    expect(performance.now() - started).toBeGreaterThanOrEqual(25)
  })

  test('propagates tick errors without retrying', async () => {
    let ticks = 0
    const run = pollAttempts(3, 1, async () => {
      ticks += 1
      throw new Error('boom')
    })
    await expect(run).rejects.toThrow('boom')
    expect(ticks).toBe(1)
  })
})
