import { describe, expect, mock, test } from 'bun:test'
import { startStartupRetry, startupRetryDelay } from './startupRetry'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a startup retry loop (the settings sync on a fresh sidecar)', () => {
  test('retries a sidecar startup race until the profile read succeeds', async () => {
    const results = [false, false, true]
    const load = mock(async () => results.shift() ?? true)
    const queued: Array<{ run: () => void; delay: number }> = []
    const schedule = (run: () => void, delay: number) => {
      queued.push({ run, delay })
      return queued.length as never
    }

    const stop = startStartupRetry(load, schedule)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    expect(queued[0]?.delay).toBe(100)

    queued.shift()!.run()
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(queued[0]?.delay).toBe(200)

    queued.shift()!.run()
    await flush()
    expect(load).toHaveBeenCalledTimes(3)
    expect(queued).toHaveLength(0)
    stop()
  })

  test('backs off to a bounded polling cadence instead of stopping forever', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map(startupRetryDelay)).toStrictEqual([
      100, 200, 400, 800, 1_000, 2_000, 5_000, 10_000, 10_000,
    ])
  })

  test('keeps at most one retry queued while the backend remains unavailable', async () => {
    let failures = 0
    const load = mock(async () => {
      failures += 1
      return failures > 10
    })
    const queued: Array<{ run: () => void; delay: number }> = []
    const schedule = (run: () => void, delay: number) => {
      queued.push({ run, delay })
      return failures as never
    }

    const stop = startStartupRetry(load, schedule)
    await flush()

    const observedDelays: number[] = []
    while (queued.length) {
      // A failed attempt schedules exactly one successor. There is never a fan-out
      // of concurrent probes that can hammer a backend which is still booting.
      expect(queued).toHaveLength(1)
      const next = queued.shift()!
      observedDelays.push(next.delay)
      next.run()
      await flush()
    }

    expect(load).toHaveBeenCalledTimes(11)
    expect(observedDelays).toStrictEqual([
      100, 200, 400, 800, 1_000, 2_000, 5_000, 10_000, 10_000, 10_000,
    ])
    stop()
  })

  test('cleanup cancels a queued retry', async () => {
    let queued: (() => void) | null = null
    let timer = 0
    const cancelled: number[] = []
    const stop = startStartupRetry(
      async () => false,
      (run) => {
        queued = run
        return ++timer as never
      },
      (id) => cancelled.push(id as unknown as number),
    )
    await flush()
    expect(queued).not.toBeNull()
    stop()
    expect(cancelled).toStrictEqual([1])
  })

  test('a rejected loader cannot terminate the shared retry loop', async () => {
    let attempt = 0
    const queued: Array<() => void> = []
    const load = mock(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('connection refused')
      return true
    })
    const stop = startStartupRetry(load, (run) => {
      queued.push(run)
      return queued.length as never
    })

    await flush()
    expect(queued).toHaveLength(1)
    queued.shift()!()
    await flush()
    expect(load).toHaveBeenCalledTimes(2)
    expect(queued).toHaveLength(0)
    stop()
  })
})
