import { describe, expect, test } from 'bun:test'

import { turnRecipient } from './conversation-strategy'
import { sessionFixture } from '../../../testing/session-fixture'
import type { AgentTurnAdmission } from './agent-turn-ticket'
import { enqueueTurnTicket } from './conversation-dispatch'
import { rootExecutionContext } from './execution-context'

describe('conversation dispatch', () => {
  test('a message admits exactly one ticket, for the conversation’s agent, in the minted slot', async () => {
    const session = sessionFixture()
    const admitted: Array<{ turn: AgentTurnAdmission; source: string }> = []
    const recipient = turnRecipient(session, { kind: 'user-message', text: 'look' })!
    await enqueueTurnTicket(
      async (turn, source) => {
        admitted.push({ turn, source })
      },
      {
        userId: session.userId,
        session,
        triggerMessageIds: ['user-row'],
        firstSlotId: 'slot',
        recipient,
        scope: { executionContext: rootExecutionContext() },
      },
    )
    expect(admitted).toHaveLength(1)
    expect(admitted[0]!.source).toBe('user-default')
    expect(admitted[0]!.turn.assistantMessageId).toBe('slot')
  })
})
