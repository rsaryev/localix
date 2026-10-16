import { describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { sessionExecutionContext } from '../execution-context'
import { toPersistedMessage } from '../message-envelope'
import { buildTurnTriggerContext } from './turn-trigger-context'

const session = sessionFixture({
  agents: [
    {
      agentId: 'agent-a',
      handle: 'alpha',
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'medium',
    },
    {
      agentId: 'agent-b',
      handle: 'beta',
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'medium',
    },
  ],
})

describe('turn trigger context', () => {
  test('identifies a colleague handoff without copying its public text', () => {
    const trigger = toPersistedMessage(
      session.userId,
      session.id,
      {
        id: 'handoff',
        role: 'assistant',
        content: 'Secret public request',
        from: 'agent:agent-a',
        authorSnapshot: { handle: 'alpha' },
      },
      session.createdAt,
    )
    const context = buildTurnTriggerContext(
      {
        speakerAgentId: 'agent-b',
        turnTrigger: { kind: 'colleague-request', messageIds: ['handoff'] },
        executionContext: sessionExecutionContext(session),
      },
      session,
      [trigger],
    )

    expect(context).toContain('alpha handed you the floor. As beta')
    expect(context).not.toContain('Secret public request')
  })

  test('a report on handed-out work is named as one', () => {
    const context = buildTurnTriggerContext(
      {
        speakerAgentId: 'agent-b',
        turnTrigger: { kind: 'colleague-request', messageIds: ['handoff'], report: true },
        executionContext: sessionExecutionContext(session),
      },
      session,
      [],
    )
    expect(context).toContain('reported back on work you handed out. As beta, act on the report')
    // Crediting the reporter with @ handed it a turn to acknowledge the credit (LOCALIX-173).
    expect(context).toContain('a name without @ does not')
  })

  test('adds nothing to direct user turns', () => {
    expect(
      buildTurnTriggerContext(
        {
          speakerAgentId: 'agent-a',
          executionContext: sessionExecutionContext(session),
        },
        session,
        [],
      ),
    ).toBeUndefined()
  })
})
