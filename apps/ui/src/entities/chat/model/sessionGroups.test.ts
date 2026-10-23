import { describe, expect, test } from 'bun:test'
import type { UiSession } from '@/shared/api/contracts'
import {
  agentGroups,
  conversationKey,
  groupParticipants,
  isConversationGroup,
  sessionAgentHandle,
} from './sessionGroups'

const route = (handle: string) => ({
  handle,
  providerConnectionId: null,
  modelId: '',
  reasoningEffort: 'low' as const,
})

const chat = (id: string, handle: string, updatedAt: number): UiSession =>
  ({ id, agents: [route(handle)], updatedAt }) as UiSession

const conversation = (id: string, handles: string[], updatedAt: number): UiSession =>
  ({ id, agents: handles.map(route), updatedAt }) as UiSession

const shape = (groups: ReturnType<typeof agentGroups>) =>
  groups.map((group) => [group.handle, group.sessions.map((s) => s.id)])

const ROSTER = ['localix', 'lead', 'qa']

describe('agentGroups', () => {
  test('every agent gets a group, including the ones never talked to', () => {
    // The roster comes in rather than being derived from the sessions, and this is why: an
    // agent with no chats still needs somewhere to start one. Deriving groups from what
    // exists would keep a new teammate invisible until someone had already used them.
    expect(shape(agentGroups([], ROSTER))).toEqual([
      ['localix', []],
      ['lead', []],
      ['qa', []],
    ])
  })

  test('the group whose chat moved most recently comes first', () => {
    expect(shape(agentGroups([chat('a', 'localix', 10), chat('b', 'qa', 99)], ROSTER))).toEqual([
      ['qa', ['b']],
      ['localix', ['a']],
      ['lead', []],
    ])
  })

  test('untouched agents settle at the bottom, in roster order', () => {
    // Not an accident of iteration: the roster's own order is the only stable answer when
    // there is no activity to sort by.
    const groups = agentGroups([chat('a', 'qa', 5)], ROSTER)
    expect(groups.map((group) => group.handle)).toEqual(['qa', 'localix', 'lead'])
  })

  test('a chat with an agent no longer in the roster still gets a group', () => {
    // Disabled or deleted since. Dropping it would hide real conversations, which is worse
    // than an extra heading.
    const groups = agentGroups([chat('x', 'retired', 7)], ROSTER)
    expect(groups[0]).toMatchObject({ handle: 'retired' })
    expect(groups).toHaveLength(4)
  })

  test('order inside a group is left exactly as it arrived', () => {
    // The list's own sort mode already decided it — pinned first, then recency or title.
    // Re-sorting here would silently override the mode the user picked.
    const groups = agentGroups([chat('z', 'localix', 1), chat('a', 'localix', 2)], ROSTER)
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['z', 'a'])
  })

  test('a chat with no stated agent belongs to the default one', () => {
    const orphan = { id: 'x', agents: [], updatedAt: 3 } as unknown as UiSession
    expect(sessionAgentHandle(orphan)).toBe('localix')
    expect(agentGroups([orphan], ROSTER)[0]).toMatchObject({ handle: 'localix' })
  })

  test("a group's timestamp is its newest chat, not its first", () => {
    const groups = agentGroups([chat('a', 'localix', 1), chat('b', 'localix', 50)], ROSTER)
    expect(groups[0]?.updatedAt).toBe(50)
  })
})

describe('multi-participant conversations', () => {
  test('a conversation gathers under its participants, not under one of them', () => {
    // Filing it under the first participant reads as "a chat with lead" and hides the other two —
    // wrong in a way that looks right until you open it.
    const key = sessionAgentHandle(conversation('r1', ['lead', 'qa'], 1))
    expect(isConversationGroup(key)).toBe(true)
    expect(groupParticipants(key)).toEqual(['lead', 'qa'])
    expect(shape(agentGroups([conversation('r1', ['lead', 'qa'], 5)], ROSTER))).toEqual([
      [key, ['r1']],
      ['localix', []],
      ['lead', []],
      ['qa', []],
    ])
  })

  test('the same people are the same conversation, whoever joined first', () => {
    // Order is how a conversation was assembled, not who is in it; grouping by it would split one
    // set of conversation partners across several headings.
    expect(sessionAgentHandle(conversation('a', ['qa', 'lead'], 1))).toBe(
      sessionAgentHandle(conversation('b', ['lead', 'qa'], 2)),
    )
    expect(conversationKey(['qa', 'lead', 'backend'])).toBe(
      conversationKey(['backend', 'lead', 'qa']),
    )
    const groups = agentGroups(
      [conversation('a', ['qa', 'lead'], 1), conversation('b', ['lead', 'qa'], 2)],
      [],
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  test('a different set of people is a different heading', () => {
    const groups = agentGroups(
      [conversation('a', ['qa', 'lead'], 1), conversation('b', ['qa', 'backend'], 2)],
      [],
    )
    expect(groups).toHaveLength(2)
  })

  test('a conversation heading exists only when such a conversation does', () => {
    // Unlike an agent's own heading there is no empty conversation to start from, so an
    // always-present heading would be a permanently empty one.
    expect(
      agentGroups([chat('c1', 'lead', 1)], ROSTER).some((group) =>
        isConversationGroup(group.handle),
      ),
    ).toBe(false)
  })

  test('a one-to-one is never mistaken for a multi-participant conversation', () => {
    expect(isConversationGroup(sessionAgentHandle(chat('c1', 'lead', 1)))).toBe(false)
    expect(groupParticipants('lead')).toEqual(['lead'])
  })
})
