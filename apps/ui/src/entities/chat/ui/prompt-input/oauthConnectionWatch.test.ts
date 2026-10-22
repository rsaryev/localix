import { describe, expect, test } from 'bun:test'
import { watchOAuthConnection } from './oauthConnectionWatch'

const connected = { id: 'openai-1', providerId: 'openai', updatedAt: 'new', keyCount: 1 }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function harness(overrides: Partial<Parameters<typeof watchOAuthConnection>[0]> = {}) {
  let current: (typeof connected)[] = []
  const listeners = new Set<() => void>()
  const timers = new Map<number, () => void>()
  const found: unknown[] = []
  let stopped = 0
  let expired = 0
  const stop = watchOAuthConnection({
    baseline: [],
    providerId: 'openai',
    read: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onConnected: async (connection) => {
      found.push(connection)
    },
    onStop: () => {
      stopped++
    },
    onTimeout: () => {
      expired++
    },
    timer: (ms, fire) => {
      timers.set(ms, fire)
      return () => timers.delete(ms)
    },
    deadlineMs: 1000,
    ...overrides,
  })
  return {
    stop,
    found,
    counts: () => ({ stopped, expired }),
    watching: () => listeners.size > 0,
    timers,
    async change(connections: typeof current) {
      current = connections
      for (const listener of Array.from(listeners)) listener()
      await settle()
    },
    async fire(ms: number) {
      timers.get(ms)?.()
      await settle()
    },
  }
}

describe('OAuth connection watch', () => {
  test('ignores other providers and returns exactly once when the connection is listed', async () => {
    const watch = harness()
    await watch.change([{ ...connected, id: 'other', providerId: 'anthropic' }])
    expect(watch.found).toEqual([])
    await watch.change([connected])
    await watch.change([connected])
    expect(watch.found).toEqual([connected])
    expect(watch.counts()).toEqual({ stopped: 1, expired: 0 })
    expect(watch.watching()).toBe(false)
    expect(watch.timers.size).toBe(0)
  })

  test('a connection already listed when the watch starts counts', async () => {
    const watch = harness({ read: () => [connected] })
    await settle()
    expect(watch.found).toEqual([connected])
  })

  test('recognizes a reauthorized connection already present in the baseline', async () => {
    const watch = harness({ baseline: [{ ...connected, updatedAt: 'old', keyCount: 0 }] })
    await watch.change([connected])
    expect(watch.found).toEqual([connected])
  })

  test('gives up at the deadline when nothing arrives', async () => {
    const watch = harness()
    await watch.fire(1000)
    expect(watch.counts()).toEqual({ stopped: 1, expired: 1 })
    expect(watch.watching()).toBe(false)
  })

  test('a failed binding is tried again, not dropped', async () => {
    let attempts = 0
    const found: unknown[] = []
    const watch = harness({
      onConnected: async (connection) => {
        attempts++
        if (attempts === 1) throw new Error('offline')
        found.push(connection)
      },
    })
    await watch.change([connected])
    expect(found).toEqual([])
    await watch.fire(3000)
    expect(found).toEqual([connected])
    expect(watch.counts()).toEqual({ stopped: 1, expired: 0 })
  })

  test('stopping cancels an in-flight binding before it can reopen the picker', async () => {
    let finish!: () => void
    let signal!: AbortSignal
    const watch = harness({
      onConnected: (_connection, abort) => {
        signal = abort
        return new Promise<void>((resolve) => {
          finish = resolve
        })
      },
    })
    await watch.change([connected])
    watch.stop()
    finish()
    await settle()
    expect(signal.aborted).toBe(true)
    expect(watch.counts()).toEqual({ stopped: 1, expired: 0 })
    expect(watch.timers.size).toBe(0)
  })
})
