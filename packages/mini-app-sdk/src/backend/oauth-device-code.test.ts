import { describe, expect, test } from 'bun:test'

import { pollDeviceCode, type DeviceCodePollResult } from './oauth-device-code'

describe('pollDeviceCode overall deadline', () => {
  test('completes normally before the deadline', async () => {
    const value = await pollDeviceCode({
      expiresInSeconds: 1,
      poll: async () => ({ status: 'complete', value: 'token' }),
    })

    expect(value).toBe('token')
  })

  test('times out a hung poll, aborts its signal, and absorbs a late rejection', async () => {
    let calls = 0
    let pollSignal: AbortSignal | undefined
    let rejectPoll!: (error: Error) => void
    const hung = new Promise<DeviceCodePollResult<string>>((_resolve, reject) => {
      rejectPoll = reject
    })

    const result = pollDeviceCode({
      expiresInSeconds: 0.02,
      poll: (signal) => {
        calls += 1
        pollSignal = signal
        return hung
      },
    })

    expect(result).rejects.toThrow('Device flow timed out')
    expect(calls).toBe(1)
    expect(pollSignal?.aborted).toBe(true)

    // The provider may ignore AbortSignal and reject after the outer call settled.
    // Promise.race must retain a rejection handler, and no second poll may start.
    rejectPoll(new Error('late provider failure'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)
  })

  test('caller cancellation also settles a hung poll and reaches its signal', async () => {
    const abort = new AbortController()
    let pollSignal: AbortSignal | undefined
    const result = pollDeviceCode<string>({
      expiresInSeconds: 1,
      signal: abort.signal,
      poll: (signal) => {
        pollSignal = signal
        return new Promise(() => {})
      },
    })

    abort.abort()

    expect(result).rejects.toThrow('Device flow cancelled')
    expect(pollSignal?.aborted).toBe(true)
  })

  test('the stable deadline error wins over a provider-specific abort rejection', async () => {
    const result = pollDeviceCode<string>({
      expiresInSeconds: 0.02,
      poll: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('provider-specific abort error')),
            { once: true },
          )
        }),
    })

    expect(result).rejects.toThrow('Device flow timed out')
  })
})
