import { describe, expect, test } from 'bun:test'

import {
  buildParticipantsSection,
  buildTurnControlSection,
  isMultiAgentConversation,
} from './system-prompt-conversation-section'
import {
  SOLO_TURN_CONTROL,
  TEAM_CONVERSATION,
  TEAM_LEADERSHIP,
} from './system-prompt-team-contract'

const PARTICIPANTS = [
  { handle: 'lead', description: 'Plans the work' },
  { handle: 'qa' },
  { handle: 'backend' },
]

describe('the conversation roster', () => {
  test('names colleagues from the speaker’s point of view', () => {
    const section = buildParticipantsSection({ self: 'qa', participants: PARTICIPANTS })!
    expect(section).toContain('You are qa')
    expect(section).toContain('- @lead: Plans the work')
    expect(section).not.toContain('- @qa')
  })

  test('carries no rules — they live in the stable turn-control section', () => {
    // The roster rides the volatile tail because agents change it mid-conversation; a rule in
    // it would be re-sent uncached on every turn and duplicated with the protocol.
    const section = buildParticipantsSection({ self: 'qa', participants: PARTICIPANTS })!
    expect(section).not.toContain('conversation_control')
    expect(section).not.toContain(TEAM_CONVERSATION)
  })

  test('a single agent has no roster', () => {
    expect(buildParticipantsSection({ self: 'qa', participants: [{ handle: 'qa' }] })).toBeNull()
    expect(isMultiAgentConversation({ self: 'qa', participants: [{ handle: 'qa' }] })).toBe(false)
    expect(isMultiAgentConversation(undefined)).toBe(false)
    expect(isMultiAgentConversation({ self: 'qa', participants: PARTICIPANTS })).toBe(true)
  })
})

describe('the turn protocol', () => {
  test('a solo run in an open chat learns only how a handoff brings help in', () => {
    const solo = buildTurnControlSection({ multi: false, canInvite: true })!
    expect(solo).toContain(SOLO_TURN_CONTROL)
    expect(solo).toContain('call handoff with an available agent')
    // The full contract binds turns only once colleagues are present.
    expect(solo).not.toContain('Everyone here')
    expect(solo).not.toContain(TEAM_CONVERSATION)
    // Nothing to say to a lone agent that can neither invite nor own the topic.
    expect(buildTurnControlSection({ multi: false })).toBeNull()
  })

  test('a multi-agent run gets the addressing contract and the lane isolation', () => {
    const multi = buildTurnControlSection({ multi: true })!
    expect(multi).toContain('Everyone here — the user and every participant — reads your reply')
    expect(multi).toContain('nobody sees your reasoning or tool calls')
    expect(multi).toContain('call handoff with their handles')
    expect(multi).toContain('An @handle of someone already here is a link that assigns nothing')
    expect(multi).toContain('A reply without a handoff returns the floor')
    expect(multi).toContain('Never end silently')
    expect(multi).not.toContain('conversation_control')
    expect(multi).not.toContain('handoff note')
  })

  test('never names a task board — that workflow belongs to the tool that owns one', () => {
    // A board is a plugin tool now; a core contract naming it would be prose for a tool most
    // runs do not hold, the defect that once made a model invent a KANBAN.md.
    for (const isLeader of [true, false]) {
      const section = buildTurnControlSection({ multi: true, isLeader })
      expect(section).not.toMatch(/\bboard\b/i)
      expect(section).not.toMatch(/\bcards?\b/i)
    }
  })

  test('only the elected leader receives orchestration ownership', () => {
    const leader = buildTurnControlSection({ multi: true, isLeader: true })!
    const participant = buildTurnControlSection({ multi: true, isLeader: false })!
    expect(leader).toContain('You are the leader of this conversation')
    expect(leader).toContain(TEAM_LEADERSHIP)
    expect(leader).toContain('own coordination and delivery of the requested outcome')
    expect(leader).toContain('The user already read the report')
    expect(leader).toContain('send what is missing or unverified back to its owner')
    expect(participant).not.toContain(TEAM_LEADERSHIP)
    expect(participant).not.toContain('You are the leader')
    expect(participant).toContain('leader owns coordination and the final answer to the user')
  })
})

test('only topic owners keep the topic, and set_topic never ends the turn', () => {
  for (const multi of [false, true]) {
    const owner = buildTurnControlSection({ multi, canChangeTopic: true })!
    expect(owner).toContain('Set the goal when it is missing')
    expect(owner).toContain(
      'call set_topic (title, goal, previous_topic_summary) first, then continue the work in this same turn',
    )
    expect(owner).toContain('Keep the current topic for follow-up questions')
    expect(buildTurnControlSection({ multi, canChangeTopic: false }) ?? '').not.toContain(
      'Set the goal',
    )
  }
})
