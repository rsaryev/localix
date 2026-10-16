import { describe, expect, test } from 'bun:test'
import { createPartitionedEventLoop } from './partitioned-event-loop'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const deferred = () => Promise.withResolvers<void>()

describe('partitioned event loop', () => {
  test('serializes a partition, runs other partitions, and retains a wake during execution', async () => {
    const release = deferred()
    const started = deferred()
    const calls: string[] = []
    const errors: unknown[] = []
    const loop = createPartitionedEventLoop<string>({
      concurrency: 2,
      onError: (error) => {
        errors.push(error)
      },
      dispatch: async (key) => {
        calls.push(key)
        if (key === 'a' && calls.filter((entry) => entry === 'a').length === 1) {
          started.resolve()
          await release.promise
        }
      },
    })
    loop.notify('a')
    await started.promise
    loop.notify('a')
    loop.notify('a')
    loop.notify('b')
    await tick()
    expect(calls).toEqual(['a', 'b'])
    release.resolve()
    await tick()
    await tick()
    expect(calls).toEqual(['a', 'b', 'a'])
    expect(errors).toEqual([])
    await loop.close()
  })

  test('idle is reusable; observer failures and handler failures do not wedge dispatch', async () => {
    const errors: unknown[] = []
    const events: string[] = []
    let calls = 0
    const loop = createPartitionedEventLoop<string>({
      dispatch: async () => {
        if (++calls === 1) throw new Error('handler')
      },
      onError: (error) => {
        errors.push(error)
      },
    })
    loop.subscribe((event) => {
      events.push(event.kind)
    }, 'a')
    const unsubscribe = loop.subscribe(() => {
      throw new Error('observer')
    }, 'b')
    loop.notify('a')
    await tick()
    await tick()
    loop.notify('a')
    await tick()
    expect(calls).toBe(2)
    expect(events).toContain('failed')
    loop.notify('b')
    await tick()
    unsubscribe()
    expect(errors.length).toBeGreaterThan(1)
    await loop.close()
  })

  test('notifying from the idle observer does not lose work', async () => {
    let calls = 0
    const loop = createPartitionedEventLoop<string>({
      dispatch: async () => {
        calls += 1
      },
      onError: () => {},
    })
    loop.subscribe((event) => {
      if (event.kind === 'idle' && calls === 1) loop.notify('a')
    })
    loop.notify('a')
    await tick()
    await tick()
    expect(calls).toBe(2)
    await loop.close()
  })

  test('cancels pending work and timers; shutdown waits for active work', async () => {
    const active = deferred()
    const release = deferred()
    const calls: string[] = []
    const loop = createPartitionedEventLoop<string>({
      concurrency: 1,
      dispatch: async (key) => {
        calls.push(key)
        active.resolve()
        await release.promise
      },
      onError: () => {},
    })
    loop.notify('a')
    await active.promise
    loop.notify('b')
    loop.cancel('b')
    loop.scheduleAt('c', Date.now() + 60_000)
    loop.cancel('c')
    let closed = false
    const closing = loop.close().then(() => {
      closed = true
    })
    await tick()
    expect(closed).toBe(false)
    release.resolve()
    await closing
    loop.notify('d')
    await tick()
    expect(calls).toEqual(['a'])
  })

  test('expired timers enter the ready queue and replacements cancel the previous deadline', async () => {
    const calls: string[] = []
    const loop = createPartitionedEventLoop<string>({
      dispatch: async (key) => {
        calls.push(key)
      },
      onError: () => {},
    })
    loop.scheduleAt('a', Date.now() + 60_000)
    loop.scheduleAt('a', Date.now() - 1)
    await tick()
    expect(calls).toEqual(['a'])
    await loop.close()
  })
})
