import { describe, expect, test, spyOn } from 'bun:test'
import { createResourceSync } from './resourceSync'

// The sync schedules its reads with zero-delay timers, so let a few timer turns pass.
const tick = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('resource sync', () => {
  test('reads after connection, coalesces bursts and only refreshes affected resources', async () => {
    const sync = createResourceSync()
    let projects = 0
    let providers = 0
    const stops = [
      sync.register('projects', { read: async () => ++projects, apply: () => {} }),
      sync.register('providers', { read: async () => ++providers, apply: () => {} }),
    ]
    try {
      await tick()
      expect(projects).toBe(0)
      sync.connected()
      await tick()
      for (let i = 0; i < 100; i++) sync.invalidate(['projects', 'projects'])
      await tick()
      expect(projects).toBe(2)
      expect(providers).toBe(1)
    } finally {
      stops.forEach((stop) => stop())
      sync.disconnected()
    }
  })

  test('a change during a read skips its stale result and performs one sequential follow-up', async () => {
    const sync = createResourceSync()
    const first = deferred<string>()
    let reads = 0
    const applied: string[] = []
    const stop = sync.register('sessions', {
      read: async () => (++reads === 1 ? first.promise : 'fresh'),
      apply: (value) => {
        applied.push(value)
      },
    })
    try {
      sync.connected()
      await tick()
      sync.invalidate(['sessions'], false)
      sync.invalidate(['sessions'])
      await tick()
      expect(reads).toBe(1)
      first.resolve('deleted-row')
      await tick()
      await tick()
      expect(applied).toEqual(['fresh'])
      expect(reads).toBe(2)
      sync.invalidate(['sessions'], false)
      await tick()
      expect(reads).toBe(2) // Directly applied roster frames cost no extra request.
    } finally {
      stop()
      sync.disconnected()
    }
  })

  test('disconnect and reconnect supersede an outstanding read; unmount aborts and cannot commit', async () => {
    const sync = createResourceSync()
    const first = deferred<number>()
    const signals: AbortSignal[] = []
    const applied: number[] = []
    const stop = sync.register('profile', {
      read: async (signal) => {
        signals.push(signal)
        return signals.length === 1 ? first.promise : 2
      },
      apply: (value) => {
        applied.push(value)
      },
    })
    try {
      sync.connected()
      await tick()
      sync.disconnected()
      expect(signals[0]!.aborted).toBe(true)
      sync.connected()
      first.resolve(1)
      await tick()
      await tick()
      expect(applied).toEqual([2])
      stop()
      sync.invalidate(['profile'])
      await tick()
      expect(signals).toHaveLength(2)
    } finally {
      stop()
      sync.disconnected()
    }
  })

  test('coalesces editor/cache observers and isolates their failures', async () => {
    const sync = createResourceSync()
    let calls = 0
    const warning = spyOn(console, 'warn').mockImplementation(() => {})
    const bad = sync.subscribe('capabilities', () => {
      throw new Error('bad observer')
    })
    const stop = sync.subscribe('capabilities', () => {
      calls++
    })
    try {
      for (let i = 0; i < 100; i++) sync.invalidate(['capabilities'])
      await tick()
      expect(calls).toBe(1)
      expect(
        warning.mock.calls.filter(([message]) => message === '[realtime] resource observer failed'),
      ).toHaveLength(1)
      bad()
      stop()
      sync.invalidate(['capabilities'])
      await tick()
      expect(calls).toBe(1)
    } finally {
      stop()
      bad()
      warning.mockRestore()
      sync.disconnected()
    }
  })

  test('retries a transient read, bounds permanent failures and recovers on the next change', async () => {
    const sync = createResourceSync({ retryDelaysMs: [0, 0, 0] })
    let reads = 0
    let failed = true
    let reports = 0
    const applied: number[] = []
    const stop = sync.register('projects', {
      read: async () => {
        reads++
        if (failed) throw new Error('offline')
        return reads
      },
      apply: (value) => {
        applied.push(value)
      },
      onError: () => {
        reports++
      },
    })
    try {
      sync.connected()
      await tick()
      await tick()
      await tick()
      await tick()
      await tick()
      await tick()
      expect(reads).toBe(4)
      expect(reports).toBe(1)
      expect(applied).toEqual([])
      failed = false
      sync.invalidate(['projects'])
      await tick()
      expect(applied).toEqual([5])
    } finally {
      stop()
      sync.disconnected()
    }
  })

  test('unmount during a read aborts it and never applies its later result', async () => {
    const sync = createResourceSync()
    const response = deferred<number>()
    let signal!: AbortSignal
    let applied = false
    const stop = sync.register('providers', {
      read: async (current) => {
        signal = current
        return response.promise
      },
      apply: () => {
        applied = true
      },
    })
    sync.connected()
    await tick()
    stop()
    expect(signal.aborted).toBe(true)
    response.resolve(1)
    await tick()
    expect(applied).toBe(false)
    sync.disconnected()
  })
})
