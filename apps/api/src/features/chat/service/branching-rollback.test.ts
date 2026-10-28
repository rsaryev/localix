import { afterEach, describe, expect, test } from 'bun:test'

import { createKeyedSerializer } from '../../../lib/keyed-serializer'
import { sessionFixture } from '../../../testing/session-fixture'
import { rootExecutionContext } from '../runtime/execution-context'
import { createWakeQueue } from '../runtime/wake-queue'
import { rollback, type BranchingOpsContext } from './branching-ops'

/**
 * A rollback takes turns back. A queued ticket answering one of them, or writing into one of their
 * slots, would recreate the slot when dispatched and bring the reply back — so it goes too.
 */
const queues: Array<ReturnType<typeof createWakeQueue>> = []
afterEach(async () => {
  await Promise.all(queues.splice(0).map((queue) => queue.close()))
})

const session = sessionFixture({ id: 's', userId: 'u' })

function busyQueue() {
  const queue = createWakeQueue({
    repo: {} as never,
    streamRegistry: { publish: () => {} } as never,
    now: () => '2026-10-21T00:00:00.000Z',
    state: {
      activeRuns: new Map([['s', new AbortController()]]),
      drainingSessions: new Set(),
      sessionRunIdentity: new Map(),
    },
    run: async () => ({ status: 'completed' as const }),
  })
  queues.push(queue)
  const ticket = (slot: string, triggers: string[]) =>
    queue.wake({
      userId: 'u',
      session,
      content: '',
      agentTurn: {
        assistantMessageId: slot,
        triggerMessageIds: triggers,
        source: 'runtime',
        scope: { executionContext: rootExecutionContext() },
      },
    })
  return { queue, ticket }
}

describe('cancelling agent turns by transcript rows', () => {
  test('keeps a ticket that touches none of the named rows', async () => {
    const { queue, ticket } = busyQueue()
    await ticket('slot-kept', ['m-kept'])
    await queue.cancelAgentTurns('u', 's', { messageIds: ['m-gone', 'slot-gone'] })
    expect(await queue.list('s')).toHaveLength(1)
  })

  test('takes the ticket answering a named row, or writing into it', async () => {
    const answering = busyQueue()
    await answering.ticket('slot-answering', ['m-gone'])
    await answering.queue.cancelAgentTurns('u', 's', { messageIds: ['m-gone'] })
    expect(await answering.queue.list('s')).toEqual([])

    const writing = busyQueue()
    await writing.ticket('slot-gone', ['m-kept'])
    await writing.queue.cancelAgentTurns('u', 's', { messageIds: ['slot-gone'] })
    expect(await writing.queue.list('s')).toEqual([])
  })
})

describe('rollback', () => {
  test('cancels the queued tickets of the rolled-back turns before deleting them', async () => {
    const calls: unknown[] = []
    const messages = [
      { id: 'm1', payload: { role: 'user', content: 'keep' } },
      { id: 'a1', payload: { role: 'assistant' } },
      { id: 'm2', payload: { role: 'user', content: 'take back' } },
      { id: 'a2', payload: { role: 'assistant' } },
    ]
    const ctx = {
      repo: {
        listMessages: async () => messages,
        deleteMessagesByIds: async (_u: string, _s: string, ids: string[]) =>
          void calls.push(['delete', ids]),
        setSessionLeaf: async () => {},
      },
      runner: {
        isRunning: () => false,
        isBusy: () => false,
        cancelAgentTurns: async (_u: string, _s: string, filter: unknown) =>
          void calls.push(['cancel', filter]),
      },
      streamRegistry: { publish: () => {} },
      now: () => '2026-10-21T00:00:00.000Z',
      requireSession: async () => ({ ...session, sessionKind: 'chat' }),
      withSessionMutationLock: createKeyedSerializer(),
    } as unknown as BranchingOpsContext
    expect(await rollback(ctx, 'u', 's', 'm2')).toEqual({ restoredPrompt: 'take back' })
    expect(calls).toEqual([
      ['cancel', { messageIds: ['m2', 'a2'] }],
      ['delete', ['m2', 'a2']],
    ])
  })
})
