import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { ApiError } from '@/shared/api/failure'
import { executeNotificationCommand, resetNotificationCommandsForTests } from './commandRegistry'
import { pendingOps } from './outbox'
import {
  failedRunOf,
  retryFailedRun,
  type FailedRun,
  type RetryFailedRunDeps,
  type RetryOutcome,
} from './runLifecycle'
import { startNotificationCommandHandlers } from './runtime'
import {
  resetNotificationsForTests,
  seedNotificationsForTests,
  useNotificationsStore,
} from './store'
import type { NotificationInput } from './types'

const entries = () => useNotificationsStore.getState().entries

/** A failure row as the SERVER records it: the run on the action, the chat on the origin. */
const failureRow = (id: string, sessionId: string, runId: string): NotificationInput => ({
  id,
  topic: 'run.failed',
  category: 'agent',
  severity: 'error',
  title: 'Agent run failed',
  origin: { kind: 'session', sessionId, projectId: 'p' },
  actions: [
    {
      id: 'retry',
      label: 'Retry',
      kind: 'invoke',
      command: 'retry_run',
      target: { kind: 'session', sessionId, projectId: 'p' },
      runId,
      available: true,
    },
  ],
})

beforeEach(() => resetNotificationsForTests())
afterEach(() => {
  resetNotificationsForTests()
  resetNotificationCommandsForTests()
})

describe('the run a row stands for', () => {
  test('is read from the action the server stored, falling back to a run origin', () => {
    const row = { ...failureRow('r', 's1', 'm1'), ts: 0, read: false, id: 'r' }
    expect(failedRunOf(row, row.actions![0])).toEqual({
      sessionId: 's1',
      projectId: 'p',
      runId: 'm1',
    })
    const legacy = {
      ...row,
      actions: undefined,
      origin: {
        kind: 'resource' as const,
        sessionId: 's2',
        projectId: null,
        resourceKind: 'run',
        resourceId: 'x',
      },
    }
    expect(failedRunOf(legacy)).toEqual({ sessionId: 's2', projectId: null, runId: 'x' })
    expect(failedRunOf({ ...row, actions: undefined, origin: { kind: 'application' } })).toBeNull()
  })
})

describe('retrying a failed run', () => {
  const deps = (outcome: RetryOutcome) => {
    const calls = {
      regenerate: [] as FailedRun[],
      reports: [] as [string, string][],
      settled: [] as string[],
    }
    const value: RetryFailedRunDeps = {
      regenerate: async (target) => {
        calls.regenerate.push(target)
        return outcome
      },
      report: (severity, title) => calls.reports.push([severity, title]),
      settle: (reason) => calls.settled.push(reason),
    }
    return { value, calls }
  }
  const run = { sessionId: 's1', projectId: 'p', runId: 'm1' }

  test('names its run to the server, and a refusal settles the row with an explanation', async () => {
    const { value, calls } = deps('superseded')
    expect(await retryFailedRun(run, value)).toBe(false)
    // The run travels with the request: the SERVER decides, atomically, not a read here.
    expect(calls.regenerate).toEqual([run])
    expect(calls.reports).toEqual([['info', 'This run is no longer the latest reply']])
    expect(calls.settled).toEqual(['superseded'])
  })

  test('a run that left no reply is explained as such', async () => {
    const { value, calls } = deps('no_reply')
    expect(await retryFailedRun(run, value)).toBe(false)
    expect(calls.reports).toEqual([['info', 'This run left no reply to retry']])
  })

  test('an accepted regenerate settles the row it was clicked on', async () => {
    const { value, calls } = deps('accepted')
    expect(await retryFailedRun(run, value)).toBe(true)
    expect(calls.settled).toEqual(['retried'])
  })

  test('a regenerate that failed leaves the row live to try again', async () => {
    const { value, calls } = deps('failed')
    expect(await retryFailedRun(run, value)).toBe(false)
    expect(calls.settled).toEqual([])
  })

  test('the Retry command works from the row alone — what a reload or the server hands it', async () => {
    const regenerate = spyOn(backendClient, 'regenerate').mockRejectedValue(
      new ApiError('That reply is no longer the latest one', 409, 'regenerate_superseded'),
    )
    const stop = startNotificationCommandHandlers()
    try {
      seedNotificationsForTests([failureRow('run.failed:s1:m1', 's1', 'm1')])
      const row = entries()[0]!
      expect(await executeNotificationCommand(row, row.actions![0]!)).toBe(true)
      // The row's run went to the server, which refused it.
      expect(regenerate).toHaveBeenCalledWith('s1', 'p', 'm1')
      // The refusal is its own row under the same chat, and the stale row is settled on the server.
      expect(entries().map((entry) => entry.title)).toContain(
        'This run is no longer the latest reply',
      )
      expect(entries().find((entry) => entry.id === row.id)?.resolvedAt).toBeGreaterThan(0)
      expect(pendingOps()).toContainEqual(
        expect.objectContaining({
          op: 'settle',
          fact: expect.objectContaining({ key: row.id, reason: 'superseded' }),
        }),
      )
    } finally {
      stop()
      regenerate.mockRestore()
    }
  })
})
