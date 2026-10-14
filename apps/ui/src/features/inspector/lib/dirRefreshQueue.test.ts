import { describe, expect, test } from 'bun:test'

import { createDirRefreshQueue } from './dirRefreshQueue'

/** A manual clock so the coalesce window is exercised without real waiting. */
function fakeTimers() {
  let seq = 0
  const scheduled = new Map<number, () => void>()
  return {
    setTimer: (fn: () => void) => {
      const id = ++seq
      scheduled.set(id, fn)
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (h: ReturnType<typeof setTimeout>) => {
      scheduled.delete(h as unknown as number)
    },
    /** Fire every timer currently scheduled. */
    flush() {
      const due = [...scheduled.entries()]
      scheduled.clear()
      for (const [, fn] of due) fn()
    },
    get scheduledCount() {
      return scheduled.size
    },
  }
}

/** A runner that records concurrency and hands back per-call resolvers. */
function tracker() {
  const started: string[] = []
  const resolvers: (() => void)[] = []
  let active = 0
  let peak = 0
  return {
    started,
    get peak() {
      return peak
    },
    get active() {
      return active
    },
    run(dir: string) {
      started.push(dir)
      active++
      peak = Math.max(peak, active)
      return new Promise<void>((resolve) => {
        resolvers.push(() => {
          active--
          resolve()
        })
      })
    },
    /** Settle the oldest `n` in-flight runs. */
    async settle(n = resolvers.length) {
      for (const done of resolvers.splice(0, n)) done()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

const dirs = (n: number) => Array.from({ length: n }, (_, i) => `/w/dir-${i}`)

describe('createDirRefreshQueue', () => {
  test('caps how many directory reads run at once', async () => {
    const timers = fakeTimers()
    const t = tracker()
    const q = createDirRefreshQueue(t.run.bind(t), { ...timers, concurrency: 6 })

    // A coarse frame over a deeply expanded tree.
    q.request(dirs(50))
    timers.flush()

    expect(t.started.length).toBe(6)
    expect(t.peak).toBe(6)

    // As each read settles the next one starts — the work still completes, it just
    // never stampedes.
    await t.settle(6)
    expect(t.started.length).toBe(12)
    expect(t.peak).toBe(6)
  })

  test('coalesces a burst of frames into one pass', async () => {
    const timers = fakeTimers()
    const t = tracker()
    const q = createDirRefreshQueue(t.run.bind(t), { ...timers, concurrency: 100 })

    q.request(['/w/a', '/w/b'])
    q.request(['/w/b', '/w/c'])
    q.request(['/w/a'])
    // Three frames, ONE scheduled flush.
    expect(timers.scheduledCount).toBe(1)
    timers.flush()

    // Deduped: /w/a and /w/b were each requested twice.
    expect([...t.started].sort()).toEqual(['/w/a', '/w/b', '/w/c'])
  })

  test('directories requested mid-pass join the next pass, deduped', async () => {
    const timers = fakeTimers()
    const t = tracker()
    const q = createDirRefreshQueue(t.run.bind(t), { ...timers, concurrency: 1 })

    q.request(['/w/a', '/w/b'])
    timers.flush()
    expect(t.started).toEqual(['/w/a'])

    // /w/b is still queued; asking for it again must not double-read it.
    q.request(['/w/b', '/w/c'])
    timers.flush()
    await t.settle(1)

    expect(t.started).toEqual(['/w/a', '/w/b'])
    await t.settle(1)
    expect(t.started).toEqual(['/w/a', '/w/b', '/w/c'])
  })

  test('a failing read does not wedge the queue', async () => {
    const timers = fakeTimers()
    const started: string[] = []
    const q = createDirRefreshQueue(
      (dir) => {
        started.push(dir)
        return Promise.reject(new Error('boom'))
      },
      { ...timers, concurrency: 1 },
    )

    q.request(['/w/a', '/w/b'])
    timers.flush()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(started).toEqual(['/w/a', '/w/b'])
  })

  test('reset drops what has not started yet', async () => {
    const timers = fakeTimers()
    const t = tracker()
    const q = createDirRefreshQueue(t.run.bind(t), { ...timers, concurrency: 1 })

    q.request(['/w/a', '/w/b', '/w/c'])
    timers.flush()
    expect(t.started).toEqual(['/w/a'])

    q.reset()
    await t.settle(1)
    expect(t.started).toEqual(['/w/a'])
  })
})
