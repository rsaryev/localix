import { afterEach, describe, expect, test } from 'bun:test'
import { builtinAgentId } from '@localixai/agent/agents'

import {
  __resetExpectedReports,
  awaitsReports,
  dropExpectedReport,
  expectReport,
  onReportSettled,
  settleReport,
  takeExpectedReport,
} from '../../../agent-core/delegation-awaits'
import { routedParticipants, sessionFixture } from '../../../../testing/session-fixture'
import type { PersistedMessage } from '../../contracts'
import type { RunParams } from '../run-contract'
import { createWakeQueue } from '../wake-queue'
import { MAX_REPORT_HOLD_MS } from './holds'

/**
 * Batches through the whole queue: what is delivered together arrives as ONE turn — the reports
 * of one delegator once the last of them is in, the person's lines typed while the agent worked —
 * and what waits is listed as waiting, not as work that would open a turn.
 */
const lead = routedParticipants({ agentId: builtinAgentId('lead'), handle: 'lead' })[0]!
const LEAD = `agent:${builtinAgentId('lead')}` as const
const queues: Array<ReturnType<typeof createWakeQueue>> = []
afterEach(async () => {
  await Promise.all(queues.splice(0).map((q) => q.close()))
  __resetExpectedReports()
})

function harness(opts: { busy?: boolean } = {}) {
  const session = sessionFixture({ id: 's1', agents: [lead] })
  const messages: PersistedMessage[] = []
  const runs: RunParams[] = []
  const activeRuns = new Map<string, AbortController>()
  if (opts.busy) activeRuns.set(session.id, new AbortController())
  let clock = Date.parse('2026-10-19T10:00:00.000Z')
  const queue = createWakeQueue({
    repo: {
      listMessages: async () => [...messages],
      insertMessage: async (message: PersistedMessage) => void messages.push(message),
      insertMessages: async (rows: readonly PersistedMessage[]) => void messages.push(...rows),
      getMessage: async (_u: string, _s: string, id: string) =>
        messages.find((message) => message.id === id) ?? null,
      getSession: async () => session,
    } as never,
    streamRegistry: { publish: () => {} } as never,
    now: () => new Date(clock).toISOString(),
    state: { activeRuns, drainingSessions: new Set(), sessionRunIdentity: new Map() },
    reportBarrier: { awaits: awaitsReports, subscribe: onReportSettled },
    run: async (params: RunParams) => {
      runs.push(params)
      return { status: 'completed' as const }
    },
  })
  queues.push(queue)
  /** A child's run ended and reported, as `run/child-run-report.ts` sends it. */
  const childReports = async (childSessionId: string) => {
    takeExpectedReport(childSessionId)
    await queue.wake({
      userId: session.userId,
      session,
      content: `${childSessionId} report`,
      source: 'subagent',
      to: { participant: LEAD },
      report: {
        label: childSessionId,
        childSessionId,
        runId: `${childSessionId}-run`,
        status: 'completed',
        text: `${childSessionId} is done`,
      },
    })
    settleReport(childSessionId)
  }
  const settle = async (count: number) => {
    for (let i = 0; i < 200 && runs.length < count; i++)
      await new Promise((resolve) => setTimeout(resolve, 5))
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const delivered = () =>
    messages.filter((message) => message.payload.role === 'user').map((m) => m.payload.content)
  return {
    session,
    queue,
    runs,
    messages,
    activeRuns,
    childReports,
    settle,
    delivered,
    advance: (ms: number) => (clock += ms),
  }
}

const delegator = { sessionId: 's1', participant: LEAD }

describe('the reports of one delegator', () => {
  test('wait for the last of them, then reach it as one turn', async () => {
    const h = harness()
    expectReport('a', delegator)
    expectReport('b', delegator)
    await h.childReports('a')
    await h.settle(1)
    expect(h.runs).toHaveLength(0)
    expect(await h.queue.list('s1')).toMatchObject([{ source: 'subagent', delivery: 'held' }])
    // Held is not "someone waiting to be heard": a group's round or a continuation goes on.
    expect(await h.queue.hasPending('s1')).toBe(false)

    await h.childReports('b')
    await h.settle(1)
    expect(h.runs).toHaveLength(1)
    const [turn] = h.delivered()
    expect(turn).toContain('[2 delegated task reports]')
    expect(turn).toContain('a is done')
    expect(turn).toContain('b is done')
    expect(await h.queue.list('s1')).toEqual([])
  })

  test('a sibling that will not report — stopped, closed — releases the one held for it', async () => {
    const h = harness()
    expectReport('a', delegator)
    expectReport('b', delegator)
    await h.childReports('a')
    await h.settle(1)
    expect(h.runs).toHaveLength(0)
    dropExpectedReport('b')
    await h.settle(1)
    expect(h.runs).toHaveLength(1)
    expect(h.delivered()[0]).toStartWith('[Delegated task finished] a (id: a)')
  })

  test('none waits past the hold limit for a sibling still running', async () => {
    const h = harness()
    expectReport('a', delegator)
    expectReport('slow', delegator)
    await h.childReports('a')
    await h.settle(1)
    expect(h.runs).toHaveLength(0)
    h.advance(MAX_REPORT_HOLD_MS)
    h.queue.scheduleDrain('s1')
    await h.settle(1)
    expect(h.runs).toHaveLength(1)
    expect(h.delivered()[0]).toContain('a is done')
  })
})

describe("the person's lines typed while the agent worked", () => {
  test('are answered once, in order, when the run ends', async () => {
    const h = harness({ busy: true })
    for (const [content, clientMessageId] of [
      ['use the staging database', 'c1'],
      ['and keep the old schema', 'c2'],
    ])
      await h.queue.wake({
        userId: h.session.userId,
        session: h.session,
        content: content!,
        internal: false,
        source: 'user-busy',
        clientMessageId: clientMessageId!,
        toolSurface: { capabilities: ['workbench-ui'] },
      })
    h.activeRuns.delete('s1')
    h.queue.scheduleDrain('s1')
    await h.settle(1)
    expect(h.runs).toHaveLength(1)
    expect(h.delivered()).toEqual(['use the staging database\n\nand keep the old schema'])
    const row = h.messages.find((message) => message.payload.role === 'user')!
    expect(row.payload.clientMessageIds).toEqual(['c1', 'c2'])
  })
})
