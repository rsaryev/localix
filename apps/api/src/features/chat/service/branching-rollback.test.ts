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
const agentId = session.agents[0]!.agentId

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
  const ticket = (slot: string, triggers: string[], speakerAgentId = agentId) =>
    queue.wake({
      userId: 'u',
      session,
      content: '',
      agentTurn: {
        speakerAgentId,
        assistantMessageId: slot,
        triggerMessageIds: triggers,
        source: 'agent-request',
        scope: { speakerAgentId, executionContext: rootExecutionContext() },
      },
    })
  return { queue, ticket }
}

describe('cancelling agent turns by transcript rows', () => {
  test('takes the tickets answering, or writing into, the named rows and no others', async () => {
    const { queue, ticket } = busyQueue()
    await ticket('slot-kept', ['m-kept'], 'agent-a')
    await ticket('slot-answering', ['m-gone'], 'agent-b')
    await ticket('slot-gone', ['m-kept'], 'agent-c')
    await queue.cancelAgentTurns('u', 's', { messageIds: ['m-gone', 'slot-gone'] })
    expect((await queue.list('s')).map((item) => item.agentId)).toEqual(['agent-a'])
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
