import { afterEach, describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { rootExecutionContext } from '../execution-context'
import type { AgentTurnTicket } from '../agent-turn-ticket'
import type { RunParams } from '../run-contract'
import { createWakeQueue } from '../wake-queue'
import { mergeAgentTicket } from './merge-ticket'

const ticket = (slot: string, extra: Partial<AgentTurnTicket> = {}): AgentTurnTicket => ({
  assistantMessageId: slot,
  triggerMessageIds: [`trigger-${slot}`],
  source: 'user-default',
  scope: { executionContext: rootExecutionContext() },
  ...extra,
})

describe('mergeAgentTicket — the rule', () => {
  test('the stronger request defines the run; the reply lands in the newest slot', () => {
    const waiting = ticket('a1', { source: 'runtime' })
    const incoming = ticket('a2', {
      scope: { ...waiting.scope, modelOverride: 'fast-model' },
    })
    const merge = mergeAgentTicket(
      { ticket: waiting, priority: -4 },
      { ticket: incoming, priority: -8 },
    )
    expect(merge.ticket.scope.modelOverride).toBe('fast-model')
    expect(merge.ticket.source).toBe('user-default')
    expect(merge.ticket.assistantMessageId).toBe('a2')
    expect(merge.ticket.triggerMessageIds).toEqual(['trigger-a1', 'trigger-a2'])
    expect(merge.priority).toBe(-8)
    expect(merge.supersededSlot).toBe('a1')
  })

  test('a weaker request joins the burst without replacing the stronger scope', () => {
    const waiting = ticket('a1', { scope: { ...ticket('x').scope, modelOverride: 'kept' } })
    const merge = mergeAgentTicket(
      { ticket: waiting, priority: -8 },
      { ticket: ticket('a2', { source: 'runtime' }), priority: -4 },
    )
    expect(merge.ticket.scope.modelOverride).toBe('kept')
    expect(merge.ticket.source).toBe('user-default')
  })

  test('a fold that adds nothing writes nothing', () => {
    const waiting = ticket('a1')
    expect(
      mergeAgentTicket({ ticket: waiting, priority: -8 }, { ticket: waiting, priority: -8 })
        .changed,
    ).toBe(false)
  })
})

describe('mergeAgentTicket — in the queue', () => {
  const queues: Array<ReturnType<typeof createWakeQueue>> = []
  afterEach(async () => {
    await Promise.all(queues.splice(0).map((q) => q.close()))
  })

  const harness = (listMessages: () => Promise<[]>, opts: { busy?: boolean } = {}) => {
    const session = sessionFixture({ id: 's1' })
    // A busy session never drains on admission, so two requests meet while both are pending.
    const activeRuns = new Map<string, AbortController>(
      opts.busy ? [[session.id, new AbortController()]] : [],
    )
    const dispatched: string[] = []
    const dispatchWaiters: Array<{ count: number; resolve: () => void }> = []
    const removed: string[] = []
    const queue = createWakeQueue({
      repo: {
        listMessages,
        insertMessage: async () => {},
        getMessage: async (_u: string, _s: string, id: string) => ({
          id,
          payload: { id, role: 'assistant', content: '' },
        }),
        deleteMessagesByIds: async (_u: string, _s: string, ids: string[]) => {
          removed.push(...ids)
        },
        getSession: async () => session,
      } as never,
      streamRegistry: { publish: () => {} } as never,
      now: () => '2026-09-23T00:00:00.000Z',
      state: { activeRuns, drainingSessions: new Set(), sessionRunIdentity: new Map() },
      run: async (params: RunParams) => {
        dispatched.push(params.assistantMessageId)
        for (const waiter of dispatchWaiters)
          if (dispatched.length >= waiter.count) waiter.resolve()
        return { status: 'completed' as const }
      },
    })
    queues.push(queue)
    const wake = (slot: string) =>
      queue.wake({
        userId: session.userId,
        session,
        content: '',
        agentTurn: ticket(slot),
      })
    /** Resolves once `count` runs have been dispatched. */
    const dispatchedCount = (count: number) =>
      new Promise<void>((resolve) => {
        if (dispatched.length >= count) resolve()
        else dispatchWaiters.push({ count, resolve })
      })
    return { session, queue, wake, dispatched, removed, dispatchedCount }
  }

  test('a request arriving while the waiting ticket is already being dispatched is not lost', async () => {
    // The dispatcher reads history after taking the lease; hold it there.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reading!: () => void
    const readingHistory = new Promise<void>((resolve) => {
      reading = resolve
    })
    const h = harness(async () => {
      reading()
      await gate
      return []
    })
    await h.wake('a1')
    await readingHistory
    await h.wake('a2')
    release()
    await h.dispatchedCount(2)
    expect(h.dispatched).toEqual(['a1', 'a2'])
  })

  test('a fold into a pending ticket retires the superseded empty slot', async () => {
    const h = harness(async () => [], { busy: true })
    await h.wake('a1')
    await h.wake('a2')
    const pending = await h.queue.list(h.session.id)
    expect(pending).toHaveLength(1)
    expect(h.removed).toEqual(['a1'])
  })
})
