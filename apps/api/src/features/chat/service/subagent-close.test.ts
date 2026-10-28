import { afterEach, describe, expect, test } from 'bun:test'

import { DELEGATION_SLOT_CAP } from '../../agent-core/delegation-budget'

import { sessionFixture } from '../../../testing/session-fixture'
import {
  __resetDelegationLanes,
  laneOf,
  releaseLane,
  requestLane,
} from '../../agent-core/delegation-lanes'
import {
  __resetExpectedReports,
  expectReport,
  takeExpectedReport,
} from '../../agent-core/delegation-awaits'
import { closeSubagent } from './subagent-close'
import { __resetWaitingMessages, messageSubagent } from './subagent-messages'

afterEach(() => {
  __resetDelegationLanes()
  __resetWaitingMessages()
  __resetExpectedReports()
})

const child = sessionFixture({
  id: 'child',
  sessionKind: 'subagent',
  parentSessionId: 'root',
  provenance: { kind: 'task-delegation', parentSessionId: 'root', toolCallId: 'tc' },
})

function host(opts: { busy?: boolean; session?: typeof child } = {}) {
  const events: string[] = []
  const published: Array<{ closedAt?: string | null }> = []
  const ctx = {
    now: () => '2026-10-01T12:00:00.000Z',
    requireSession: async () => opts.session ?? child,
    repo: {
      updateSession: async (_u: string, _id: string, patch: { closedAt?: string }) =>
        void events.push(`mark:${patch.closedAt}`),
    },
    runner: {
      isBusy: () => opts.busy ?? false,
      wake: async () => void events.push('wake'),
      clearQueued: async () => void events.push('clear-queue'),
      stop: async () => {
        events.push('stop')
        return true
      },
    },
    publishSession: (session: { closedAt?: string | null }) => void published.push(session),
  }
  return { ctx: ctx as never, events, published }
}

describe('closing a delegated child', () => {
  test('marks it FIRST, then drops what waits, then stops the run', async () => {
    // The mark lands before anything else so a wake racing the close is refused at the drain.
    const h = host({ busy: true })
    expectReport('child')
    expect(await closeSubagent(h.ctx, 'u', 'child')).toEqual({
      closed: true,
      wasRunning: true,
      alreadyClosed: false,
    })
    expect(h.events).toEqual(['mark:2026-10-01T12:00:00.000Z', 'clear-queue', 'stop'])
    // Every open view of the child turns read-only now, not on its next reload.
    expect(h.published).toMatchObject([{ closedAt: '2026-10-01T12:00:00.000Z' }])
    // And the delegator stops waiting on it: nothing it ran could ever answer.
    expect(takeExpectedReport('child')).toBe(false)
  })

  test('a child waiting for a lane leaves the queue and never starts', async () => {
    for (let i = 1; i <= DELEGATION_SLOT_CAP; i++) requestLane('root', `s${i}`, () => {})
    let started = false
    requestLane('root', 'child', () => {
      started = true
    })
    await closeSubagent(host().ctx, 'u', 'child')
    expect(laneOf('child')).toBeUndefined()
    // The lane it was waiting for frees — and still nothing starts it.
    releaseLane('s1')
    expect(started).toBe(false)
  })

  test('messages it was waiting to read are dropped with it', async () => {
    for (let i = 1; i <= DELEGATION_SLOT_CAP; i++) requestLane('root', `s${i}`, () => {})
    const h = host()
    await messageSubagent(h.ctx, 'u', 'child', 'never read')
    await closeSubagent(h.ctx, 'u', 'child')
    expect(h.events).not.toContain('wake')
  })

  test('closing twice is a no-op, and says so', async () => {
    const h = host({ session: { ...child, closedAt: '2026-10-01T00:00:00.000Z' } })
    expect(await closeSubagent(h.ctx, 'u', 'child')).toEqual({
      closed: true,
      wasRunning: false,
      alreadyClosed: true,
    })
    expect(h.events).toEqual([])
  })

  test('only a sub-agent can be closed', async () => {
    const h = host({ session: sessionFixture({ id: 'chat' }) as typeof child })
    expect(await closeSubagent(h.ctx, 'u', 'chat')).toEqual({
      closed: false,
      reason: 'not-subagent',
    })
  })
})
