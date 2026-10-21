import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import { executeNotificationCommand, resetNotificationCommandsForTests } from './commandRegistry'
import { TURN_RESUME_KEY, continueFailedRun } from './runLifecycle'
import { startNotificationCommandHandlers } from './runtime'
import {
  resetNotificationsForTests,
  seedNotificationsForTests,
  useNotificationsStore,
} from './store'

/**
 * Continue from a failure row: the reply is picked up where it stopped (the conversation's
 * resume point), never regenerated. The server says whether it still waits.
 */
const entries = () => useNotificationsStore.getState().entries
const run = { sessionId: 's1', projectId: 'p', runId: 'm1' }

beforeEach(() => resetNotificationsForTests())
afterEach(() => {
  resetNotificationsForTests()
  resetNotificationCommandsForTests()
})

function recorder() {
  const calls = { reports: [] as [string, string][], settled: [] as string[] }
  return {
    calls,
    deps: {
      report: (severity: string, title: string) => calls.reports.push([severity, title]),
      settle: (reason: string) => calls.settled.push(reason),
    },
  }
}

describe('continuing a failed run', () => {
  test('asks for the conversation’s unfinished turn and settles the row once the agent is woken', async () => {
    const resume = spyOn(backendClient, 'resumeWork').mockResolvedValue({
      points: [],
      wake: 'delivered',
    })
    const { deps, calls } = recorder()
    try {
      expect(await continueFailedRun(run, deps as never)).toBe(true)
      expect(resume).toHaveBeenCalledWith('s1', TURN_RESUME_KEY)
      expect(calls.settled).toEqual(['retried'])
    } finally {
      resume.mockRestore()
    }
  })

  test('a reply the conversation moved past settles the row and says so', async () => {
    const resume = spyOn(backendClient, 'resumeWork').mockResolvedValue({
      points: [],
      gone: { message: 'gone' },
    })
    const { deps, calls } = recorder()
    try {
      expect(await continueFailedRun(run, deps as never)).toBe(false)
      expect(calls.settled).toEqual(['superseded'])
      expect(calls.reports).toEqual([['info', 'This reply no longer needs continuing']])
    } finally {
      resume.mockRestore()
    }
  })

  test('the Continue command works from the row alone', async () => {
    const resume = spyOn(backendClient, 'resumeWork').mockResolvedValue({
      points: [],
      wake: 'delivered',
    })
    const stop = startNotificationCommandHandlers()
    try {
      seedNotificationsForTests([
        {
          id: 'run.failed:s1:m1',
          topic: 'run.failed',
          category: 'agent',
          severity: 'error',
          title: 'Could not finish the reply',
          origin: { kind: 'session', sessionId: 's1', projectId: 'p' },
          actions: [
            {
              id: 'continue',
              label: 'Continue',
              kind: 'invoke',
              command: 'continue_run',
              target: { kind: 'session', sessionId: 's1', projectId: 'p' },
              runId: 'm1',
              available: true,
            },
          ],
        },
      ])
      const row = entries()[0]!
      expect(await executeNotificationCommand(row, row.actions![0]!)).toBe(true)
      expect(resume).toHaveBeenCalledWith('s1', TURN_RESUME_KEY)
      expect(entries().find((entry) => entry.id === row.id)?.resolvedAt).toBeGreaterThan(0)
    } finally {
      stop()
      resume.mockRestore()
    }
  })
})
