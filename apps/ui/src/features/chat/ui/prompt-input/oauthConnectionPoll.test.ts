import { describe, expect, test } from 'bun:test'
import { startOAuthConnectionPoll } from './oauthConnectionPolling'

const connected = { id: 'openai-1', providerId: 'openai', updatedAt: 'new', keyCount: 1 }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function harness(overrides: Partial<Parameters<typeof startOAuthConnectionPoll>[0]> = {}) {
  let tick: (() => void) | undefined
  let current: (typeof connected)[] = []
  const found: unknown[] = []
  let stopped = 0
  let expired = 0
  const stop = startOAuthConnectionPoll({
    baseline: [],
    providerId: 'openai',
    refresh: async () => {},
    read: () => current,
    onConnected: async (connection) => {
      found.push(connection)
    },
    onStop: () => {
      stopped++
    },
    onTimeout: () => {
      expired++
    },
    schedule: (callback) => {
      tick = callback
      return () => {
        tick = undefined
      }
    },
    ...overrides,
  })
  return {
    stop,
    found,
    counts: () => ({ stopped, expired }),
    pending: () => !!tick,
    setConnections: (connections: typeof current) => {
      current = connections
    },
    async advance() {
      const callback = tick
      tick = undefined
      callback?.()
      await settle()
    },
  }
}

describe('OAuth completion poll lifecycle', () => {
  test('ignores other providers and returns exactly once after the requested connection appears', async () => {
    const poll = harness()
    poll.setConnections([{ ...connected, id: 'other', providerId: 'anthropic' }])
    await poll.advance()
    expect(poll.found).toEqual([])
    expect(poll.pending()).toBe(true)
    poll.setConnections([connected])
    await poll.advance()
    await poll.advance()
    expect(poll.found).toEqual([connected])
    expect(poll.counts()).toEqual({ stopped: 1, expired: 0 })
    expect(poll.pending()).toBe(false)
  })

  test('recognizes a reauthorized connection already present in the baseline', async () => {
    const poll = harness({ baseline: [{ ...connected, updatedAt: 'old', keyCount: 0 }] })
    poll.setConnections([connected])
    await poll.advance()
    expect(poll.found).toEqual([connected])
  })

  test('bounds retries even when every request fails', async () => {
    const poll = harness({
      maxAttempts: 2,
      refresh: async () => {
        throw new Error('offline')
      },
    })
    await poll.advance()
    expect(poll.pending()).toBe(true)
    await poll.advance()
    expect(poll.counts()).toEqual({ stopped: 1, expired: 1 })
    expect(poll.pending()).toBe(false)
    expect(poll.found).toEqual([])
  })

  test('navigation cancels an in-flight refresh before it can reopen the picker', async () => {
    let finish!: () => void
    const poll = harness({
      refresh: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    })
    poll.setConnections([connected])
    await poll.advance()
    poll.stop()
    finish()
    await settle()
    expect(poll.found).toEqual([])
    expect(poll.counts()).toEqual({ stopped: 1, expired: 0 })
    expect(poll.pending()).toBe(false)
  })
})
