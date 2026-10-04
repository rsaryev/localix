import { afterEach, describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../testing/session-fixture'
import { rootExecutionContext } from './execution-context'
import type { AgentTurnSource } from './conversation-strategy'
import { recipientSlotId, supersedeColleagueChains } from './conversation-dispatch'
import { createWakeQueue } from './wake-queue'

describe('conversation dispatch', () => {
  const queues: Array<ReturnType<typeof createWakeQueue>> = []
  afterEach(async () => {
    await Promise.all(queues.splice(0).map((q) => q.close()))
  })

  test('the first recipient answers into the minted slot; later ones get stable derived ids', () => {
    expect(recipientSlotId('slot', 0, 'a')).toBe('slot')
    expect(recipientSlotId('slot', 1, 'b')).toBe('slot-b')
    expect(recipientSlotId('slot', 1, 'b')).toBe(recipientSlotId('slot', 1, 'b'))
  })

  test('a person speaking drops the colleague chain but keeps what is owed to them', async () => {
    const session = sessionFixture({ id: 's1' })
    // Busy, so both tickets wait in the queue.
    const queue = createWakeQueue({
      repo: {} as never,
      streamRegistry: { publish: () => {} } as never,
      now: () => '2026-09-23T00:00:00.000Z',
      state: {
        activeRuns: new Map([[session.id, new AbortController()]]),
        drainingSessions: new Set(),
        sessionRunIdentity: new Map(),
      },
      run: async () => ({ status: 'completed' as const }),
    })
    queues.push(queue)
    const ticket = (agentId: string, source: AgentTurnSource) =>
      queue.wake({
        userId: session.userId,
        session,
        content: '',
        agentTurn: {
          speakerAgentId: agentId,
          assistantMessageId: `slot-${agentId}`,
          triggerMessageIds: [],
          source,
          scope: { speakerAgentId: agentId, executionContext: rootExecutionContext() },
        },
      })
    await ticket('answers-the-user', 'user-address')
    await ticket('colleague', 'agent-request')

    await supersedeColleagueChains(queue.cancelAgentTurns, session.userId, session.id)

    const left = await queue.list(session.id)
    expect(left.map((item) => item.id)).toEqual(['agent-turn-slot-answers-the-user'])
  })
})
