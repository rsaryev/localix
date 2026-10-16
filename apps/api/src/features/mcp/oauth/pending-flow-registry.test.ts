import { describe, expect, test } from 'bun:test'

import { createPendingOAuthRegistry, type PendingOAuthResources } from './pending-flow-registry'

interface FakeFlow extends PendingOAuthResources {
  name: string
  transportCloses: number
  clientCloses: number
}

function fakeFlow(name: string, expiresAt: number): FakeFlow {
  const flow: FakeFlow = {
    name,
    expiresAt,
    transportCloses: 0,
    clientCloses: 0,
    transport: {
      async close() {
        flow.transportCloses += 1
      },
    },
    client: {
      async close() {
        flow.clientCloses += 1
      },
    },
  }
  return flow
}

function manualTimers() {
  const callbacks = new Map<number, () => void>()
  let sequence = 0
  return {
    schedule: (callback: () => void) => {
      const handle = ++sequence
      callbacks.set(handle, callback)
      return handle
    },
    cancel: (handle: number | { unref?(): unknown }) => {
      callbacks.delete(handle as number)
    },
    fire: (handle: number) => {
      callbacks.get(handle)?.()
      callbacks.delete(handle)
    },
    size: () => callbacks.size,
  }
}

describe('createPendingOAuthRegistry', () => {
  test('an abandoned flow expires without requiring a later registry access', async () => {
    const timers = manualTimers()
    const registry = createPendingOAuthRegistry<FakeFlow>({
      now: () => 1_000,
      schedule: timers.schedule,
      cancel: timers.cancel,
    })
    const flow = fakeFlow('abandoned', 2_000)

    registry.add('state', flow)
    expect(registry.size()).toBe(1)
    expect(timers.size()).toBe(1)

    timers.fire(1)
    await Promise.resolve()
    await Promise.resolve()

    expect(registry.size()).toBe(0)
    expect(flow.transportCloses).toBe(1)
    expect(flow.clientCloses).toBe(1)
  })

  test('taking a flow cancels expiry without closing resources needed by completion', async () => {
    const timers = manualTimers()
    const registry = createPendingOAuthRegistry<FakeFlow>({
      now: () => 1_000,
      schedule: timers.schedule,
      cancel: timers.cancel,
    })
    const flow = fakeFlow('claimed', 2_000)

    registry.add('state', flow)
    expect(registry.take('state')).toBe(flow)
    timers.fire(1)
    await Promise.resolve()
    await Promise.resolve()

    expect(timers.size()).toBe(0)
    expect(flow.transportCloses).toBe(0)
    expect(flow.clientCloses).toBe(0)
  })

  test('capacity evicts and closes the oldest pending flow', async () => {
    const timers = manualTimers()
    const registry = createPendingOAuthRegistry<FakeFlow>({
      maxSize: 2,
      now: () => 1_000,
      schedule: timers.schedule,
      cancel: timers.cancel,
    })
    const oldest = fakeFlow('oldest', 5_000)
    const second = fakeFlow('second', 5_000)
    const newest = fakeFlow('newest', 5_000)

    registry.add('oldest', oldest)
    registry.add('second', second)
    registry.add('newest', newest)
    await Promise.resolve()
    await Promise.resolve()

    expect(registry.size()).toBe(2)
    expect(registry.take('oldest')).toBeUndefined()
    expect(oldest.transportCloses).toBe(1)
    expect(oldest.clientCloses).toBe(1)
    expect(registry.take('second')).toBe(second)
    expect(registry.take('newest')).toBe(newest)
  })
})
