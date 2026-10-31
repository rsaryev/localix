import { describe, expect, test } from 'bun:test'
import { retryUntilDone } from './retry-until-done'

/** A timer that only records: each test fires the scheduled retries itself. */
function manualTimer() {
  const pending: Array<{ fn: () => void; ms: number }> = []
  return {
    delays: () => pending.map((entry) => entry.ms),
    schedule: (fn: () => void, ms: number) => void pending.push({ fn, ms }),
    fireNext: () => pending.shift()?.fn(),
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('retryUntilDone', () => {
  test('retries a pass that is not done, five minutes first, then twice as long each time', async () => {
    const outcomes: Array<'done' | 'retry'> = ['retry', 'retry', 'done']
    const timer = manualTimer()
    let runs = 0
    const start = retryUntilDone({
      run: async () => outcomes[runs++]!,
      onError: () => {},
      signal: new AbortController().signal,
      schedule: timer.schedule,
    })
    await start()
    timer.fireNext()
    await settle()
    timer.fireNext()
    await settle()
    expect(runs).toBe(3)
    expect(timer.delays()).toEqual([])
  })

  test('reports a failure and retries it, at most every six hours', async () => {
    const timer = manualTimer()
    const errors: unknown[] = []
    const start = retryUntilDone({
      run: async () => {
        throw new Error('offline')
      },
      onError: (error) => errors.push(error),
      signal: new AbortController().signal,
      schedule: timer.schedule,
    })
    await start()
    const delays = [timer.delays()[0]]
    for (let i = 0; i < 8; i++) {
      timer.fireNext()
      await settle()
      delays.push(timer.delays()[0])
    }
    expect(errors).toHaveLength(9)
    expect(delays.slice(0, 3)).toEqual([5 * 60_000, 10 * 60_000, 20 * 60_000])
    expect(delays.at(-1)).toBe(6 * 60 * 60 * 1000)
  })

  test('stops once the signal is aborted', async () => {
    const timer = manualTimer()
    const controller = new AbortController()
    const start = retryUntilDone({
      run: async () => 'retry',
      onError: () => {},
      signal: controller.signal,
      schedule: timer.schedule,
    })
    controller.abort()
    await start()
    expect(timer.delays()).toEqual([])
  })
})
