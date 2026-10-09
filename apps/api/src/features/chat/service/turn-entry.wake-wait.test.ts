import { expect, test } from 'bun:test'
import { wakeSessionAndWait, type TurnEntryContext } from './turn-entry'
import { sessionFixture } from '../../../testing/session-fixture'
import type { WakeRequest } from '../contracts'
import type { RunExecutionOutcome } from '../runtime/run-outcome'

const request: WakeRequest = {
  userId: 'u',
  sessionId: 'wake-wait',
  content: 'scheduled work',
  source: 'loop',
}

test('scheduled wake propagates repository failure instead of marking the session unsupported', async () => {
  const failure = new Error('repository unavailable')
  let calls = 0
  const ctx = {
    requireSession: async () => {
      throw failure
    },
    runner: {
      wakeAndWait: async () => {
        calls++
        return { status: 'completed' }
      },
    },
  } as unknown as TurnEntryContext
  await expect(wakeSessionAndWait(ctx, request)).rejects.toBe(failure)
  expect(calls).toBe(0)
})

test('scheduled wake refuses a job session before queue admission', async () => {
  let calls = 0
  const ctx = {
    requireSession: async () => sessionFixture({ id: request.sessionId, sessionKind: 'job' }),
    runner: {
      wakeAndWait: async () => {
        calls++
        return { status: 'completed' }
      },
    },
  } as unknown as TurnEntryContext
  expect(await wakeSessionAndWait(ctx, request)).toEqual({
    status: 'failed',
    kind: 'fatal',
    message: 'Session wake-wait is unavailable for a scheduled wake.',
    retryable: false,
    rateLimited: false,
  })
  expect(calls).toBe(0)
})

test('scheduled wake stays pending until the runner returns its terminal outcome', async () => {
  const session = sessionFixture({ id: request.sessionId, userId: request.userId })
  let finish!: (value: RunExecutionOutcome) => void
  const outcome = { status: 'completed' } as const
  const completion = new Promise<RunExecutionOutcome>((resolve) => {
    finish = resolve
  })
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  let received: unknown
  const ctx = {
    requireSession: async () => session,
    runner: {
      wakeAndWait: (params: unknown) => {
        received = params
        entered()
        return completion
      },
    },
  } as unknown as TurnEntryContext
  let settled = false
  const pending = wakeSessionAndWait(ctx, request)
  void pending.then(() => {
    settled = true
  })
  try {
    await started
    expect(settled).toBe(false)
    expect(received).toEqual({
      userId: request.userId,
      session,
      content: request.content,
      source: request.source,
    })
    finish(outcome)
    expect(await pending).toBe(outcome)
  } finally {
    finish(outcome)
    await pending
  }
})
