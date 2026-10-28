import { sessionFixture } from '../../../../testing/session-fixture'
import { describe, expect, test } from 'bun:test'

import type { PersistedMessage } from '../../contracts'
import type { SessionRecord } from '../../repository'
import { dispatchParams } from '../run-params'
import { attemptTransientRetry } from './recovery'
import type { RunEnv, RunParams } from './types'
import { DEFAULT_AGENT_AUTHOR, USER_AUTHOR } from '../../../../db'

function harness() {
  const session = { ...sessionFixture(), id: 'retry-session' } as SessionRecord
  const timestamp = '2026-09-07T00:00:00.000Z'
  const row = (id: string, role: 'user' | 'assistant', content: string): PersistedMessage => ({
    id,
    userId: 'u',
    sessionId: session.id,
    payload: {
      id,
      role,
      from: role === 'user' ? USER_AUTHOR : DEFAULT_AGENT_AUTHOR,
      content,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const completed = row('a', 'assistant', 'Saved the file; tests passed.')
  const failed = row('a', 'assistant', 'Saved the file; tests passed. Partial failed answer')
  const rows = [row('u', 'user', 'Write the file once.'), failed]
  const launched: RunParams[] = []
  const events: unknown[] = []
  const order: string[] = []
  const abort = new AbortController()
  const checkpointState = { payload: failed.payload, currentPayload: failed.payload }
  const env = {
    now: () => timestamp,
    state: {
      activeRuns: new Map([[session.id, abort]]),
      activeRunSessions: new Map([[session.id, { userId: 'u', session }]]),
    },
    deps: {
      streamRegistry: { publish: (_u: string, _s: string, event: unknown) => events.push(event) },
    },
    repo: {
      listMessages: async () => {
        order.push('read')
        return [...rows]
      },
      insertMessage: async (message: PersistedMessage) => {
        order.push('insert')
        rows.push(message)
      },
    },
    persistAndPublish: async (
      _u: string,
      _s: string,
      id: string,
      payload: PersistedMessage['payload'],
    ) => {
      order.push('checkpoint')
      rows[rows.findIndex((message) => message.id === id)]!.payload = payload
    },
    run: async (params: RunParams) => {
      order.push('run')
      launched.push(params)
    },
  }
  const params = dispatchParams(
    { userId: 'u', session, assistantMessageId: 'a', historyMessages: rows },
    {} as RunParams['scope'],
  )
  const args = {
    env: env as unknown as RunEnv,
    runtimeState: {} as Parameters<typeof attemptTransientRetry>[0]['runtimeState'],
    now: env.now,
    userId: 'u',
    session,
    assistantMessageId: 'a',
    params,
    abort,
    error: Object.assign(new Error('upstream 503'), { status: 503 }),
    completedTurnCheckpoint: { payload: completed.payload, createdAt: timestamp },
    checkpointState,
    waits: [] as number[],
    wait: async (ms: number) => {
      args.waits.push(ms)
    },
  }
  return { env, args, rows, launched, events, order, completed, checkpointState, abort }
}

describe('transient recovery preserves completed work', () => {
  test('checkpoints before reload and resumes on a fresh row with settled history', async () => {
    const h = harness()
    expect(await attemptTransientRetry(h.args)).toBe(true)
    expect(h.args.waits).toEqual([2_000])
    expect(h.order).toEqual(['checkpoint', 'read', 'insert', 'run'])
    const retry = h.launched[0]!
    expect(retry.assistantMessageId).not.toBe('a')
    expect(retry.historyMessages.map((row) => row.id)).toEqual(['u', 'a'])
    expect(retry.historyMessages[1]!.payload).toEqual(h.completed.payload)
    expect(h.checkpointState.currentPayload).toBe(h.completed.payload)
    expect(retry.chain.transientRetryCount).toBe(1)
    expect(retry.chain.continuation).toBe(true)
    expect(h.events).toHaveLength(1)
  })

  test('Stop during the history read prevents a response row and relaunch', async () => {
    const h = harness()
    h.env.repo.listMessages = async () => {
      h.abort.abort('stop')
      return h.rows
    }
    expect(await attemptTransientRetry(h.args)).toBe(false)
    expect(h.launched).toHaveLength(0)
    expect(h.rows).toHaveLength(2)
    expect(h.env.state.activeRuns.get(h.args.session.id)).toBe(h.abort)
  })

  test('a checkpoint write failure does not replay or replace the original error', async () => {
    const h = harness()
    h.env.persistAndPublish = async () => {
      throw new Error('storage unavailable')
    }
    expect(await attemptTransientRetry(h.args)).toBe(false)
    expect(h.launched).toHaveLength(0)
    expect(h.order).toEqual([])
  })

  test('a history read failure stays on the normal failure path', async () => {
    const h = harness()
    h.env.repo.listMessages = async () => {
      throw new Error('storage unavailable')
    }
    expect(await attemptTransientRetry(h.args)).toBe(false)
    expect(h.launched).toHaveLength(0)
    expect(h.rows).toHaveLength(2)
  })

  test('Stop racing a committed response row publishes that row but launches nothing', async () => {
    const h = harness()
    h.env.repo.insertMessage = async (message) => {
      h.rows.push(message)
      h.abort.abort('stop')
    }
    expect(await attemptTransientRetry(h.args)).toBe(false)
    expect(h.launched).toHaveLength(0)
    expect(h.rows).toHaveLength(3)
    expect(h.events).toHaveLength(1)
  })
})
