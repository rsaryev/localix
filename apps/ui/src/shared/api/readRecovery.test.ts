import { describe, expect, spyOn, test } from 'bun:test'
import { ApiError } from './failure'
import { eventSocket } from './eventSocket'
import { recoverRead } from './readRecovery'

describe('file read recovery', () => {
  test('reconnect wakes a pending unavailable read and removes its observer', async () => {
    let reconnect!: () => void
    let unsubscribed = false
    const observer = spyOn(eventSocket, 'onConnected').mockImplementation((handler) => {
      reconnect = handler
      return () => {
        unsubscribed = true
      }
    })
    let calls = 0
    try {
      const result = recoverRead(async () => {
        if (++calls === 1) throw new ApiError('Restarting', 503)
        return 'file content'
      })
      await Promise.resolve()
      reconnect()
      expect(await result).toBe('file content')
      expect(calls).toBe(2)
      expect(unsubscribed).toBe(true)
    } finally {
      observer.mockRestore()
    }
  })

  test('recovers without a socket notification', async () => {
    let calls = 0
    expect(
      await recoverRead(async () => {
        if (++calls === 1) throw new ApiError('Offline', 0, 'network')
        return 'content'
      }),
    ).toBe('content')
    expect(calls).toBe(2)
  })

  test('closing the caller cancels its wait and prevents another read', async () => {
    const controller = new AbortController()
    let calls = 0
    const result = recoverRead(
      async () => {
        calls++
        throw new ApiError('Offline', 0, 'network')
      },
      { signal: controller.signal },
    )
    const rejection = result.catch((error: unknown) => error)
    await Promise.resolve()
    controller.abort()
    expect(await rejection).toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(1)
  })

  test('missing, forbidden and actual read failures are not retried', async () => {
    for (const status of [403, 404, 500]) {
      const error = new ApiError('Cannot read', status)
      let calls = 0
      await expect(
        recoverRead(async () => {
          calls++
          throw error
        }),
      ).rejects.toBe(error)
      expect(calls).toBe(1)
    }
  })

  test('an exhausted recovery budget returns the original failure', async () => {
    const error = new ApiError('Unavailable', 503)
    await expect(
      recoverRead(
        async () => {
          throw error
        },
        { recoveryMs: 0 },
      ),
    ).rejects.toBe(error)
  })
})
