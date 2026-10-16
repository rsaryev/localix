import { describe, expect, test } from 'bun:test'

import { runIdleTasks, waitForQuietLoop } from './idle-tasks'

/** A fake clock whose sleep advances time by the requested ms plus a scripted lag. */
function fakeClock(lags: number[] = []) {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms + (lags.shift() ?? 0)
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

const never = new AbortController().signal

describe('waitForQuietLoop', () => {
  test('waits for a whole quiet window, restarting it on every laggy tick', async () => {
    // Two quiet ticks, one busy one (the window restarts), then quiet again.
    const clock = fakeClock([0, 0, 40, 0, 0, 0, 0])
    await waitForQuietLoop({
      quietMs: 200,
      quietLagMs: 10,
      maxWaitMs: 10_000,
      signal: never,
      ...clock,
    })
    // 7 ticks of 50 ms plus the 40 ms of lag: the busy tick cost the window its first 100 ms.
    expect(clock.now()).toBe(7 * 50 + 40)
  })

  test('a loop that is never quiet still gets its work, at maxWaitMs', async () => {
    const clock = fakeClock(Array.from({ length: 100 }, () => 30))
    await waitForQuietLoop({
      quietMs: 200,
      quietLagMs: 10,
      maxWaitMs: 1_000,
      signal: never,
      ...clock,
    })
    expect(clock.now()).toBeGreaterThanOrEqual(1_000)
    expect(clock.now()).toBeLessThan(1_100)
  })
})

describe('runIdleTasks', () => {
  const quick = { delayMs: 0, quietMs: 0, maxWaitMs: 0 }

  test('runs every task in order, one at a time, and reports each', async () => {
    const order: string[] = []
    const done: string[] = []
    let running = 0
    const task = (name: string) => ({
      name,
      run: async () => {
        running += 1
        expect(running).toBe(1)
        order.push(name)
        await Bun.sleep(1)
        running -= 1
      },
    })
    await runIdleTasks([task('a'), task('b'), task('c')], {
      ...quick,
      signal: never,
      onTaskDone: (name) => done.push(name),
    })
    expect(order).toEqual(['a', 'b', 'c'])
    expect(done).toEqual(['a', 'b', 'c'])
  })

  test('a failing task is reported and does not stop the ones after it', async () => {
    const done: [string, unknown][] = []
    await runIdleTasks(
      [
        { name: 'bad', run: () => Promise.reject(new Error('boom')) },
        { name: 'good', run: () => undefined },
      ],
      { ...quick, signal: never, onTaskDone: (name, _ms, error) => done.push([name, error]) },
    )
    expect(done.map(([name]) => name)).toEqual(['bad', 'good'])
    expect(String(done[0]![1])).toContain('boom')
    expect(done[1]![1]).toBeUndefined()
  })

  // Shutdown aborts the post-listen signal first; a host started after that would outlive
  // its own stop.
  test('an abort stops the scheduler before its next task', async () => {
    const controller = new AbortController()
    const ran: string[] = []
    await runIdleTasks(
      [
        {
          name: 'first',
          run: () => {
            ran.push('first')
            controller.abort()
          },
        },
        { name: 'second', run: () => void ran.push('second') },
      ],
      { ...quick, signal: controller.signal, onTaskDone: () => {} },
    )
    expect(ran).toEqual(['first'])
  })

  test('an abort during the wait runs nothing', async () => {
    const controller = new AbortController()
    controller.abort()
    let ran = false
    await runIdleTasks([{ name: 'x', run: () => void (ran = true) }], {
      ...quick,
      signal: controller.signal,
      onTaskDone: () => {},
    })
    expect(ran).toBe(false)
  })

  test('ctx.yield hands the loop back only once the slice budget is spent', async () => {
    const clock = fakeClock()
    const yielded: boolean[] = []
    await runIdleTasks(
      [
        {
          name: 'chunked',
          run: async (ctx) => {
            for (const cost of [4, 4, 6, 3]) {
              clock.advance(cost)
              let turned = false
              setImmediate(() => (turned = true))
              await ctx.yield()
              yielded.push(turned)
            }
          },
        },
      ],
      {
        ...quick,
        sliceMs: 12,
        now: clock.now,
        sleep: clock.sleep,
        signal: never,
        onTaskDone: () => {},
      },
    )
    // 4 → 8 → 14 (past 12: yield, budget restarts) → 3.
    expect(yielded).toEqual([false, false, true, false])
  })

  // The real loop, end to end: a chunked task that yields lets timers run between its chunks,
  // where the same work in one piece (the control) holds them for its whole length. Timer turns are
  // counted rather than gaps measured: a loaded CI runner can pause the process for tens of
  // milliseconds, which stretches any gap but cannot run a timer inside synchronous work.
  test('a chunked task keeps the event loop responsive; the unchunked control does not', async () => {
    const busy = (ms: number) => {
      const end = performance.now() + ms
      while (performance.now() < end) {
        /* synchronous work, like a bun:sqlite statement */
      }
    }
    const timerTurnsWhile = async (work: () => Promise<void>) => {
      let turns = 0
      const timer = setInterval(() => (turns += 1), 1)
      await work()
      clearInterval(timer)
      return turns
    }
    const chunked = await timerTurnsWhile(() =>
      runIdleTasks(
        [
          {
            name: 'chunked',
            run: async (ctx) => {
              for (let i = 0; i < 20; i += 1) {
                busy(4)
                await ctx.yield()
              }
            },
          },
        ],
        { ...quick, sliceMs: 8, signal: never, onTaskDone: () => {} },
      ),
    )
    const whole = await timerTurnsWhile(async () => {
      busy(80)
    })
    // About ten yields at an 8ms slice of 4ms chunks; each one lets the due timer run.
    expect(chunked).toBeGreaterThanOrEqual(5)
    expect(whole).toBe(0)
  })
})
