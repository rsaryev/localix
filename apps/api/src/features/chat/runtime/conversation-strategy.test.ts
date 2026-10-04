import { describe, expect, test } from 'bun:test'
import type { PersistedMessage } from '../contracts'
import {
  conversationLeader,
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
  session: { agents },
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

  test('the registry is read only when a leader is actually elected', async () => {
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
    expect([addressed.reads.count, continuing.reads.count, electing.reads.count]).toEqual([0, 0, 1])
  })

  test('an explicit address wins even on the first turn', async () => {
    expect(
      await multiParticipantStrategy.recipients(context(), {
        kind: 'user-message',
        text: '@frontend inspect the UI',
      }),
    ).toEqual([{ agentId: 'builtin:frontend', source: 'user-address' }])
  })

  test('after history exists, ordinary continuity resumes instead of forcing the leader', async () => {
    expect(
      await multiParticipantStrategy.recipients(context([answer('builtin:frontend')]), {
        kind: 'user-message',
        text: 'Continue',
      }),
    ).toEqual([{ agentId: 'builtin:frontend', source: 'user-default' }])
  })

  test('an empty persisted assistant placeholder does not consume the leader turn', async () => {
    const placeholder = {
      payload: { role: 'assistant', from: 'agent:builtin:pm', to: 'user', content: '' },
    } as never
    expect(
      await multiParticipantStrategy.recipients(context([placeholder]), {
        kind: 'user-message',
        text: 'Build it',
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
})
