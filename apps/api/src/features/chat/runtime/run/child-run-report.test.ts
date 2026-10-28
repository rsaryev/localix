import { afterEach, describe, expect, test } from 'bun:test'

import { sessionFixture, routedAgent } from '../../../../testing/session-fixture'
import type { WakeRequest } from '../../contracts'
import {
  getAgentService,
  setAgentService,
  type AgentServiceBinding,
} from '../agent-service-binding'
import {
  __resetDelegationLanes,
  releaseLane,
  requestLane,
} from '../../../agent-core/delegation-lanes'
import {
  __resetExpectedReports,
  expectReport,
  takeTurnLimit,
} from '../../../agent-core/delegation-awaits'
import { reportChildRun } from './child-run-report'
import { subagentWorkKey } from './subagent-work'

/**
 * Every run of a delegated child reports — the delegated task, and each follow-up after it. The
 * report used to be sent by the delegation's continuation, which watches ONE run, so a child that
 * was messaged and ran again answered into a transcript nobody read.
 */

// The binding is process-global and bun runs test files in one process: put back exactly what was
// there, including nothing, the way `cc-hook-evaluators.test.ts` does.
const previous = getAgentService()
afterEach(() => {
  setAgentService(previous as AgentServiceBinding)
  __resetDelegationLanes()
  __resetExpectedReports()
})

const root = sessionFixture({
  id: 'root',
  agent: routedAgent({ agentId: 'builtin:lead', name: 'lead' }),
})
const child = sessionFixture({
  id: 'child',
  title: 'Audit the API',
  sessionKind: 'subagent',
  parentSessionId: 'root',
  rootSessionId: 'root',
  provenance: {
    kind: 'task-delegation',
    parentSessionId: 'root',
    toolCallId: 'tc1',
  },
})

/** `awaited: false` is a run nobody delegated: a person talking to the child in its own chat. */
function harness(
  opts: {
    closed?: boolean
    awaited?: boolean
    queued?: () => boolean
    /** Stored assistant rows by id, where a run is more than one row; the rest answer `answer of <id>`. */
    rows?: Record<
      string,
      {
        content: string
        continuedFromMessageId?: string
        items?: { type: string; name: string; status: string }[]
      }
    >
  } = {},
) {
  if (opts.awaited !== false) expectReport('child')
  const events: string[] = []
  const woken: WakeRequest[] = []
  setAgentService({
    createSession: async () => ({ id: 'x', taskName: null }),
    runJobTask: async () => undefined,
    wakeSession: async (request) => {
      events.push('wake')
      woken.push(request)
    },
    flushChildMessages: async () => void events.push('flush'),
  })
  const live = new Set([subagentWorkKey('child')])
  const decided: string[] = []
  // Just the receipt insert the seam makes for a report it decided against.
  const db = {
    insertInto: () => ({
      values: (row: { delivery_key: string }) => ({
        onConflict: () => ({ execute: async () => void decided.push(row.delivery_key) }),
      }),
    }),
  }
  const env = {
    deps: { db },
    // A turn still waiting in the child's own session — a teammate's, in a team.
    hasPendingQueue: async () => opts.queued?.() ?? false,
    repo: {
      getMessage: async (_u: string, _s: string, id: string) => ({
        id,
        payload: { role: 'assistant', content: `answer of ${id}`, ...opts.rows?.[id] },
      }),
      // The child read fresh (a close may have landed during the run); the root for the handle.
      getSession: async (_u: string, id: string) =>
        id === 'child' ? { ...child, closedAt: opts.closed ? '2026-10-01' : null } : root,
    },
    state: {
      actionRegistry: new Map([[subagentWorkKey('child'), {}]]),
      work: {
        get: (key: string) => (live.has(key) ? { key } : undefined),
        end: (key: string) => {
          events.push('work-end')
          live.delete(key)
        },
      },
    },
  }
  return { env: env as never, events, woken, decided }
}

describe('a delegated child reports every run', () => {
  test('the run it was launched with, to the root chat', async () => {
    const h = harness()
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'completed' })

    expect(h.woken).toHaveLength(1)
    expect(h.woken[0]).toMatchObject({
      sessionId: 'root',
      source: 'subagent',
      deliveryKey: 'child-terminal:child:m1',
      receipt: true,
    })
    expect(h.woken[0]!.content).toContain('Audit the API')
    expect(h.woken[0]!.content).toContain('answer of m1')
  })

  test('and every run after it the delegator waits on, each as its own delivery', async () => {
    const h = harness()
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'completed' })
    expectReport('child') // the delegator messaged it again
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm2', outcome: 'completed' })

    expect(h.woken.map((wake) => wake.deliveryKey)).toEqual([
      'child-terminal:child:m1',
      'child-terminal:child:m2',
    ])
    expect(h.woken[1]!.content).toContain('answer of m2')
  })

  test('a run a steer split into rows reports every reply since it began, not the last row alone', async () => {
    // LOCALIX-430: the delegator amended the brief mid-run; the child had already written the
    // review in the row before, and the report was the 244 characters it said after.
    const h = harness({
      rows: {
        m1: { content: 'The full review of the API.' },
        m2: { content: 'See my previous report.', continuedFromMessageId: 'm1' },
      },
    })
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm2', outcome: 'completed' })

    expect(h.woken[0]!.content).toContain('The full review of the API.')
    expect(h.woken[0]!.content).toContain('See my previous report.')
    expect(h.woken[0]).toMatchObject({ deliveryKey: 'child-terminal:child:m2' })
    expect(h.woken[0]!.report?.text).toBe('The full review of the API.\n\nSee my previous report.')
  })

  test('a child that messaged its delegator and ended its turn is said to be waiting, not finished', async () => {
    // LOCALIX-430: "[Subagent finished]" for a child that had asked a question and stopped.
    const h = harness({
      rows: {
        m1: {
          content: 'Waiting for the branch name.',
          items: [
            { type: 'tool_call', name: 'Read', status: 'completed' },
            { type: 'tool_call', name: 'SendMessage', status: 'completed' },
          ],
        },
      },
    })
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'completed' })
    expect(h.woken[0]!.content.startsWith('[Subagent is waiting for your answer]')).toBe(true)
    expect(h.woken[0]!.content).not.toContain('finished')
    expect(h.woken[0]!.report?.waiting).toBe(true)
  })

  test('a child that messaged its delegator and kept working is finished when it ends', async () => {
    const h = harness({
      rows: {
        m1: {
          content: 'Done.',
          items: [
            { type: 'tool_call', name: 'SendMessage', status: 'completed' },
            { type: 'tool_call', name: 'Edit', status: 'completed' },
          ],
        },
      },
    })
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'completed' })
    expect(h.woken[0]!.content.startsWith('[Subagent finished]')).toBe(true)
    expect(h.woken[0]!.report?.waiting).toBeUndefined()
  })

  test('a follow-up run reports only its own replies, not the run the parent already read', async () => {
    const h = harness({ rows: { m2: { content: 'Second answer.' } } })
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm2', outcome: 'completed' })
    expect(h.woken[0]!.report?.text).toBe('Second answer.')
  })

  test('a run stopped at its turn limit reports its output marked partial (CC maxTurns)', async () => {
    const h = harness()
    const run = { userId: 'u', session: child, runId: 'm4', outcome: 'completed' as const }
    const ended = reportChildRun(h.env, { ...run, partial: true })
    // Noted before the first await: the launch watching the child reads it as the run returns.
    expect(takeTurnLimit('child')).toBe(true)
    await ended
    expect(h.woken[0]!.report).toMatchObject({ status: 'completed', partial: true })
    expect(h.woken[0]!.content).toContain('reached its turn limit')
    expect(h.woken[0]!.content).toContain('Its partial output:\nanswer of m4')
  })

  test('a failed run reports — the parent must know the work did not happen', async () => {
    const h = harness()
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm3', outcome: 'failed' })
    expect(h.woken).toHaveLength(1)
    expect(h.woken[0]!.deliveryKey).toBe('child-terminal:child:m3')
  })

  test('a STOPPED run reports nothing, and held messages still start the next run', async () => {
    // Stopped by the delegator, whose own tool result said so, or by a person who took the child
    // over. Either way a "STOPPED" report is noise the parent did not ask for.
    const h = harness()
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'stopped' })
    expect(h.woken).toEqual([])
    expect(h.events).toEqual(['work-end', 'flush'])
    // Recorded as decided, so the recovery sweep does not send it half a minute later instead.
    expect(h.decided).toEqual(['child-terminal:child:m1'])
  })

  test('a person’s Stop leaves the wait standing: the parent hears once, when the child next finishes', async () => {
    const h = harness()
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'stopped' })
    // The person talks the child through it; its next run finishes on its own.
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm2', outcome: 'completed' })
    expect(h.woken.map((wake) => wake.deliveryKey)).toEqual(['child-terminal:child:m2'])
    // ...and the dialog that goes on after it no longer reaches the parent.
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm3', outcome: 'completed' })
    expect(h.woken).toHaveLength(1)
  })

  test('a run nobody delegated — a person’s own dialog with the child — reports nothing', async () => {
    const h = harness({ awaited: false })
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'completed' })
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm2', outcome: 'failed' })
    expect(h.woken).toEqual([])
    // One work record in this harness, so only the first run ends one; both runs still flush.
    expect(h.events).toEqual(['work-end', 'flush', 'flush'])
    expect(h.decided).toEqual(['child-terminal:child:m1', 'child-terminal:child:m2'])
  })

  test('the work record ends BEFORE the wake, and waiting messages start the next run after it', async () => {
    const h = harness()
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'completed' })
    expect(h.events).toEqual(['work-end', 'wake', 'flush'])
  })

  test('its lane goes to the next waiting child the moment the run ends', async () => {
    for (const sibling of ['child', 's2', 's3']) requestLane('root', sibling, () => {})
    let started = false
    requestLane('root', 'waiting', () => {
      started = true
    })
    await reportChildRun(harness().env, {
      userId: 'u',
      session: child,
      runId: 'm1',
      outcome: 'completed',
    })
    expect(started).toBe(true)
  })

  test('a CLOSED child reports nothing — but still frees its record and its lane', async () => {
    // Its delegator closed it; a STOPPED report for the run the close stopped is noise.
    for (const sibling of ['child', 's2', 's3']) requestLane('root', sibling, () => {})
    let started = false
    requestLane('root', 'waiting', () => {
      started = true
    })
    const h = harness({ closed: true })
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'completed' })
    expect(h.woken).toEqual([])
    expect(h.events).toEqual(['work-end'])
    expect(started).toBe(true)
  })

  test('a TEAM reports once, when it has gone quiet — not at the end of each member’s run', async () => {
    let queued = true
    const h = harness({ queued: () => queued })
    // @b's run ends with @c's turn still queued in the team's session: the team is not done.
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'b1', outcome: 'completed' })
    expect(h.woken).toEqual([])
    queued = false
    // The last run ends with nothing left: that is the team's report, and the wait stood until it.
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'b2', outcome: 'completed' })
    expect(h.woken.map((wake) => wake.deliveryKey)).toEqual(['child-terminal:child:b2'])
    expect(h.decided).toEqual(['child-terminal:child:b1'])
  })

  test('a child whose own children still work waits for their reports before it reports', async () => {
    const h = harness()
    requestLane('child', 'grandchild', () => {})
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm1', outcome: 'completed' })
    expect(h.woken).toEqual([])
    // The grandchild finished; its report woke the child, whose next run ends quiet.
    releaseLane('grandchild')
    await reportChildRun(h.env, { userId: 'u', session: child, runId: 'm2', outcome: 'completed' })
    expect(h.woken).toHaveLength(1)
  })

  test('a session that is not a delegated child reports nothing', async () => {
    const h = harness()
    await reportChildRun(h.env, { userId: 'u', session: root, runId: 'm1', outcome: 'completed' })
    const job = sessionFixture({ id: 'job', sessionKind: 'job' })
    await reportChildRun(h.env, { userId: 'u', session: job, runId: 'm1', outcome: 'completed' })
    expect(h.woken).toEqual([])
  })
})
