import { describe, expect, test } from 'bun:test'
import type { PersistedMessage } from '../contracts'
import { conversationLeader } from '../policy/axes/seat'
import {
  multiParticipantStrategy,
  rosterLeadership,
  type ConversationContext,
  type LeadershipRoster,
} from './conversation-strategy'

const agents = [
  { agentId: 'builtin:pm', handle: 'pm' },
  { agentId: 'builtin:lead', handle: 'lead' },
  { agentId: 'builtin:frontend', handle: 'frontend' },
] as ConversationContext['session']['agents']

const ranks = { 'builtin:pm': 1, 'builtin:lead': 2, 'builtin:frontend': 0 }

/** A registry that reports the ranks it holds and counts how often it was asked. */
function registry(held: Record<string, number> = ranks) {
  const reads = { count: 0 }
  const roster: LeadershipRoster = async () => {
    reads.count += 1
    return Object.entries(held).map(([agentId, leadershipPriority]) => ({
      agentId,
      leadershipPriority,
    }))
  }
  return { roster, reads }
}

const context = (
  history: PersistedMessage[] = [],
  roster: LeadershipRoster = registry().roster,
): ConversationContext => ({
  session: { agents, sessionKind: 'chat' },
  history,
  priorities: rosterLeadership(roster, 'u1', null),
})

const answer = (agentId: string): PersistedMessage =>
  ({
    payload: { role: 'assistant', from: `agent:${agentId}`, to: 'user', content: 'Done.' },
  }) as never

describe('conversation leadership', () => {
  test('the highest-priority participant receives the first unaddressed turn', async () => {
    expect(
      await multiParticipantStrategy.recipients(context(), {
        kind: 'user-message',
        text: 'Build it',
      }),
    ).toEqual([{ agentId: 'builtin:lead', source: 'user-default' }])
  })

  test("the rank is the agent definition's, so an edited agent leads at once", async () => {
    // The participant row used to carry a copy of the rank, kept fresh by the agents feature
    // writing this feature's table. With the definition as the only owner there is no copy to
    // go stale: the registry's current answer is the one that elects.
    const promoted = registry({ ...ranks, 'builtin:frontend': 3 })
    expect(
      await multiParticipantStrategy.recipients(context([], promoted.roster), {
        kind: 'user-message',
        text: 'Build it',
      }),
    ).toEqual([{ agentId: 'builtin:frontend', source: 'user-default' }])
  })

  test('the registry is read only when nobody is addressed', async () => {
    const addressed = registry()
    await multiParticipantStrategy.recipients(context([], addressed.roster), {
      kind: 'user-message',
      text: '@frontend inspect the UI',
    })
    const continuing = registry()
    await multiParticipantStrategy.recipients(
      context([answer('builtin:frontend')], continuing.roster),
      { kind: 'user-message', text: 'Continue' },
    )
    const electing = registry()
    await multiParticipantStrategy.recipients(context([], electing.roster), {
      kind: 'user-message',
      text: 'Build it',
    })
    expect([addressed.reads.count, continuing.reads.count, electing.reads.count]).toEqual([0, 1, 1])
  })

  test('an explicit address wins even on the first turn', async () => {
    expect(
      await multiParticipantStrategy.recipients(context(), {
        kind: 'user-message',
        text: '@frontend inspect the UI',
      }),
    ).toEqual([{ agentId: 'builtin:frontend', source: 'user-address' }])
  })

  // Only the leader hands work out, so a message to nobody in particular is the leader's even
  // after a colleague spoke last.
  test('a handle in code is a reference: the message still goes to the leader', async () => {
    expect(
      await multiParticipantStrategy.recipients(context(), {
        kind: 'user-message',
        text: 'Run `@frontend deploy` when the build is green.',
      }),
    ).toEqual([{ agentId: 'builtin:lead', source: 'user-default' }])
  })

  test('a message addressed to nobody goes to the leader, whoever answered last', async () => {
    expect(
      await multiParticipantStrategy.recipients(context([answer('builtin:frontend')]), {
        kind: 'user-message',
        text: 'Continue',
      }),
    ).toEqual([{ agentId: 'builtin:lead', source: 'user-default' }])
  })

  test('party order is the stable tie-break, and an unranked registry falls back to it', async () => {
    const level = new Map(agents.map((member) => [member.agentId, 1]))
    expect(conversationLeader({ agents }, level)?.agentId).toBe('builtin:pm')
    expect(conversationLeader({ agents }, await rosterLeadership(undefined, 'u1', null)())).toEqual(
      agents[0],
    )
  })

  test('a confident decision model names the participant an unaddressed message is for', async () => {
    const asked: { text: string; leaderAgentId?: string }[] = []
    const advised = {
      ...context(),
      advisor: async (question: { text: string; leaderAgentId?: string }) => {
        asked.push(question)
        return 'frontend'
      },
    }
    expect(
      await multiParticipantStrategy.recipients(advised, {
        kind: 'user-message',
        text: 'The submit button wraps on narrow screens',
      }),
    ).toEqual([{ agentId: 'builtin:frontend', source: 'user-default' }])
    // The leader is named, so the model can tell a specialist's job from the leader's.
    expect(asked).toEqual([
      expect.objectContaining({
        text: 'The submit button wraps on narrow screens',
        leaderAgentId: 'builtin:lead',
      }),
    ])
  })

  test('no confident advice, or advice naming nobody here, leaves the message with the leader', async () => {
    for (const advice of [null, 'person', 'ghost'])
      expect(
        await multiParticipantStrategy.recipients(
          { ...context(), advisor: async () => advice },
          { kind: 'user-message', text: 'Build it' },
        ),
      ).toEqual([{ agentId: 'builtin:lead', source: 'user-default' }])
  })

  test('an explicit address is exact: the model is not asked', async () => {
    let asked = 0
    expect(
      await multiParticipantStrategy.recipients(
        {
          ...context(),
          advisor: async () => {
            asked += 1
            return 'frontend'
          },
        },
        { kind: 'user-message', text: '@pm what is the scope?' },
      ),
    ).toEqual([{ agentId: 'builtin:pm', source: 'user-address' }])
    expect(asked).toBe(0)
  })
})
