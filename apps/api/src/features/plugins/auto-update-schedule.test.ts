import { describe, expect, test } from 'bun:test'

import {
  AUTO_UPDATE_INTERVAL_MS,
  armPluginAutoUpdate,
  firstPassDelayMs,
} from './auto-update-schedule'

function fakeTimers() {
  const timeouts: Array<{ ms: number; run: () => void; cleared: boolean }> = []
  const intervals: Array<{ ms: number; run: () => void; cleared: boolean }> = []
  return {
    timeouts,
    intervals,
    timers: {
      setTimeout: (run: () => void, ms: number) => {
        const timer = { ms, run, cleared: false }
        timeouts.push(timer)
        return timer
      },
      setInterval: (run: () => void, ms: number) => {
        const timer = { ms, run, cleared: false }
        intervals.push(timer)
        return timer
      },
      clear: (timer: unknown) => {
        ;(timer as { cleared: boolean }).cleared = true
      },
    },
  }
}

describe('when the plugin auto-update pass runs', () => {
  test('first a random delay of one to ten minutes after start', () => {
    expect(firstPassDelayMs(() => 0)).toBe(60_000)
    expect(firstPassDelayMs(() => 0.999999)).toBeLessThanOrEqual(10 * 60_000)
  })

  test('then every six hours, until stopped', () => {
    const fake = fakeTimers()
    let runs = 0
    const stop = armPluginAutoUpdate({
      run: async () => {
        runs++
      },
      random: () => 0.5,
      timers: fake.timers,
    })
    expect(fake.timeouts.map((timer) => timer.ms)).toEqual([firstPassDelayMs(() => 0.5)])
    fake.timeouts[0]!.run()
    expect(runs).toBe(1)
    expect(fake.intervals.map((timer) => timer.ms)).toEqual([AUTO_UPDATE_INTERVAL_MS])
    fake.intervals[0]!.run()
    expect(runs).toBe(2)
    stop()
    expect(fake.intervals[0]!.cleared).toBe(true)
  })

  test('a stop before the first pass means it never runs', () => {
    const fake = fakeTimers()
    const stop = armPluginAutoUpdate({ run: async () => {}, timers: fake.timers })
    stop()
    expect(fake.timeouts[0]!.cleared).toBe(true)
    expect(fake.intervals).toEqual([])
  })
})
