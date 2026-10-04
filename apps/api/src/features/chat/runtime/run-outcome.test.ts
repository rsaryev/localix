import { describe, expect, test } from 'bun:test'

import { completedRun, createRunCompletion } from './run-outcome'

describe('logical run completion', () => {
  test('the queue-owned completion remains pending until a terminal segment settles it', async () => {
    const completion = createRunCompletion()
    let observed: unknown
    const pending = completion.promise.then((outcome) => {
      observed = outcome
      return outcome
    })
    await Promise.resolve()
    expect(observed).toBeUndefined()

    const failure = {
      status: 'failed',
      kind: 'timeout',
      message: 'retry exhausted',
      retryable: true,
      rateLimited: false,
    } as const
    completion.settle(failure)

    expect(await pending).toEqual(failure)
  })

  test('the first terminal segment settles exactly once', async () => {
    const completion = createRunCompletion()
    completion.settle(completedRun())
    expect(await completion.promise).toEqual({ status: 'completed' })
    completion.settle({
      status: 'failed',
      kind: 'fatal',
      message: 'late',
      retryable: false,
      rateLimited: false,
    })
    expect(await completion.promise).toEqual({ status: 'completed' })
  })
})
