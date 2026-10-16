import { describe, expect, test } from 'bun:test'
import { executeModelTask } from './execute'
import type { ModelTaskRequest } from './contracts'

const request = (
  overrides: Partial<ModelTaskRequest<{ prompt: string }>> = {},
): ModelTaskRequest<{ prompt: string }> => ({
  task: { id: 'test', version: 1 },
  system: 'system',
  input: { prompt: 'hello' },
  budget: { inputTokens: 100, outputTokens: 20 },
  capabilities: {},
  ...overrides,
})

describe('executeModelTask', () => {
  test('passes the provider-neutral request and normalizes success', async () => {
    let received: unknown
    const result = await executeModelTask({
      request: request(),
      execute: async (value) => {
        received = value
        return { output: 'done', usage: { outputTokens: 1 } }
      },
    })
    expect(result).toEqual({
      status: 'success',
      response: { output: 'done', usage: { outputTokens: 1 } },
    })
    expect(received).toEqual(
      expect.objectContaining({ task: { id: 'test', version: 1 }, input: { prompt: 'hello' } }),
    )
    expect(received).not.toHaveProperty('signal')
  })

  test('propagates caller cancellation as a distinct typed outcome', () => {
    const caller = new AbortController()
    let providerSignal: AbortSignal | undefined
    const resultPromise = executeModelTask({
      request: request({ signal: caller.signal }),
      execute: async (_value, signal) => {
        providerSignal = signal
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        return { output: 'late' }
      },
    })
    caller.abort()
    expect(resultPromise).resolves.toEqual({ status: 'cancelled' })
    expect(providerSignal?.aborted).toBe(true)
  })

  test('aborts the provider at the host deadline', async () => {
    let providerSignal: AbortSignal | undefined
    const result = await executeModelTask({
      request: request({ deadlineAtMs: Date.now() + 10 }),
      execute: async (_value, signal) => {
        providerSignal = signal
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        return { output: 'late' }
      },
    })
    expect(result).toEqual({ status: 'deadline_exceeded' })
    expect(providerSignal?.aborted).toBe(true)
  })

  test('contains provider failures without leaking their error', async () => {
    const result = await executeModelTask({
      request: request(),
      execute: async () => {
        throw new Error('provider response body must not escape')
      },
    })
    expect(result).toEqual({ status: 'provider_error' })
    expect(JSON.stringify(result)).not.toContain('provider response')
  })

  test('normalizes an adapter that throws before returning its Promise', async () => {
    const result = await executeModelTask({
      request: request(),
      execute: () => {
        throw new Error('synchronous adapter failure')
      },
    })
    expect(result).toEqual({ status: 'provider_error' })
  })

  test('rejects a response that completes after the deadline even before the timer can run', async () => {
    const result = await executeModelTask({
      request: request({ deadlineAtMs: Date.now() + 5 }),
      execute: async () => {
        // Deliberately starve the timer task. The resolved Promise continuation
        // runs as a microtask first, so only the completion-time wall-clock guard
        // can prevent this late response from being accepted.
        const blockedUntil = Date.now() + 15
        while (Date.now() < blockedUntil) {
          // Busy wait is intentional and tightly bounded for this scheduler test.
        }
        return { output: 'late' }
      },
    })
    expect(result).toEqual({ status: 'deadline_exceeded' })
  })
})
