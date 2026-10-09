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
    expect(section).toContain('You are @qa')
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
  test('a solo run gets only what its inviting turn needs', () => {
    const solo = buildTurnControlSection({ multi: false })
    expect(solo).toContain(SOLO_TURN_CONTROL)
    expect(solo).toContain('both invite and next')
    // The full contract binds turns only once colleagues are present.
    expect(solo).not.toContain('End each multi-agent turn')
    expect(solo).not.toContain(TEAM_CONVERSATION)
  })

  test('a multi-agent run gets the full contract and the lane isolation', () => {
    const multi = buildTurnControlSection({ multi: true })
    expect(multi).toContain('End each multi-agent turn with conversation_control once')
    expect(multi).toContain(
      'Colleagues see public messages, not your private reasoning or tool history',
    )
    expect(multi).toContain('Keep conversation_control and queue mechanics out of the public reply')
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
    const leader = buildTurnControlSection({ multi: true, isLeader: true })
    const participant = buildTurnControlSection({ multi: true, isLeader: false })
    expect(leader).toContain('You are the leader of this conversation')
    expect(leader).toContain(TEAM_LEADERSHIP)
    expect(leader).toContain('own coordination and delivery of the requested outcome')
    expect(leader).toContain(
      'A completed run is a report to review, not proof the outcome is ready',
    )
    expect(participant).not.toContain(TEAM_LEADERSHIP)
    expect(participant).not.toContain('You are the leader')
    expect(participant).toContain('leader owns coordination and synthesis')
  })
})

test('only topic owners receive the required context-saving transition', () => {
  for (const multi of [false, true]) {
    const owner = buildTurnControlSection({ multi, canChangeTopic: true })
    expect(owner).toContain('Set the goal when it is missing')
    expect(owner).toContain('BEFORE investigating or implementing the new goal')
    expect(owner).toContain('Keep the current topic for follow-up questions')
    expect(buildTurnControlSection({ multi, canChangeTopic: false })).not.toContain('Set the goal')
  }
})
