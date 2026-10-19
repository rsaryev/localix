import { describe, expect, test } from 'bun:test'

import {
  buildParticipantsSection,
  buildTurnControlSection,
  isMultiAgentConversation,
} from './conversation'
import {
  HUMAN_BOARD_CONTROL,
  HUMAN_ASK_CONTROL,
  HUMAN_NO_ASK_CONTROL,
  LEADER_BOARD,
  MEMBER_BOARD,
  SOLO_TURN_CONTROL,
  TEAM_CONVERSATION,
  TEAM_LEADERSHIP,
  TEAM_MEMBER,
} from './team-contract'

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

  test('a solo roster names no leader; a group one marks it once', () => {
    expect(
      buildParticipantsSection({ self: 'qa', participants: [{ handle: 'qa' }], leader: 'qa' }),
    ).not.toContain('leader')
    const member = buildParticipantsSection({
      self: 'qa',
      participants: PARTICIPANTS,
      leader: 'lead',
    })
    expect(member).toContain('- @lead (leader): Plans the work')
    expect(member).toContain('The leader is @lead')
  })

  test('board rules send process problems to the leader and say a wait once', () => {
    const member = buildTurnControlSection({ multi: true, hasBoard: true, canSkip: true })
    expect(member).toContain('goes to the leader by @mention, never to the person')
    expect(member).toContain('say so once and stop')
    expect(member).toContain('call skip_answer')
    const leader = buildTurnControlSection({ multi: true, isLeader: true, hasBoard: true })
    expect(leader).toContain('Never hand verification or completion to a member.')
    expect(leader).toContain('never bring in another coordinating role')
  })

  test('carries no rules — they live in the stable turn-control section', () => {
    // The roster rides the volatile tail because agents change it mid-conversation; a rule in
    // it would be re-sent uncached on every turn and duplicated with the protocol.
    const section = buildParticipantsSection({ self: 'qa', participants: PARTICIPANTS })!
    expect(section).not.toContain('conversation_control')
    expect(section).not.toContain(TEAM_CONVERSATION)
  })

  test('the person is always a participant, described by their record', () => {
    const solo = buildParticipantsSection({ self: 'qa', participants: [{ handle: 'qa' }] })
    expect(solo).toContain('- @human (Human): the person you work with')
    const described = buildParticipantsSection({
      self: 'qa',
      participants: PARTICIPANTS,
      human: {
        label: 'Rus',
        description: 'Manual QA — I verify releases by hand',
        instructions: 'Prefers short\nquestions.',
      },
    })
    expect(described).toContain(
      '- @human (Rus): the person you work with — Manual QA — I verify releases by hand\n  About them, in their words: Prefers short questions.',
    )
  })

  test('the description and instructions together stay within the cap', () => {
    const section = buildParticipantsSection({
      self: 'qa',
      participants: [{ handle: 'qa' }],
      human: { description: 'x'.repeat(700), instructions: 'z'.repeat(700) },
    })
    expect(section).toContain('x'.repeat(700))
    expect(section).toContain('z'.repeat(300))
    expect(section).not.toContain('z'.repeat(301))
  })

  test('the person does not make a solo chat a group', () => {
    expect(isMultiAgentConversation({ self: 'qa', participants: [{ handle: 'qa' }] })).toBe(false)
    expect(isMultiAgentConversation(undefined)).toBe(false)
    expect(isMultiAgentConversation({ self: 'qa', participants: PARTICIPANTS })).toBe(true)
  })
})

describe('the turn protocol', () => {
  test('a solo run in an open chat learns only how a tag brings help in', () => {
    const solo = buildTurnControlSection({ multi: false, canInvite: true })!
    expect(solo).toContain(SOLO_TURN_CONTROL)
    expect(solo).toContain('@mention an available agent')
    // The full contract binds turns only once colleagues are present.
    expect(solo).not.toContain('Everyone here')
    expect(solo).not.toContain(TEAM_CONVERSATION)
    // Even a lone agent that can neither invite nor own the topic learns how to reach the person.
    const bare = buildTurnControlSection({ multi: false })
    expect(bare).toContain(HUMAN_NO_ASK_CONTROL)
  })

  test('the person is reached through ask, never a mention, in solo and group runs alike', () => {
    for (const multi of [false, true]) {
      const section = buildTurnControlSection({ multi, hasBoard: true, canAsk: true })
      expect(section).toContain(HUMAN_ASK_CONTROL)
      expect(section).toContain('Never @mention the person')
      expect(section).not.toContain(HUMAN_NO_ASK_CONTROL)
      expect(section).toContain(HUMAN_BOARD_CONTROL)
    }
  })

  test('a run without ask proceeds on a stated assumption and never names the tool', () => {
    const section = buildTurnControlSection({ multi: true })
    expect(section).toContain('proceed on your best assumption and state it')
    expect(section).not.toContain('ask tool')
  })

  test('a member hands no work out and answers only about its own part', () => {
    const member = buildTurnControlSection({ multi: true, isLeader: false })
    expect(member).toContain('never @mention colleagues — only the leader hands work out')
    expect(member).toContain("questions about the whole work are the leader's")
  })

  test('no contract line makes work wait on an approval; Plan mode owns that', () => {
    const leader = buildTurnControlSection({ multi: true, isLeader: true, canAsk: true })
    expect(leader).not.toContain('mockup')
    expect(leader).not.toContain('waits for it')
  })

  test('a multi-agent run gets the addressing contract and the lane isolation', () => {
    const multi = buildTurnControlSection({ multi: true })!
    expect(multi).toContain('Everyone here — the user and every participant — reads your reply')
    expect(multi).toContain('nobody sees your reasoning or tool calls')
    expect(multi).toContain('Each participant you @mention answers once, in the order mentioned')
    expect(multi).toContain('A reply that mentions nobody returns the floor')
    expect(multi).toContain('Never end silently')
    expect(multi).not.toContain('conversation_control')
    expect(multi).not.toContain('handoff note')
  })

  test('names a task board only for a run that holds one', () => {
    // A board is a plugin tool; a contract naming it for a run without it once made a model
    // invent a KANBAN.md.
    for (const multi of [false, true])
      for (const isLeader of [true, false]) {
        const section = buildTurnControlSection({ multi, isLeader })
        expect(section).not.toMatch(/\bboard\b/i)
        expect(section).not.toMatch(/\bcards?\b/i)
      }
    expect(buildTurnControlSection({ multi: true, isLeader: true, hasBoard: true })).toContain(
      LEADER_BOARD,
    )
    expect(buildTurnControlSection({ multi: true, isLeader: false, hasBoard: true })).toContain(
      MEMBER_BOARD,
    )
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
    expect(participant).toContain(TEAM_MEMBER)
    expect(participant).toContain('@mention only the leader; never @mention colleagues')
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
