import { describe, expect, test } from 'bun:test'
import { runHookOperation } from './operation'

describe('bounded lifecycle operations', () => {
  test('returns a completed value and classifies synchronous failures', async () => {
    expect(await runHookOperation({ timeoutMs: 1000, run: () => 'value' })).toEqual({
      kind: 'completed',
      value: 'value',
    })
    const error = new Error('failed')
    expect(
      await runHookOperation({
        timeoutMs: 1000,
        run: () => {
          throw error
        },
      }),
    ).toEqual({ kind: 'failed', error })
  })
  test('bounds a non-cooperative operation and observes its late rejection', async () => {
    let rejectLater: (error: Error) => void = () => {
      throw new Error('Not started')
    }
    const signals: AbortSignal[] = []
    const result = await runHookOperation({
      timeoutMs: 20,
      run: (signal) => {
        signals.push(signal)
        return new Promise((_, reject) => {
          rejectLater = reject
        })
      },
    })
    expect(result).toEqual({ kind: 'timeout' })
    expect(signals[0]?.aborted).toBe(true)
    rejectLater(new Error('late failure'))
    await Promise.resolve()
    expect(result.kind).toBe('timeout')
  })
  test('caller cancellation settles independently of an operation that never resolves', async () => {
    const controller = new AbortController()
    const signals: AbortSignal[] = []
    const pending = runHookOperation({
      timeoutMs: 1000,
      signal: controller.signal,
      run: (signal) => {
        signals.push(signal)
        return new Promise(() => {})
      },
    })
    controller.abort()
    expect(await pending).toEqual({ kind: 'aborted' })
    expect(signals[0]?.aborted).toBe(true)
  })
  test('pre-cancelled operations never invoke the handler', async () => {
    let calls = 0
    expect(
      await runHookOperation({
        timeoutMs: 1000,
        signal: AbortSignal.abort(),
        run: () => {
          calls++
        },
      }),
    ).toEqual({ kind: 'aborted' })
    expect(calls).toBe(0)
  })
})
