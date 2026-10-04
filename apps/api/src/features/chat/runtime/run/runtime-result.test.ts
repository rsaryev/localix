import { describe, expect, test } from 'bun:test'

import { requireCompletedRuntime } from './runtime-result'

describe('requireCompletedRuntime', () => {
  test('accepts a completed engine-neutral result', () => {
    expect(() => requireCompletedRuntime({ messages: [], terminal: 'completed' })).not.toThrow()
  })

  test('rejects a failed result even when the adapter iterator did not throw', () => {
    const cause = new Error('provider failed')
    expect(() =>
      requireCompletedRuntime({ messages: [], terminal: 'failed', error: cause }),
    ).toThrow(cause)
  })

  test('normalizes cancellation to the shared AbortError contract', () => {
    try {
      requireCompletedRuntime({
        messages: [],
        terminal: 'aborted',
        error: new Error('cancelled by user'),
      })
      throw new Error('expected cancellation')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).name).toBe('AbortError')
      expect((error as Error).message).toBe('cancelled by user')
    }
  })
})
