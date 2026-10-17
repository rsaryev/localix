import { describe, expect, test } from 'bun:test'

import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import type { PersistedMessage } from '../contracts'
import { rosterLeadership } from '../runtime/conversation-strategy'
import { commandTarget } from './command-participant'

const session = sessionFixture({
  agents: [
    ...routedParticipants({ agentId: 'lead', handle: 'lead' }),
    ...routedParticipants({ agentId: 'qa', handle: 'qa' }),
  ],
})
const leadership = rosterLeadership(
  async () => [{ agentId: 'lead', leadershipPriority: 1 }],
  'u1',
  null,
)
const answeredBy = (agentId: string): PersistedMessage =>
  ({
    id: `m-${agentId}`,
    payload: {
      id: `m-${agentId}`,
      role: 'assistant',
      from: `agent:${agentId}`,
      to: 'user',
      content: 'ok',
    },
  }) as unknown as PersistedMessage

describe('which participant a slash command is about', () => {
  test('a leading @handle names it, and the rest keeps its own whitespace', async () => {
    const target = await commandTarget(session, [], '@qa high\n\nfix the flaky test', leadership)
    expect(target?.participant.agentId).toBe('qa')
    expect(target?.rest).toBe('high\n\nfix the flaky test')
  })

  test('without one it is the leader, whoever answered last', async () => {
    // Only the leader hands work out, so a command that names nobody is the leader's.
    const history = [answeredBy('lead'), answeredBy('qa')]
    const target = await commandTarget(session, history, 'sonnet', leadership)
    expect(target?.participant.agentId).toBe('lead')
    expect(target?.rest).toBe('sonnet')
  })

  test('an @word that names nobody here is left in the argument', async () => {
    const target = await commandTarget(session, [answeredBy('lead')], '@unknown-model', leadership)
    expect(target?.participant.agentId).toBe('lead')
    expect(target?.rest).toBe('@unknown-model')
  })

  test('before anyone has answered it is the leader the registry ranks, not the first seat', async () => {
    const ranked = rosterLeadership(
      async () => [{ agentId: 'qa', leadershipPriority: 2 }],
      'u1',
      null,
    )
    expect((await commandTarget(session, [], 'sonnet', ranked))?.participant.agentId).toBe('qa')
  })
})
